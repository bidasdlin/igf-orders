import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { ALL_POS } from '@/lib/po-data'

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

  const navy  = rgb(0.102, 0.227, 0.361)
  const lblue = rgb(0.941, 0.961, 0.973)
  const gray  = rgb(0.5, 0.5, 0.5)
  const lgray = rgb(0.8, 0.8, 0.8)
  const black = rgb(0, 0, 0)
  const white = rgb(1, 1, 1)

  // Header band
  page.drawRectangle({ x: 0, y: height - 78, width, height: 78, color: navy })
  page.drawText('NORTHANN DISTRIBUTION CTR INC.', {
    x: 50, y: height - 38, size: 17, font: fontB, color: white,
  })
  page.drawText('Purchase Order', {
    x: 50, y: height - 60, size: 10, font: fontR, color: rgb(0.75, 0.85, 0.95),
  })
  const poLabel = `PO#  ${po.po_number}`
  const poW = fontB.widthOfTextAtSize(poLabel, 13)
  page.drawText(poLabel, { x: width - 50 - poW, y: height - 48, size: 13, font: fontB, color: white })

  // Info section
  let y = height - 110
  const drawField = (label: string, value: string, x: number, lw = 95) => {
    page.drawText(label, { x, y, size: 8.5, font: fontB, color: gray })
    page.drawText(value, { x: x + lw, y, size: 8.5, font: fontR, color: black })
  }
  drawField('Date:', po.order_date, 50, 40)
  drawField('Branch:', po.branch, 300, 55)
  y -= 16
  drawField('Vendor:', po.vendor, 50)
  drawField('Freight Terms:', po.freight_term, 300, 100)
  y -= 22
  page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 0.5, color: lgray })
  y -= 4

  // Table header
  const TH = y - 20
  page.drawRectangle({ x: 50, y: TH - 4, width: 512, height: 21, color: lblue })
  const C = { qty: 58, code: 105, desc: 225, amt: 480 }
  const dTH = (text: string, x: number) =>
    page.drawText(text, { x, y: TH, size: 8, font: fontB, color: navy })
  dTH('QTY', C.qty); dTH('ITEM CODE', C.code); dTH('DESCRIPTION', C.desc); dTH('AMOUNT', C.amt)
  y = TH - 22

  // Line items
  for (const item of po.items) {
    page.drawText(String(item.qty), { x: C.qty, y, size: 9, font: fontR, color: black })
    page.drawText(item.item_code, { x: C.code, y, size: 9, font: fontR, color: black })
    const words = item.description.split(' ')
    let line = ''
    let lineY = y
    for (const w of words) {
      const test = line ? `${line} ${w}` : w
      if (fontR.widthOfTextAtSize(test, 9) > 250 && line) {
        page.drawText(line, { x: C.desc, y: lineY, size: 9, font: fontR, color: black })
        lineY -= 13; line = w
      } else { line = test }
    }
    if (line) page.drawText(line, { x: C.desc, y: lineY, size: 9, font: fontR, color: black })
    const amtStr = '$' + po.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })
    const amtW = fontR.widthOfTextAtSize(amtStr, 9)
    page.drawText(amtStr, { x: C.amt + 72 - amtW, y, size: 9, font: fontR, color: black })
    y -= 30
  }

  // Total
  y += 12
  page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 0.5, color: lgray })
  y -= 22
  const totalStr = '$' + po.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })
  const totalW = fontB.widthOfTextAtSize(totalStr, 12)
  const labelW = fontB.widthOfTextAtSize('TOTAL:  ', 12)
  page.drawText('TOTAL:', { x: C.amt + 72 - totalW - labelW, y, size: 12, font: fontB, color: navy })
  page.drawText(totalStr, { x: C.amt + 72 - totalW, y, size: 12, font: fontB, color: navy })

  // Footer
  page.drawLine({ start: { x: 50, y: 44 }, end: { x: 562, y: 44 }, thickness: 0.5, color: lgray })
  const footer = 'This is a computer-generated purchase order. No signature required.'
  const footW = fontR.widthOfTextAtSize(footer, 7.5)
  page.drawText(footer, { x: (width - footW) / 2, y: 28, size: 7.5, font: fontR, color: gray })

  const pdfBytes = await pdfDoc.save()
  return new Response(pdfBytes.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="PO-${po.po_number}.pdf"`,
    },
  })
}
