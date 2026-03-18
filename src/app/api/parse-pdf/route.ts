import { NextRequest, NextResponse } from 'next/server'
import pdfParse from 'pdf-parse'

export const runtime = 'nodejs'
export const maxDuration = 30

// NDC PDFs have duplicated text (e.g. "04/22/2604/22/26"), deduplicate repeated values
function dedup(val: string): string {
  const half = Math.floor(val.length / 2)
  if (val.length % 2 === 0 && val.slice(0, half) === val.slice(half)) return val.slice(0, half)
  return val
}

function parseDate(d: string): string {
  try {
    const parts = d.split('/')
    if (parts.length === 3) {
      const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2]
      return `${y}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
    }
  } catch {}
  return new Date().toISOString().split('T')[0]
}

function extractPOData(text: string, fileName: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // ── PO Number ──────────────────────────────────────────
  let poNumber = ''
  const poIdx = lines.findIndex(l => l.match(/PURCHASE\s*ORDER/i))
  if (poIdx >= 0 && lines[poIdx + 1]) {
    poNumber = lines[poIdx + 1].trim()
  }
  if (!poNumber) {
    const m = text.match(/\n([X]?\d{7,10})\n/)
    if (m) poNumber = m[1]
  }
  if (!poNumber) {
    poNumber = fileName.replace('Purchase Order', '').replace('.pdf', '').trim()
  }

  // ── Vendor (mfg line) ──────────────────────────────────
  let vendorName = ''
  const mfgLine = lines.find(l => l.toLowerCase().startsWith('mfg '))
  if (mfgLine) vendorName = mfgLine.replace(/^mfg\s+/i, '').trim()

  // ── Ship To ────────────────────────────────────────────
  let shipTo = ''
  const portMatch = text.match(/Port of ([^\n]+)/i)
  if (portMatch) {
    shipTo = `Port of ${portMatch[1].trim()}`
  } else {
    const shipIdx = lines.findIndex(l => l.match(/Ship To:/i))
    if (shipIdx >= 0 && lines[shipIdx + 1]) shipTo = lines[shipIdx + 1].trim()
    if (!shipTo || shipTo.length < 3) {
      const cityMatch = text.match(/(Savannah|Portland|Los Angeles|Newark|Seattle|Houston|Norfolk),\s*([A-Z]{2})/i)
      if (cityMatch) shipTo = `${cityMatch[1]}, ${cityMatch[2]}`
    }
  }

  // ── Order Date ─────────────────────────────────────────
  let orderDate = ''
  const rawDate = text.match(/Order Date:\s*\n*(\d{2}\/\d{2}\/\d{2,4}(?:\d{2}\/\d{2}\/\d{2,4})?)/i)
  if (rawDate) {
    const raw = rawDate[1]
    const single = raw.match(/(\d{2}\/\d{2}\/\d{2,4})/)?.[1] || raw
    orderDate = parseDate(single)
  } else {
    const anyDate = text.match(/(\d{2}\/\d{2}\/\d{2,4})/)
    if (anyDate) orderDate = parseDate(anyDate[1])
    else orderDate = new Date().toISOString().split('T')[0]
  }

  // ── Total Amount ───────────────────────────────────────
  let totalAmount = 0
  const totalMatch = text.match(/Total\s+\$?([\d,]+\.?\d*)\$?([\d,]+\.?\d*)/i)
  if (totalMatch) {
    const raw = totalMatch[1].replace(',', '')
    totalAmount = parseFloat(raw) || 0
  }

  // ── Line Items ─────────────────────────────────────────
  const lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }> = []
  const itemPattern = /(\d+)\s+UNIT\s+(\w+)\s+([\d,]+\.?\d*)\/([\d,]+\.?\d*)\/\w+\s+([\d,]+\.?\d*)([\d,]+\.?\d*)/g
  let match

  while ((match = itemPattern.exec(text)) !== null) {
    const qty = parseInt(match[1])
    const amount = parseFloat(match[5].replace(',', ''))
    const unitPrice = qty > 0 ? parseFloat((amount / qty).toFixed(2)) : 0
    const afterMatch = text.substring(match.index + match[0].length)
    // Capture ALL spec lines until next item / TOTAL / end of section
    const specLines: string[] = []
    for (const ln of afterMatch.split('\n')) {
      const t = ln.trim()
      if (!t) continue
      if (t.match(/^\d+\s+UNIT/i) || t.match(/^(TOTAL|APPROVED|AUTHORIZED|Page)/i)) break
      specLines.push(t)
    }
    const itemCode = match[2]
    const specBody = specLines.join('\n')
    const description = specBody
      ? `${qty} Units ${itemCode} — ${specBody}`
      : `${qty} Units ${itemCode} — Qty: ${qty}`
    lineItems.push({ description, quantity: qty, unitPrice, amount })
  }

  if (lineItems.length === 0 && totalAmount > 0) {
    lineItems.push({
      description: 'Refer to attached PO for line item details',
      quantity: 1,
      unitPrice: totalAmount,
      amount: totalAmount,
    })
  }

  // ── Notes ──────────────────────────────────────────────
  let notes = ''
  const maxWeightMatch = text.match(/(MAXIMUM WEIGHT[^\n]+)/i)
  if (maxWeightMatch) notes = maxWeightMatch[1].trim()

  return {
    poNumber,
    vendorName: vendorName || 'Unknown Vendor',
    shipTo: shipTo || '',
    date: orderDate,
    lineItems,
    totalAmount,
    notes,
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file || file.type !== 'application/pdf') {
      return NextResponse.json({ success: false, error: 'A PDF file is required' }, { status: 400 })
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'File too large (max 5 MB)' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await pdfParse(buffer)
    const po = extractPOData(parsed.text, file.name)

    return NextResponse.json({ success: true, po })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[parse-pdf]', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
