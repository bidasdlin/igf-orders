import { NextRequest, NextResponse } from 'next/server'
import pdfParse from 'pdf-parse'

export const runtime = 'nodejs'
export const maxDuration = 30

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

function dedup(val: string): string {
  const half = Math.floor(val.length / 2)
  if (val.length % 2 === 0 && val.slice(0, half) === val.slice(half))
    return val.slice(0, half)
  return val
}

function parseDate(d: string): string {
  try {
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
  text = decodeWideChars(text)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // PO Number extraction
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

  // Vendor extraction
  let vendorName = ''
  const mfgLine = lines.find(l => l.toLowerCase().startsWith('mfg '))
  if (mfgLine) vendorName = mfgLine.replace(/^mfg\s+/i, '').trim()
  if (!vendorName) {
    const mfgMatch = text.match(/mfg\s+([^\n]+)/i)
    if (mfgMatch) vendorName = mfgMatch[1].trim()
  }

  // Ship To extraction
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

  // Order Date extraction
  let orderDate = ''
  const rawDate = text.match(/Order Date:\s*\n*(\d{2}[\/N]\d{2}[\/N]\d{2,4})/i)
  if (rawDate) {
    orderDate = parseDate(rawDate[1])
  } else {
    const anyDate = text.match(/(\d{2}[\/N]\d{2}[\/N]\d{2,4})/)
    if (anyDate) orderDate = parseDate(anyDate[1])
    else orderDate = new Date().toISOString().split('T')[0]
  }

  // Total Amount extraction
  let totalAmount = 0
  const totalMatch = text.match(/Total\s+\$?([\d,]+\.?\d*)\$?([\d,]+\.?\d*)/i)
  if (totalMatch) {
    const raw = totalMatch[1].replace(/,/g, '')
    totalAmount = parseFloat(raw) || 0
  }

  // Line Items extraction
  const lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }> = []
  let match

  const igfPattern = /^(\d+)\s*UNIT\s+([^\s,]+)/gm
  igfPattern.lastIndex = 0
  let foundIGF = false

  while ((match = igfPattern.exec(text)) !== null) {
    let qty: number
    const rawQty = match[1]
    const mid = Math.floor(rawQty.length / 2)

    if (rawQty.length >= 2 && rawQty.length % 2 === 0 && rawQty.slice(0, mid) === rawQty.slice(mid)) {
      qty = parseInt(rawQty.slice(0, mid))
    } else {
      qty = parseInt(rawQty)
    }

    const rawCode = match[2].replace(/\d+$/, '')
    const itemCode = rawCode.replace(/[^A-Z0-9]/gi, '') || rawCode

    const lineEnd = text.indexOf('\n', match.index)
    const lineText = text.substring(match.index, lineEnd > 0 ? lineEnd : text.length)

    const amount = totalAmount

    const priceMatches = lineText.match(/(\d+\.\d{2})[N\/]/g)
    const lastPrice = priceMatches ? priceMatches[priceMatches.length - 1] : null
    const priceMatch = lastPrice ? lastPrice.match(/(\d+\.\d{2})/) : null
    const unitPrice = priceMatch
      ? parseFloat(priceMatch[1])
      : (qty > 0 ? parseFloat((amount / qty).toFixed(2)) : 0)

    // ── Pre-item spec: everything between the column-header row and this item ──
    const textBefore = text.substring(0, match.index)
    const tbLines = textBefore.split('\n')
    const preSpec: string[] = []

    // Walk backwards to find the last line that looks like a table column header
    let colHeaderIdx = -1
    for (let i = tbLines.length - 1; i >= 0; i--) {
      const u = tbLines[i].toUpperCase()
      if (
        (u.includes('QUANTITY') || u.includes('QUANT')) &&
        (u.includes('DESCRIPTION') || u.includes('PRICE') || u.includes('AMOUNT') || u.includes('UOM'))
      ) {
        colHeaderIdx = i
        break
      }
    }

    if (colHeaderIdx >= 0) {
      for (let i = colHeaderIdx + 1; i < tbLines.length; i++) {
        const t = tbLines[i].trim()
        if (!t) continue
        // Skip lines that are purely column-header repeats or table meta
        if (t.match(/^(QUANTITY|TOTAL\s+QUANTITY|UOM|PRICE\/UOM|AMOUNT|ITEM\/DESCRIPTION)/i)) continue
        preSpec.push(t)
      }
    }

    // ── Post-item spec: lines after the item match until a stop sentinel ──
    const afterMatch = text.substring(match.index + match[0].length)
    const postSpec: string[] = []
    for (const ln of afterMatch.split('\n')) {
      const t = ln.trim()
      if (!t) continue
      if (t.match(/^(Subtotal|MAXIMUM|TOTAL|APPROVED|AUTHORIZED|Page)/i)) break
      if (t.match(/^\d+\s*UNIT\s+[A-Z]/)) break
      if (t.match(/^[\d,\.\s\$]+$/)) continue
      postSpec.push(t)
    }

    const specBody = [...preSpec, ...postSpec].join('\n')
    const description = specBody
      ? `${qty} Units ${itemCode}\n${specBody}`
      : `${qty} Units ${itemCode}`

    lineItems.push({ description, quantity: qty, unitPrice, amount })
    foundIGF = true
  }

  // UFP/Northann fallback format
  if (!foundIGF) {
    const ufpPattern = /^([A-Z][A-Z0-9]+)\s+([\d,]+\.?\d*)\/[Uu]nit\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/gm
    ufpPattern.lastIndex = 0
    while ((match = ufpPattern.exec(text)) !== null) {
      const itemCode = match[1]
      const unitPrice = parseFloat(match[2].replace(/,/g, ''))
      const qty = parseFloat(match[3].replace(/,/g, ''))
      const amount = parseFloat(match[4].replace(/,/g, ''))

      // Pre-spec: look for column header before this item too
      const textBefore = text.substring(0, match.index)
      const tbLines = textBefore.split('\n')
      const preSpec: string[] = []
      let colHeaderIdx = -1
      for (let i = tbLines.length - 1; i >= 0; i--) {
        const u = tbLines[i].toUpperCase()
        if (
          (u.includes('QUANTITY') || u.includes('QTY')) &&
          (u.includes('RATE') || u.includes('AMOUNT') || u.includes('LOADING'))
        ) {
          colHeaderIdx = i
          break
        }
      }
      if (colHeaderIdx >= 0) {
        for (let i = colHeaderIdx + 1; i < tbLines.length; i++) {
          const t = tbLines[i].trim()
          if (!t) continue
          if (t.match(/^(QTY|RATE|AMOUNT|LOADING)/i)) continue
          preSpec.push(t)
        }
      }

      const afterMatch = text.substring(match.index + match[0].length)
      const postSpec: string[] = []
      for (const ln of afterMatch.split('\n')) {
        const t = ln.trim()
        if (!t) continue
        if (t.match(/^[A-Z][A-Z0-9]+\s+[\d,]+\.?\d*\/[Uu]nit/) || t.match(/^(TOTAL|APPROVED|AUTHORIZED|Page|MAXIMUM|Subtotal)/i)) break
        postSpec.push(t)
      }

      const specBody = [...preSpec, ...postSpec].join('\n')
      const description = specBody
        ? `${qty} Units ${itemCode}\n${specBody}`
        : `${qty} Units ${itemCode}`
      lineItems.push({ description, quantity: qty, unitPrice, amount })
    }
  }

  // Fallback if no items found
  if (lineItems.length === 0 && totalAmount > 0) {
    lineItems.push({
      description: 'Refer to attached PO for line item details',
      quantity: 1,
      unitPrice: totalAmount,
      amount: totalAmount,
    })
  }

  // Notes extraction
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
