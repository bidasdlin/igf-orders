import { PDFDocument, PDFImage, PDFPage, rgb, StandardFonts, PDFFont } from 'pdf-lib'
import { getPurchaseOrderByDocNumber } from '@/lib/quickbooks'

interface DirectLineItemInput {
  description: string
  quantity?: number
  qty?: number
  unitPrice?: number
  amount: number
  priceUom?: string
}

interface DirectPOInput {
  poNumber: string
  vendorName: string
  shipTo?: string
  date: string
  expShipDate?: string
  lineItems: DirectLineItemInput[]
  totalAmount: number
  notes?: string
  branch?: string
  freightTerm?: string
}

interface RenderedLineItem {
  qty: number
  itemCode: string
  description: string
  amount: number
  priceUom?: string
}

interface RenderedPO {
  vendorName: string
  orderDate: string
  docNumber: string
  freightTerm: string
  expShipDate: string
  shipTo: string
  items: RenderedLineItem[]
  totalAmt: number
  weightNote: string
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  text = sanitize(text)
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ')
    let current = ''
    for (const w of words) {
      const test = current ? `${current} ${w}` : w
      if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
        lines.push(current)
        current = w
      } else {
        current = test
      }
    }
    if (current) lines.push(current)
  }
  return lines
}

function sanitize(s: string): string {
  // Keep printable ASCII + Latin-1 Supplement + common Windows-1252 extras
  // Replace anything else (e.g. U+1100 Hangul, etc.) with '?'
  return s.replace(/[^\x0A\x0D\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u20AC]/g, '?')}

function parseQBDescription(desc: string): { qty: number; itemCode: string; description: string; priceUom?: string } {
  const normalized = sanitize(desc).trim()
  const priceUom = normalized.match(/(?:^|\n)Price\/UOM:\s*([^\n]+)/i)?.[1]?.trim()
  const withoutPriceUom = normalized.replace(/\n?Price\/UOM:\s*[^\n]+/ig, '').trim()
  const match = withoutPriceUom.match(/^(\d+(?:\.\d+)?)\s+Units?\s+([A-Z0-9]+)\s*(?:—|-)?\s*([\s\S]*)$/)
  if (match) {
    return {
      qty: parseInt(match[1], 10) || 0,
      itemCode: match[2] ?? '',
      description: match[3]?.trim() ?? '',
      priceUom,
    }
  }

  const parts = withoutPriceUom.split(/\s+/)
  return {
    qty: parseInt(parts[0] ?? '0', 10) || 0,
    itemCode: parts[2] ?? '',
    description: withoutPriceUom,
    priceUom,
  }
}

function getVendorCode(vendorName: string): string {
  const skip = new Set(['inc', 'ind', 'co', 'corp', 'ltd', 'llc', 'company', 'international', 'group'])
  return vendorName.split(/\s+/)
    .filter(w => w.length > 0 && !skip.has(w.toLowerCase()))
    .map(w => w[0].toUpperCase())
    .join('')
}

function parseMetadata(...values: string[]) {
  const parts = Array.from(new Set(values
    .flatMap((value) => value.split('|'))
    .map((value) => sanitize(value).trim())
    .filter(Boolean)))

  const branchMap: Record<string, string> = {
    'Los Angeles': 'LA', 'Savannah': 'SAV', 'Houston': 'HOU',
    'New York': 'NY', 'Newark': 'NE', 'Portland': 'VANC',
    'Seattle': 'SEA', 'Norfolk': 'NOR',
  }

  let branch = ''
  let freightTerm = ''
  let expShipDate = ''
  let shipTo = ''
  const notes: string[] = []

  for (const part of parts) {
    const branchMatch = part.match(/NDC Branch:\s*([A-Z]+)/i)?.[1]
    if (branchMatch) {
      branch = branchMatch
      continue
    }

    const freightMatch = part.match(/(?:Frt Term|Freight Term):\s*([A-Z]+-[A-Z]+)/i)?.[1]
      ?? part.match(/\b(DDP|FOB|CIF|CFR|FCA|CPT|CIP|DAP|DPU|EXW)-[A-Z]+\b/i)?.[0]
    if (freightMatch) {
      freightTerm = freightMatch
      continue
    }

    const expShipMatch = part.match(/Exp Ship Date:\s*([0-9/-]+)/i)?.[1]
    if (expShipMatch) {
      expShipDate = expShipMatch
      continue
    }

    const shipToMatch = part.match(/[Ss]hip to:\s*(.+)/i)?.[1]
    if (shipToMatch) {
      shipTo = shipToMatch.trim()
      continue
    }

    if (
      !/^IGF Customer PO:/i.test(part) &&
      !/^Customer PO#:/i.test(part) &&
      !/^[Ss]hip to:\s*$/i.test(part)
    ) {
      notes.push(part)
    }
  }

  if (!branch && shipTo) {
    for (const key of Object.keys(branchMap)) {
      if (shipTo.includes(key)) {
        branch = branchMap[key]
        break
      }
    }
  }

  return {
    branch,
    freightTerm,
    expShipDate,
    shipTo,
    notes: notes.join(' | '),
  }
}

function formatDate(txnDate: string): string {
  const [y, m, d] = txnDate.split('-')
  if (!y || !m || !d) return txnDate
  return `${m}/${d}/${y.slice(2)}`
}

function deepSanitize(obj: unknown): unknown {
  if (typeof obj === 'string') return sanitize(obj)
  if (Array.isArray(obj)) return obj.map(deepSanitize)
  if (obj && typeof obj === 'object') {
    const record: Record<string, unknown> = {}
    for (const key of Object.keys(obj as object)) {
      record[key] = deepSanitize((obj as Record<string, unknown>)[key])
    }
    return record
  }
  return obj
}

const portMap: Record<string, string> = {
  LA: 'Port of Los Angeles, CA', SAV: 'Port of Savannah, GA',
  HOU: 'Port of Houston, TX', NY: 'Port of New York, NJ',
  XA: 'Port of Savannah, GA', TEXAS: 'Port of Houston, TX',
  NE: 'Port of Newark, NJ', VANC: 'Port of Portland, OR',
  NOR: 'Port of Norfolk, VA', SEA: 'Port of Seattle, WA',
}

const weightMap: Record<string, string> = {
  LA: 'MAXIMUM WEIGHT TO LOS ANGELES IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US REGARDING REDUCING WEIGHT ON THE CONTAINER',
  SAV: 'MAXIMUM WEIGHT TO SAVANNAH IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
  XA: 'MAXIMUM WEIGHT TO SAVANNAH IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
  HOU: 'MAXIMUM WEIGHT TO HOUSTON IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
  TEXAS: 'MAXIMUM WEIGHT TO HOUSTON IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
  NY: 'MAXIMUM WEIGHT TO NEW YORK IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
  NE: 'MAXIMUM WEIGHT TO NEW YORK IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
}

function toRenderedLineItem(item: DirectLineItemInput): RenderedLineItem {
  const parsed = parseQBDescription(item.description ?? '')
  return {
    qty: Number(item.quantity ?? item.qty ?? parsed.qty ?? 0),
    itemCode: parsed.itemCode,
    description: parsed.description || sanitize(item.description ?? ''),
    amount: Number(item.amount ?? 0),
    priceUom: sanitize(item.priceUom ?? parsed.priceUom ?? '').trim() || undefined,
  }
}

function buildRenderedPOFromInput(input: DirectPOInput, fallbackDocNumber: string): RenderedPO {
  const branch = sanitize(input.branch ?? '').trim()
  return {
    vendorName: sanitize(input.vendorName ?? 'Unknown Vendor'),
    orderDate: formatDate(input.date ?? ''),
    docNumber: sanitize(input.poNumber || fallbackDocNumber),
    freightTerm: sanitize(input.freightTerm ?? '').trim(),
    expShipDate: sanitize(input.expShipDate ?? '').trim(),
    shipTo: sanitize(input.shipTo ?? '').trim() || portMap[branch] || branch,
    items: Array.isArray(input.lineItems) ? input.lineItems.map(toRenderedLineItem) : [],
    totalAmt: Number(input.totalAmount ?? 0),
    weightNote: sanitize(input.notes ?? '').trim() || weightMap[branch] || '',
  }
}

function buildRenderedPOFromQB(qbPO: Record<string, unknown>, fallbackDocNumber: string): RenderedPO {
  type VendorRef = { name?: string }
  const vendorName = (qbPO.VendorRef as VendorRef)?.name ?? 'Unknown Vendor'
  const txnDate = (qbPO.TxnDate as string) ?? ''
  const orderDate = formatDate(txnDate)
  const docNumber = (qbPO.DocNumber as string) ?? fallbackDocNumber
  const memo = (qbPO.Memo as string) ?? ''
  const privateNote = (qbPO.PrivateNote as string) ?? ''
  const totalAmt = (qbPO.TotalAmt as number) ?? 0
  const { branch, freightTerm, expShipDate, shipTo: metadataShipTo, notes } = parseMetadata(memo, privateNote)

  type QBLine = { DetailType?: string; Description?: string; Amount?: number }
  const rawLines = ((qbPO.Line as QBLine[]) ?? []).filter((line) => line.DetailType !== 'SubTotalLine')
  const items = rawLines.map((line) => {
    const parsed = parseQBDescription(line.Description ?? '')
    return {
      qty: parsed.qty,
      itemCode: parsed.itemCode,
      description: parsed.description,
      amount: line.Amount ?? 0,
    }
  })

  return {
    vendorName,
    orderDate,
    docNumber,
    freightTerm,
    expShipDate,
    shipTo: metadataShipTo || portMap[branch] || branch,
    items,
    totalAmt,
    weightNote: notes || weightMap[branch] || '',
  }
}

async function renderPurchaseOrderPdf(data: RenderedPO) {
  const {
    vendorName,
    orderDate,
    docNumber,
    freightTerm,
    expShipDate,
    shipTo,
    items,
    totalAmt,
    weightNote,
  } = data

  const pdfDoc = await PDFDocument.create()
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const black = rgb(0, 0, 0)
  const darkGray = rgb(0.25, 0.25, 0.25)
  const medGray = rgb(0.5, 0.5, 0.5)
  const lightGray = rgb(0.78, 0.78, 0.78)
  const tableGray = rgb(0.88, 0.88, 0.88)

  const width = 612
  const height = 792
  const M = 45
  const W = width - M * 2
  const c1 = M
  const c2 = M + 180
  const c3 = M + 380
  const c4 = M + 420
  const tDesc = M
  const tQty = M + 258
  const tRate = M + 328
  const tAmt = M + 398
  const tLoad = M + 472
  const descMaxW = 248
  const generatedAt = new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const pages: PDFPage[] = []
  const poRef = getVendorCode(vendorName) + '-IGF-' + docNumber.replace(/^0+/, '')
  let logoImage: PDFImage | null = null

  try {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 5000)
    const logoRes = await fetch('https://dl.dropboxusercontent.com/scl/fi/96dazjf2coj8wd2yk97x1/logo-northann.jpg?rlkey=h2yzlac1rbxuzc38fomax8wk2', { signal: ctrl.signal })
    if (logoRes.ok) {
      const logoBytes = await logoRes.arrayBuffer()
      logoImage = await pdfDoc.embedJpg(logoBytes)
    }
  } catch {
    logoImage = null
  }

  const drawMasthead = (page: PDFPage) => {
    let y = height - 48
    page.drawText(sanitize('NORTHANN DISTRIBUTION CENTER'), { x: M, y, font: fontB, size: 10, color: black })
    y -= 13
    page.drawText(sanitize('INC.'), { x: M, y, font: fontB, size: 10, color: black })
    y -= 13
    page.drawText('9820 Dino Dr Ste 110 Elk Grove, CA 95624', { x: M, y, font: fontR, size: 8, color: darkGray })
    y -= 10
    page.drawText(sanitize('financial@northann.com'), { x: M, y, font: fontR, size: 8, color: darkGray })
    y -= 10
    page.drawText(sanitize('www.northann.com'), { x: M, y, font: fontR, size: 8, color: darkGray })

    const lx = width - M - 120
    const ly = height - 78
    if (logoImage) {
      page.drawImage(logoImage, { x: lx, y: ly - 18, width: 120, height: 52 })
      return
    }

    page.drawEllipse({ x: lx + 18, y: ly + 18, xScale: 20, yScale: 20, borderColor: black, borderWidth: 1.2 })
    page.drawText(sanitize('n'), { x: lx + 10, y: ly + 10, font: fontB, size: 18, color: black })
    page.drawText(sanitize('northann'), { x: lx + 44, y: ly + 14, font: fontB, size: 14, color: black })
    page.drawText(sanitize('SUSTAINABLE INNOVATION'), { x: lx + 44, y: ly + 3, font: fontR, size: 5.5, color: medGray })
  }

  const startContentPage = () => {
    const page = pdfDoc.addPage([width, height])
    pages.push(page)

    drawMasthead(page)

    let y = height - 130
    page.drawText(sanitize('Purchase Order'), { x: M, y, font: fontR, size: 20, color: lightGray })
    y -= 10
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.4, color: lightGray })

    y -= 18
    page.drawText(sanitize('VENDOR'), { x: c1, y, font: fontR, size: 7, color: medGray })
    page.drawText(sanitize('SHIP TO'), { x: c2, y, font: fontR, size: 7, color: medGray })
    page.drawText(sanitize('P.O.'), { x: c3, y, font: fontR, size: 7, color: medGray })
    page.drawText(sanitize(poRef), { x: c4, y, font: fontR, size: 9, color: black })

    y -= 13
    page.drawText(sanitize(vendorName), { x: c1, y, font: fontR, size: 9, color: black })
    page.drawText(sanitize(shipTo), { x: c2, y, font: fontR, size: 9, color: black })
    page.drawText(sanitize('DATE'), { x: c3, y, font: fontR, size: 7, color: medGray })
    page.drawText(sanitize(orderDate), { x: c4, y, font: fontR, size: 9, color: black })

    y -= 13
    if (freightTerm) page.drawText(sanitize(freightTerm), { x: c1, y, font: fontR, size: 8, color: darkGray })
    if (expShipDate) {
      page.drawText(sanitize('EXP SHIP DATE'), { x: c3, y, font: fontR, size: 7, color: medGray })
      page.drawText(sanitize(formatDate(expShipDate)), { x: c4, y, font: fontR, size: 9, color: black })
    }

    y -= 22
    page.drawText(sanitize('DESTINATION'), { x: c1, y, font: fontR, size: 7, color: medGray })
    page.drawText(sanitize('PO NUMBER'), { x: c2, y, font: fontR, size: 7, color: medGray })
    y -= 13
    page.drawText(sanitize(shipTo), { x: c1, y, font: fontR, size: 9, color: black })
    page.drawText(docNumber.replace(/^0+/, ''), { x: c2, y, font: fontR, size: 9, color: black })

    y -= 22
    page.drawRectangle({ x: M, y: y - 4, width: W, height: 18, color: tableGray })
    page.drawText(sanitize('QTY'), { x: tQty, y: y + 2, font: fontB, size: 8, color: black })
    page.drawText(sanitize('PRICE/UOM'), { x: tRate, y: y + 2, font: fontB, size: 8, color: black })
    page.drawText(sanitize('AMOUNT'), { x: tAmt, y: y + 2, font: fontB, size: 8, color: black })
    page.drawText(sanitize('LOADING'), { x: tLoad, y: y + 2, font: fontB, size: 8, color: black })

    return { page, y: y - 22 }
  }

  const addPageFooter = (page: PDFPage, index: number, totalPages: number) => {
    page.drawText(sanitize(`Page ${index} of ${totalPages}`), { x: width / 2 - 26, y: 22, font: fontR, size: 8, color: medGray })
    page.drawText(sanitize('Generated: ' + generatedAt + ' PST'), { x: width - M - 160, y: 22, font: fontR, size: 7, color: medGray })
  }

  let current = startContentPage()

  for (const item of items) {
    const priceUom = item.priceUom || (item.qty > 0
      ? (item.amount / item.qty).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    const descLines = wrapText(item.description, fontR, 9, descMaxW)

    if (current.y < 170) {
      current = startContentPage()
    }

    current.page.drawText(sanitize(item.itemCode), { x: tDesc, y: current.y, font: fontB, size: 9, color: black })
    current.page.drawText(sanitize(`${item.qty.toFixed(2)}/Unit`), { x: tQty, y: current.y, font: fontR, size: 9, color: black })
    current.page.drawText(sanitize(priceUom), { x: tRate, y: current.y, font: fontR, size: 9, color: black })
    current.page.drawText(
      item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      { x: tAmt, y: current.y, font: fontR, size: 9, color: black },
    )
    current.y -= 13

    for (const line of descLines) {
      if (current.y < 110) {
        current = startContentPage()
        current.page.drawText(sanitize(`${item.itemCode} (cont.)`), { x: tDesc, y: current.y, font: fontB, size: 9, color: black })
        current.y -= 13
      }
      current.page.drawText(sanitize(line), { x: tDesc, y: current.y, font: fontR, size: 9, color: black })
      current.y -= 12
    }

    current.y -= 6
  }

  const noteLines = weightNote ? wrapText(weightNote, fontR, 6.5, 195) : []
  const footerHeight = 23 + (noteLines.length * 9) + 48 + 28
  if (current.y - footerHeight < 40) {
    current = startContentPage()
  }

  current.y -= 8
  let dx = M
  while (dx < width - M) {
    current.page.drawLine({
      start: { x: dx, y: current.y },
      end: { x: Math.min(dx + 4, width - M), y: current.y },
      thickness: 0.5,
      color: lightGray,
    })
    dx += 8
  }

  current.y -= 15
  if (weightNote) {
    let ny = current.y
    for (const line of noteLines) {
      current.page.drawText(sanitize(line), { x: M, y: ny, font: fontR, size: 6.5, color: medGray })
      ny -= 9
    }
  }

  current.page.drawText(sanitize('TOTAL'), { x: tAmt - 38, y: current.y, font: fontB, size: 9, color: black })
  const totalStr = 'USD ' + totalAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const totalW = fontB.widthOfTextAtSize(totalStr, 10)
  current.page.drawText(sanitize(totalStr), { x: width - M - totalW, y: current.y, font: fontB, size: 10, color: black })

  current.y -= 48
  current.page.drawText(sanitize('Approved By'), { x: M, y: current.y, font: fontR, size: 9, color: black })
  current.page.drawLine({ start: { x: M + 72, y: current.y - 2 }, end: { x: width - M, y: current.y - 2 }, thickness: 0.5, color: black })
  current.y -= 28
  current.page.drawText(sanitize('Date'), { x: M, y: current.y, font: fontR, size: 9, color: black })
  current.page.drawLine({ start: { x: M + 72, y: current.y - 2 }, end: { x: width - M, y: current.y - 2 }, thickness: 0.5, color: black })

  pages.forEach((page, index) => addPageFooter(page, index + 1, pages.length))

  const pdfBytes = await pdfDoc.save()
  return new Response(pdfBytes.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="PO-${docNumber}.pdf"`,
    },
  })
}

export async function GET(
  _request: Request,
  { params }: { params: { poNumber: string } }
) {
  let qbPO: Record<string, unknown> | null = null
  try {
    qbPO = await getPurchaseOrderByDocNumber(params.poNumber)
  } catch (err) {
    return new Response(`QB error: ${String(err)}`, { status: 500 })
  }
  if (!qbPO) return new Response('PO not found in QuickBooks', { status: 404 })

  return renderPurchaseOrderPdf(
    buildRenderedPOFromQB(deepSanitize(qbPO) as Record<string, unknown>, params.poNumber),
  )
}

export async function POST(
  request: Request,
  { params }: { params: { poNumber: string } }
) {
  let payload: DirectPOInput

  try {
    payload = await request.json()
  } catch {
    return new Response('Invalid PDF payload', { status: 400 })
  }

  if (!payload?.poNumber || !Array.isArray(payload.lineItems) || payload.lineItems.length === 0) {
    return new Response('Missing PO payload', { status: 400 })
  }

  return renderPurchaseOrderPdf(buildRenderedPOFromInput(payload, params.poNumber))
}
