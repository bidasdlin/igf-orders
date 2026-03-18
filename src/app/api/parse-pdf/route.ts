import { NextRequest, NextResponse } from 'next/server'
import pdfParse from 'pdf-parse'

export const runtime = 'nodejs'
export const maxDuration = 30

// IGF PDFs store ASCII characters as 2-byte big-endian Unicode (wide chars).
// e.g., 'N' (0x4E) -> U+4E00, 'Total' -> garbled CJK, '$' -> U+2400
// Decode by extracting the high byte when the low byte is 0x00.
function decodeWideChars(text: string): string {
  return text.replace(/[\u2000-\uFFFF]/g, (char) => {
    const code = char.charCodeAt(0)
    const lo = code & 0xFF
    if (lo === 0) {
      const ascii = (code >> 8) & 0xFF
      if (ascii >= 0x20 && ascii <= 0x7E) {
        return String.fromCharCode(ascii)
      }
    }
    return char
  })
}

// NDC PDFs have duplicated text (e.g. "04/22/2604/22/26"), deduplicate repeated values
function dedup(val: string): string {
  const half = Math.floor(val.length / 2)
  if (val.length % 2 === 0 && val.slice(0, half) === val.slice(half)) return val.slice(0, half)
  return val
}

function parseDate(d: string): string {
  try {
    // IGF PDFs: slashes come out as 'N' (e.g. "03N12N26"). Normalize to '/'.
    const normalized = d.replace(/N/g, '/')
    const parts = normalized.split('/')
    if (parts.length === 3) {
      const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2]
      return `${y}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
    }
  } catch {}
  return new Date().toISOString().split('T')[0]
}

function extractPOData(text: string, fileName: string) {
  // Decode IGF's wide-char encoding first so all patterns work correctly
  text = decodeWideChars(text)

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
    // Use filename
    poNumber = fileName.replace('Purchase Order', '').replace('.pdf', '').trim()
  }

  // ── Vendor (mfg line) ──────────────────────────────────
  let vendorName = ''
  const mfgLine = lines.find(l => l.toLowerCase().startsWith('mfg '))
  if (mfgLine) vendorName = mfgLine.replace(/^mfg\s+/i, '').trim()
  if (!vendorName) {
    const mfgMatch = text.match(/mfg\s+([^\n]+)/i)
    if (mfgMatch) vendorName = mfgMatch[1].trim()
  }

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
  // IGF PDFs: slashes appear as 'N', values are duplicated: "03N12N2603N12N26"
  const rawDate = text.match(/Order Date:\s*\n*(\d{2}[\/N]\d{2}[\/N]\d{2,4})/i)
  if (rawDate) {
    orderDate = parseDate(rawDate[1])
  } else {
    const anyDate = text.match(/(\d{2}[\/N]\d{2}[\/N]\d{2,4})/)
    if (anyDate) orderDate = parseDate(anyDate[1])
    else orderDate = new Date().toISOString().split('T')[0]
  }

  // ── Total Amount ───────────────────────────────────────
  let totalAmount = 0
  // Pattern: "Total $16,956.67$16,956.67" (duplicated in IGF PDFs)
  const totalMatch = text.match(/Total\s+\$?([\d,]+\.?\d*)\$?([\d,]+\.?\d*)/i)
  if (totalMatch) {
    const raw = totalMatch[1].replace(/,/g, '')
    totalAmount = parseFloat(raw) || 0
  }

  // ── Line Items ─────────────────────────────────────────
  const lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }> = []
  let match

  // IGF format after decode: "1414UNIT  AWB2520TE1,081.42N...16,956.67UNIT14.00N"
  // QTY appears doubled because QUANTITY and TOTAL QUANTITY columns are merged.
  // Item code is followed immediately by a comma-separated price (e.g. "1,081.42").
  // Use [^\s,]+ to stop at the comma, then trim trailing digits from merged data.
  const igfPattern = /^(\d+)\s*UNIT\s+([^\s,]+)/gm
  igfPattern.lastIndex = 0
  let foundIGF = false

  while ((match = igfPattern.exec(text)) !== null) {
    // Handle doubled quantity (QUANTITY + TOTAL QUANTITY merged, e.g. "1414" -> 14)
    let qty: number
    const rawQty = match[1]
    const mid = Math.floor(rawQty.length / 2)
    if (rawQty.length >= 2 && rawQty.length % 2 === 0 && rawQty.slice(0, mid) === rawQty.slice(mid)) {
      qty = parseInt(rawQty.slice(0, mid))
    } else {
      qty = parseInt(rawQty)
    }

    // Clean up item code: strip trailing digits merged from price column, then keep alphanumeric
    const rawCode = match[2].replace(/\d+$/, '')
    const itemCode = rawCode.replace(/[^A-Z0-9]/gi, '') || rawCode

    // Get the full line text to extract price
    const lineEnd = text.indexOf('\n', match.index)
    const lineText = text.substring(match.index, lineEnd > 0 ? lineEnd : text.length)

    // Amount: for IGF POs the document-level total IS the line item total.
    // The per-item total in the merged column data is unreliable due to column merging.
    const amount = totalAmount

    // Unit price: look for "14.00N" or "14.00/" pattern in the line
    // Take the last match (the per-unit price, not the per-MSF price)
    const priceMatches = lineText.match(/(\d+\.\d{2})[N\/]/g)
    const lastPrice = priceMatches ? priceMatches[priceMatches.length - 1] : null
    const priceMatch = lastPrice ? lastPrice.match(/(\d+\.\d{2})/) : null
    const unitPrice = priceMatch
      ? parseFloat(priceMatch[1])
      : (qty > 0 ? parseFloat((amount / qty).toFixed(2)) : 0)

    // Spec lines BEFORE the item (from ITEM/DESCRIPTION header onwards)
    const textBefore = text.substring(0, match.index)
    const headerIdx = Math.max(
      textBefore.lastIndexOf('ITEMNDESCRIPTION'),
      textBefore.lastIndexOf('ITEM/DESCRIPTION'),
      textBefore.lastIndexOf('ITEMDESCRIPTION'),
    )
    const preSpec: string[] = []
    if (headerIdx >= 0) {
      for (const ln of textBefore.substring(headerIdx + 16).split('\n')) {
        const t = ln.trim()
        if (!t || t.match(/^(QUANTITY|UOM|PRICE|AMOUNT|TOTAL|ITEM)/i)) continue
        preSpec.push(t)
      }
    }

    // Spec lines AFTER the item (until Subtotal / MAXIMUM / next item)
    const afterMatch = text.substring(match.index + match[0].length)
    const postSpec: string[] = []
    for (const ln of afterMatch.split('\n')) {
      const t = ln.trim()
      if (!t) continue
      if (t.match(/^(Subtotal|MAXIMUM|TOTAL|APPROVED|AUTHORIZED|Page)/i)) break
      if (t.match(/^\d+\s*UNIT\s+[A-Z]/)) break
      // Skip lines that are only numbers/prices
      if (t.match(/^[\d,\.\s\$]+$/)) continue
      postSpec.push(t)
    }

    const specBody = [...preSpec, ...postSpec].join('\n')
    const description = specBody
      ? `${qty} Units ${itemCode} — ${specBody}`
      : `${qty} Units ${itemCode}`

    lineItems.push({ description, quantity: qty, unitPrice, amount })
    foundIGF = true
  }

  // UFP/Northann output format fallback: "{itemCode} {price}/Unit {qty} {total}"
  if (!foundIGF) {
    const ufpPattern = /^([A-Z][A-Z0-9]+)\s+([\d,]+\.?\d*)\/[Uu]nit\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/gm
    ufpPattern.lastIndex = 0
    while ((match = ufpPattern.exec(text)) !== null) {
      const itemCode = match[1]
      const unitPrice = parseFloat(match[2].replace(/,/g, ''))
      const qty = parseFloat(match[3].replace(/,/g, ''))
      const amount = parseFloat(match[4].replace(/,/g, ''))
      const afterMatch = text.substring(match.index + match[0].length)
      const specLines: string[] = []
      for (const ln of afterMatch.split('\n')) {
        const t = ln.trim()
        if (!t) continue
        if (t.match(/^[A-Z][A-Z0-9]+\s+[\d,]+\.?\d*\/[Uu]nit/) || t.match(/^(TOTAL|APPROVED|AUTHORIZED|Page|MAXIMUM)/i)) break
        specLines.push(t)
      }
      const specBody = specLines.join('\n')
      const description = specBody
        ? `${qty} Units ${itemCode} — ${specBody}`
        : `${qty} Units ${itemCode}`
      lineItems.push({ description, quantity: qty, unitPrice, amount })
    }
  }

  // Fallback: if no line items parsed, create one from total
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
