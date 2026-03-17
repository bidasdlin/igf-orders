import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib'
import { ALL_POS } from '@/lib/po-data'

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
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
  return lines
}

export async function GET(
  _request: Request,
  { params }: { params: { poNumber: string } }
) {
  const po = ALL_POS.find(p => p.po_number === params.poNumber)
  if (!po) return new Response('PO not found', { status: 404 })

  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([612, 792])
  const { width, height } = page.getSize()

  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const black     = rgb(0, 0, 0)
  const darkGray  = rgb(0.25, 0.25, 0.25)
  const medGray   = rgb(0.5, 0.5, 0.5)
  const lightGray = rgb(0.78, 0.78, 0.78)
  const tableGray = rgb(0.88, 0.88, 0.88)

  const M = 45
  const W = width - M * 2

  const portMap: Record<string, string> = {
    LA:  'Port of Los Angeles, CA',
    SAV: 'Port of Savannah, GA',
    HOU: 'Port of Houston, TX',
    NY:  'Port of New York, NJ',
  }
  const shipTo = portMap[po.branch] ?? po.branch

  const weightMap: Record<string, string> = {
    LA:  'MAXIMUM WEIGHT TO LOS ANGELES IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US REGARDING REDUCING WEIGHT ON THE CONTAINER',
    SAV: 'MAXIMUM WEIGHT TO SAVANNAH IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
    HOU: 'MAXIMUM WEIGHT TO HOUSTON IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
    NY:  'MAXIMUM WEIGHT TO NEW YORK IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
  }
  const weightNote = weightMap[po.branch] ?? ''

  // ── HEADER ──────────────────────────────────────────────
  let y = height - 48
  page.drawText('NORTHANN DISTRIBUTION CENTER', { x: M, y, font: fontB, size: 10, color: black })
  y -= 13
  page.drawText('INC.', { x: M, y, font: fontB, size: 10, color: black })
  y -= 13
  page.drawText('9820 Dino Dr Ste 110 Elk Grove, CA 95624', { x: M, y, font: fontR, size: 8, color: darkGray })
  y -= 10
  page.drawText('financial@northann.com', { x: M, y, font: fontR, size: 8, color: darkGray })
  y -= 10
  page.drawText('www.northann.com', { x: M, y, font: fontR, size: 8, color: darkGray })

  // Northann logo (right side)
  const lx = width - M - 120
  const ly = height - 78
  // Circle outline
  page.drawEllipse({ x: lx + 18, y: ly + 18, xScale: 20, yScale: 20, borderColor: black, borderWidth: 1.2 })
  // "n" inside circle
  page.drawText('n', { x: lx + 10, y: ly + 10, font: fontB, size: 18, color: black })
  // "northann" to the right
  page.drawText('northann', { x: lx + 44, y: ly + 14, font: fontB, size: 14, color: black })
  page.drawText('SUSTAINABLE INNOVATION', { x: lx + 44, y: ly + 3, font: fontR, size: 5.5, color: medGray })

  // ── TITLE ────────────────────────────────────────────────
  y = height - 130
  page.drawText('Purchase Order', { x: M, y, font: fontR, size: 20, color: lightGray })
  y -= 10
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.4, color: lightGray })

  // ── INFO GRID ────────────────────────────────────────────
  y -= 18
  const c1 = M
  const c2 = M + 180
  const c3 = M + 380
  const c4 = M + 420

  // Row 1: labels + P.O. value
  page.drawText('VENDOR',  { x: c1, y, font: fontR, size: 7, color: medGray })
  page.drawText('SHIP TO', { x: c2, y, font: fontR, size: 7, color: medGray })
  page.drawText('P.O.',    { x: c3, y, font: fontR, size: 7, color: medGray })
  const poRef = 'NDC-IGF-' + po.po_number.replace(/^0+/, '')
  page.drawText(poRef, { x: c4, y, font: fontR, size: 9, color: black })

  y -= 13
  page.drawText(po.vendor,     { x: c1, y, font: fontR, size: 9, color: black })
  page.drawText(shipTo,        { x: c2, y, font: fontR, size: 9, color: black })
  page.drawText('DATE',        { x: c3, y, font: fontR, size: 7, color: medGray })
  page.drawText(po.order_date, { x: c4, y, font: fontR, size: 9, color: black })

  y -= 13
  page.drawText(po.freight_term, { x: c1, y, font: fontR, size: 8, color: darkGray })

  y -= 22
  page.drawText('DESTINATION', { x: c1, y, font: fontR, size: 7, color: medGray })
  page.drawText('PO NUMBER',   { x: c2, y, font: fontR, size: 7, color: medGray })
  y -= 13
  page.drawText(shipTo, { x: c1, y, font: fontR, size: 9, color: black })
  page.drawText(po.po_number.replace(/^0+/, ''), { x: c2, y, font: fontR, size: 9, color: black })

  // ── TABLE ────────────────────────────────────────────────
  y -= 22
  const rowH = 18
  page.drawRectangle({ x: M, y: y - 4, width: W, height: rowH, color: tableGray })

  const tDesc = M
  const tQty  = M + 258
  const tRate = M + 328
  const tAmt  = M + 398
  const tLoad = M + 472

  page.drawText('QTY',     { x: tQty,  y: y + 2, font: fontB, size: 8, color: black })
  page.drawText('RATE',    { x: tRate, y: y + 2, font: fontB, size: 8, color: black })
  page.drawText('AMOUNT',  { x: tAmt,  y: y + 2, font: fontB, size: 8, color: black })
  page.drawText('LOADING', { x: tLoad, y: y + 2, font: fontB, size: 8, color: black })

  y -= 22
  const descMaxW = 248
  const singleItem = po.items.length === 1

  for (const item of po.items) {
    const rate   = singleItem ? po.total_amount / item.qty : 0
    const amount = singleItem ? po.total_amount : 0

    // item code + numeric cols on first line
    page.drawText(item.item_code, { x: tDesc, y, font: fontB, size: 9, color: black })
    page.drawText(`${item.qty.toFixed(2)}/Unit`, { x: tQty, y, font: fontR, size: 9, color: black })
    if (singleItem) {
      page.drawText(
        rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        { x: tRate, y, font: fontR, size: 9, color: black }
      )
      page.drawText(
        amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        { x: tAmt, y, font: fontR, size: 9, color: black }
      )
    }
    y -= 13

    // description lines (word-wrapped under item code)
    const descLines = wrapText(item.description, fontR, 9, descMaxW)
    for (const line of descLines) {
      page.drawText(line, { x: tDesc, y, font: fontR, size: 9, color: black })
      y -= 12
    }
    y -= 6
  }

  // ── FOOTER SEPARATOR ─────────────────────────────────────
  y -= 8
  let dx = M
  while (dx < width - M) {
    page.drawLine({
      start: { x: dx, y }, end: { x: Math.min(dx + 4, width - M), y },
      thickness: 0.5, color: lightGray
    })
    dx += 8
  }

  y -= 15
  // Weight note (left, small)
  if (weightNote) {
    const noteLines = wrapText(weightNote, fontR, 6.5, 195)
    let ny = y
    for (const line of noteLines) {
      page.drawText(line, { x: M, y: ny, font: fontR, size: 6.5, color: medGray })
      ny -= 9
    }
  }

  // TOTAL label
  page.drawText('TOTAL', { x: tAmt - 38, y, font: fontB, size: 9, color: black })

  // USD total (right-aligned)
  const totalStr = 'USD ' + po.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const totalW = fontB.widthOfTextAtSize(totalStr, 10)
  page.drawText(totalStr, { x: width - M - totalW, y, font: fontB, size: 10, color: black })

  // ── SIGNATURES ───────────────────────────────────────────
  y -= 48
  page.drawText('Approved By', { x: M, y, font: fontR, size: 9, color: black })
  page.drawLine({ start: { x: M + 72, y: y - 2 }, end: { x: width - M, y: y - 2 }, thickness: 0.5, color: black })

  y -= 28
  page.drawText('Date', { x: M, y, font: fontR, size: 9, color: black })
  page.drawLine({ start: { x: M + 72, y: y - 2 }, end: { x: width - M, y: y - 2 }, thickness: 0.5, color: black })

  // Page number
  page.drawText('Page 1 of 1', { x: width / 2 - 26, y: 22, font: fontR, size: 8, color: medGray })

  const pdfBytes = await pdfDoc.save()
  return new Response(pdfBytes.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="PO-${po.po_number}.pdf"`,
    },
  })
}
