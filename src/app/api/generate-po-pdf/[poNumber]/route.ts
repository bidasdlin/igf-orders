import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib'
import { getPurchaseOrderByDocNumber } from '@/lib/quickbooks'

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

function parseQBDescription(desc: string): { qty: number; itemCode: string; description: string } {
  const dashIdx = desc.indexOf(' — ')
  const header = dashIdx >= 0 ? desc.substring(0, dashIdx) : desc
  const description = dashIdx >= 0 ? desc.substring(dashIdx + 3) : ''
  const parts = header.trim().split(' ')
  const qty = parseInt(parts[0]) || 0
  const itemCode = parts[2] ?? ''
  return { qty, itemCode, description }
}

function getVendorCode(vendorName: string): string {
  const skip = new Set(['inc', 'ind', 'co', 'corp', 'ltd', 'llc', 'company', 'international', 'group'])
  return vendorName.split(/\s+/)
    .filter(w => w.length > 0 && !skip.has(w.toLowerCase()))
    .map(w => w[0].toUpperCase())
    .join('')
}

function parseMemo(memo: string) {
  const branch = memo.match(/NDC Branch:\s*([A-Z]+)/i)?.[1] ?? ''
  const freightTerm = memo.match(/(?:Frt Term|Freight Term):\s*([A-Z]+-[A-Z]+)/i)?.[1]
    ?? memo.match(/\b(DDP|FOB|CIF|CFR|FCA|CPT|CIP|DAP|DPU|EXW)-[A-Z]+\b/i)?.[0]
    ?? ''
  if (branch || freightTerm) return { branch, freightTerm }

  const shipToM = memo.match(/[Ss]hip to:\s*([^|]+)/i)
  if (shipToM) {
    const shipToFull = shipToM[1].trim()
    const branchMap: Record<string, string> = {
      'Los Angeles': 'LA', 'Savannah': 'SAV', 'Houston': 'HOU',
      'New York': 'NY', 'Newark': 'NE', 'Portland': 'VANC',
      'Seattle': 'SEA', 'Norfolk': 'NOR',
    }
    let derivedBranch = ''
    for (const key of Object.keys(branchMap)) {
      if (shipToFull.includes(key)) { derivedBranch = branchMap[key]; break }
    }
    return { branch: derivedBranch, freightTerm }
  }
  return { branch: '', freightTerm: '' }
}

function formatDate(txnDate: string): string {
  const [y, m, d] = txnDate.split('-')
  if (!y || !m || !d) return txnDate
  return `${m}/${d}/${y.slice(2)}`
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

  // Deep-sanitize all string fields from QB before PDF generation
  function deepSanitize(obj: unknown): unknown {
    if (typeof obj === 'string') return sanitize(obj)
    if (Array.isArray(obj)) return obj.map(deepSanitize)
    if (obj && typeof obj === 'object') {
      const r: Record<string, unknown> = {}
      for (const k of Object.keys(obj as object)) r[k] = deepSanitize((obj as Record<string,unknown>)[k])
      return r
    }
    return obj
  }
  qbPO = deepSanitize(qbPO) as Record<string, unknown>

  type VendorRef = { name?: string }
  const vendorName = (qbPO.VendorRef as VendorRef)?.name ?? 'Unknown Vendor'
  const txnDate = (qbPO.TxnDate as string) ?? ''
  const orderDate = formatDate(txnDate)
  const docNumber = (qbPO.DocNumber as string) ?? params.poNumber
  const memo = (qbPO.Memo as string) ?? ''
  const totalAmt = (qbPO.TotalAmt as number) ?? 0
  const { branch, freightTerm } = parseMemo(memo)

  type QBLine = { DetailType?: string; Description?: string; Amount?: number }
  const rawLines = ((qbPO.Line as QBLine[]) ?? []).filter(l => l.DetailType !== 'SubTotalLine')
  const items = rawLines.map(l => {
    const parsed = parseQBDescription(l.Description ?? '')
    return {
      qty: parsed.qty,
      itemCode: parsed.itemCode,
      description: parsed.description,
      amount: l.Amount ?? 0,
    }
  })

  const portMap: Record<string, string> = {
    LA: 'Port of Los Angeles, CA', SAV: 'Port of Savannah, GA',
    HOU: 'Port of Houston, TX', NY: 'Port of New York, NJ',
    XA: 'Port of Savannah, GA', TEXAS: 'Port of Houston, TX',
    NE: 'Port of Newark, NJ', VANC: 'Port of Portland, OR',
    NOR: 'Port of Norfolk, VA', SEA: 'Port of Seattle, WA',
  }
  const shipTo = portMap[branch] ?? branch

  const weightMap: Record<string, string> = {
    LA: 'MAXIMUM WEIGHT TO LOS ANGELES IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US REGARDING REDUCING WEIGHT ON THE CONTAINER',
    SAV: 'MAXIMUM WEIGHT TO SAVANNAH IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
    XA: 'MAXIMUM WEIGHT TO SAVANNAH IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
    HOU: 'MAXIMUM WEIGHT TO HOUSTON IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
    TEXAS: 'MAXIMUM WEIGHT TO HOUSTON IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
    NY: 'MAXIMUM WEIGHT TO NEW YORK IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
    NE: 'MAXIMUM WEIGHT TO NEW YORK IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
  }
  const weightNote = weightMap[branch] ?? ''

  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([612, 792])
  const { width, height } = page.getSize()

  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const black = rgb(0, 0, 0)
  const darkGray = rgb(0.25, 0.25, 0.25)
  const medGray = rgb(0.5, 0.5, 0.5)
  const lightGray = rgb(0.78, 0.78, 0.78)
  const tableGray = rgb(0.88, 0.88, 0.88)

  const M = 45
  const W = width - M * 2

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
  try {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 5000)
    const logoRes = await fetch('https://dl.dropboxusercontent.com/scl/fi/96dazjf2coj8wd2yk97x1/logo-northann.jpg?rlkey=h2yzlac1rbxuzc38fomax8wk2', { signal: ctrl.signal })
    if (logoRes.ok) {
      const logoBytes = await logoRes.arrayBuffer()
      const logoImage = await pdfDoc.embedJpg(logoBytes)
      page.drawImage(logoImage, { x: lx, y: ly - 18, width: 120, height: 52 })
    } else { throw new Error('logo') }
  } catch (_e) {
    page.drawEllipse({ x: lx + 18, y: ly + 18, xScale: 20, yScale: 20, borderColor: black, borderWidth: 1.2 })
    page.drawText(sanitize('n'), { x: lx + 10, y: ly + 10, font: fontB, size: 18, color: black })
    page.drawText(sanitize('northann'), { x: lx + 44, y: ly + 14, font: fontB, size: 14, color: black })
    page.drawText(sanitize('SUSTAINABLE INNOVATION'), { x: lx + 44, y: ly + 3, font: fontR, size: 5.5, color: medGray })
  }

  y = height - 130
  page.drawText(sanitize('Purchase Order'), { x: M, y, font: fontR, size: 20, color: lightGray })
  y -= 10
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.4, color: lightGray })

  y -= 18
  const c1 = M, c2 = M + 180, c3 = M + 380, c4 = M + 420

  page.drawText(sanitize('VENDOR'), { x: c1, y, font: fontR, size: 7, color: medGray })
  page.drawText(sanitize('SHIP TO'), { x: c2, y, font: fontR, size: 7, color: medGray })
  page.drawText(sanitize('P.O.'), { x: c3, y, font: fontR, size: 7, color: medGray })
  const poRef = getVendorCode(vendorName) + '-IGF-' + docNumber.replace(/^0+/, '')
  page.drawText(sanitize(poRef), { x: c4, y, font: fontR, size: 9, color: black })

  y -= 13
  page.drawText(sanitize(vendorName), { x: c1, y, font: fontR, size: 9, color: black })
  page.drawText(sanitize(shipTo), { x: c2, y, font: fontR, size: 9, color: black })
  page.drawText(sanitize('DATE'), { x: c3, y, font: fontR, size: 7, color: medGray })
  page.drawText(sanitize(orderDate), { x: c4, y, font: fontR, size: 9, color: black })

  y -= 13
  if (freightTerm) page.drawText(sanitize(freightTerm), { x: c1, y, font: fontR, size: 8, color: darkGray })

  y -= 22
  page.drawText(sanitize('DESTINATION'), { x: c1, y, font: fontR, size: 7, color: medGray })
  page.drawText(sanitize('PO NUMBER'), { x: c2, y, font: fontR, size: 7, color: medGray })
  y -= 13
  page.drawText(sanitize(shipTo), { x: c1, y, font: fontR, size: 9, color: black })
  page.drawText(docNumber.replace(/^0+/, ''), { x: c2, y, font: fontR, size: 9, color: black })

  y -= 22
  page.drawRectangle({ x: M, y: y - 4, width: W, height: 18, color: tableGray })

  const tDesc = M, tQty = M + 258, tRate = M + 328, tAmt = M + 398, tLoad = M + 472

  page.drawText(sanitize('QTY'), { x: tQty, y: y + 2, font: fontB, size: 8, color: black })
  page.drawText(sanitize('RATE'), { x: tRate, y: y + 2, font: fontB, size: 8, color: black })
  page.drawText(sanitize('AMOUNT'), { x: tAmt, y: y + 2, font: fontB, size: 8, color: black })
  page.drawText(sanitize('LOADING'), { x: tLoad, y: y + 2, font: fontB, size: 8, color: black })

  y -= 22

  const descMaxW = 248
  for (const item of items) {
    const rate = item.qty > 0 ? item.amount / item.qty : 0
    page.drawText(sanitize(item.itemCode), { x: tDesc, y, font: fontB, size: 9, color: black })
    page.drawText(sanitize(`${item.qty.toFixed(2)}/Unit`), { x: tQty, y, font: fontR, size: 9, color: black })
    page.drawText(rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      { x: tRate, y, font: fontR, size: 9, color: black }
    )
    page.drawText(item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      { x: tAmt, y, font: fontR, size: 9, color: black }
    )
    y -= 13
    const descLines = wrapText(item.description, fontR, 9, descMaxW)
    for (const line of descLines) {
      page.drawText(sanitize(line), { x: tDesc, y, font: fontR, size: 9, color: black })
      y -= 12
    }
    y -= 6
  }

  y -= 8
  let dx = M
  while (dx < width - M) {
    page.drawLine({ start: { x: dx, y }, end: { x: Math.min(dx + 4, width - M), y }, thickness: 0.5, color: lightGray })
    dx += 8
  }

  y -= 15
  if (weightNote) {
    const noteLines = wrapText(weightNote, fontR, 6.5, 195)
    let ny = y
    for (const line of noteLines) {
      page.drawText(sanitize(line), { x: M, y: ny, font: fontR, size: 6.5, color: medGray })
      ny -= 9
    }
  }

  page.drawText(sanitize('TOTAL'), { x: tAmt - 38, y, font: fontB, size: 9, color: black })
  const totalStr = 'USD ' + totalAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const totalW = fontB.widthOfTextAtSize(totalStr, 10)
  page.drawText(sanitize(totalStr), { x: width - M - totalW, y, font: fontB, size: 10, color: black })

  y -= 48
  page.drawText(sanitize('Approved By'), { x: M, y, font: fontR, size: 9, color: black })
  page.drawLine({ start: { x: M + 72, y: y - 2 }, end: { x: width - M, y: y - 2 }, thickness: 0.5, color: black })
  y -= 28
  page.drawText(sanitize('Date'), { x: M, y, font: fontR, size: 9, color: black })
  page.drawLine({ start: { x: M + 72, y: y - 2 }, end: { x: width - M, y: y - 2 }, thickness: 0.5, color: black })

  page.drawText(sanitize('Page 1 of 1'), { x: width / 2 - 26, y: 22, font: fontR, size: 8, color: medGray })
  const genTime = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: '2-digit', day: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  page.drawText(sanitize('Generated: ' + genTime + ' PST'), { x: width - M - 160, y: 22, font: fontR, size: 7, color: medGray })

  const pdfBytes = await pdfDoc.save()
  return new Response(pdfBytes.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="PO-${docNumber}.pdf"`,
    },
  })
}
