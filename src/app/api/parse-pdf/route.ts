import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { NextRequest, NextResponse } from 'next/server'
import pdfParse from 'pdf-parse'

export const runtime = 'nodejs'
export const maxDuration = 30

const execFileAsync = promisify(execFile)

const BRANCH_TO_WEIGHT_NOTE: Record<string, string> = {
  LA: 'MAXIMUM WEIGHT TO LOS ANGELES IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US REGARDING REDUCING WEIGHT ON THE CONTAINER',
  SAV: 'MAXIMUM WEIGHT TO SAVANNAH IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
  XA: 'MAXIMUM WEIGHT TO SAVANNAH IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
  HOU: 'MAXIMUM WEIGHT TO HOUSTON IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
  TEXAS: 'MAXIMUM WEIGHT TO HOUSTON IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
  NY: 'MAXIMUM WEIGHT TO NEW YORK IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
  NE: 'MAXIMUM WEIGHT TO NEW YORK IS 27 MT - IF SHIPMENT AS ORDERED WILL BE ABOVE THE WEIGHT LIMIT, PLEASE CONTACT US',
}

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
  }).replace(/\(ᄀ\)/g, '2')
}

function toIsoDate(value: string): string {
  const parts = value.split('/')
  if (parts.length !== 3) return new Date().toISOString().split('T')[0]
  const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2]
  return `${year}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
}

function cleanLine(line: string): string {
  return line
    .replace(/\u0000/g, '')
    .replace(/\f/g, '')
    .replace(/\u1100/g, '2')
    .replace(/\(ᄀ\)/g, '2')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePdfText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .replace(/\f/g, '\n')
    .replace(/\u1100/g, '2')
    .replace(/\(ᄀ\)/g, '2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractPONumber(text: string, fileName: string): string {
  const fileMatch = fileName.match(/(X?\d{7,10})/i)
  if (fileMatch) return fileMatch[1]

  const headerMatch = text.match(/PURCHASE\s*ORDER[\s\n]+(X?\d{7,10})/i)
  if (headerMatch) return headerMatch[1]

  const anyMatch = text.match(/\b(X?\d{7,10})\b/)
  if (anyMatch) return anyMatch[1]

  return fileName.replace('Purchase Order', '').replace('.pdf', '').trim()
}

async function extractTextWithPdfToText(buffer: Buffer): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'igf-orders-'))
  const tempFile = join(tempDir, 'upload.pdf')
  try {
    await writeFile(tempFile, buffer)
    const { stdout } = await execFileAsync('pdftotext', ['-layout', tempFile, '-'], {
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return normalizePdfText(stdout)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const cliText = await extractTextWithPdfToText(buffer)
    if (cliText) return cliText
  } catch {
    // Fall back to pdf-parse when pdftotext is unavailable.
  }

  const parsed = await pdfParse(buffer)
  return normalizePdfText(decodeWideChars(parsed.text))
}

function findDateAroundLabel(lines: string[], label: string): string {
  const datePattern = /(\d\s*\d\/\d\s*\d\/\d{2,4})/
  const labelIndex = lines.findIndex((line) => line.toLowerCase().includes(label.toLowerCase()))
  if (labelIndex >= 0) {
    for (let i = Math.max(0, labelIndex - 4); i <= Math.min(lines.length - 1, labelIndex + 4); i++) {
      const match = lines[i].match(datePattern)
      if (match) return toIsoDate(match[1].replace(/\s+/g, ''))
    }
  }

  const anyDate = lines.join('\n').match(datePattern)
  if (anyDate) return toIsoDate(anyDate[1].replace(/\s+/g, ''))

  return new Date().toISOString().split('T')[0]
}

function normalizeDateCandidate(value: string): string | null {
  const normalized = value
    .replace(/\(ᄀ\)/g, '2')
    .replace(/\u1100/g, '2')
    .replace(/\s+/g, '')
    .replace(/N/g, '/')

  const deduped = normalized.replace(/(\d{2}\/\d{2}\/\d{2,4})\1/g, '$1')
  const match = deduped.match(/(\d{2}\/\d{2}\/\d{2,4})/)
  if (!match) return null

  return toIsoDate(match[1])
}

function extractVendor(lines: string[], text: string): string {
  const mfgLine = lines.find((line) => /^mfg\s+/i.test(line))
  if (mfgLine) return mfgLine.replace(/^mfg\s+/i, '').trim()

  const vendorIndex = lines.findIndex((line) => line.toUpperCase() === 'VENDOR')
  if (vendorIndex >= 0) {
    const vendor = lines.slice(vendorIndex + 1).find((line) => line && !/^(SHIP TO|P\.O\.|DATE|QTY|PO NUMBER)$/i.test(line))
    if (vendor) return vendor
  }

  const supplierMatch = text.match(/Supplier:\s*([^\n]+)/i)
  return supplierMatch?.[1]?.trim() || 'Unknown Vendor'
}

function extractOrderDate(lines: string[]): string {
  const orderLine = lines.find((entry) => entry.toLowerCase().includes('order date:') && /\d/.test(entry))
  if (orderLine) {
    const parsed = normalizeDateCandidate(orderLine)
    if (parsed) return parsed
  }

  const buyerLine = lines.find((entry) => /Buyer:/i.test(entry) && !/Buyer 2:/i.test(entry))
  if (buyerLine) {
    const match = buyerLine.match(/([0-9N/\s]{6,32})Buyer:/i)
    const parsed = normalizeDateCandidate(match?.[1] ?? buyerLine)
    if (parsed) return parsed
  }

  return findDateAroundLabel(lines, 'Order Date:')
}

function extractExpShipDate(lines: string[], orderDate: string): string | undefined {
  const expLine = lines.find((entry) => entry.toLowerCase().includes('exp ship date:') && /\d/.test(entry))
  if (expLine) {
    const parsed = normalizeDateCandidate(expLine)
    if (parsed) return parsed
  }

  const orderLabelIndex = lines.findIndex((line) => line.toLowerCase().includes('order date:'))
  if (orderLabelIndex >= 0) {
    for (let i = orderLabelIndex; i <= Math.min(lines.length - 1, orderLabelIndex + 3); i++) {
      const parsed = normalizeDateCandidate(lines[i])
      if (parsed && parsed !== orderDate) return parsed
    }
  }

  const labelIndex = lines.findIndex((line) => line.toLowerCase().includes('exp ship date:'))
  if (labelIndex >= 0) {
    for (let i = Math.max(0, labelIndex - 2); i <= Math.min(lines.length - 1, labelIndex + 2); i++) {
      const parsed = normalizeDateCandidate(lines[i])
      if (parsed && parsed !== orderDate) return parsed
    }
  }

  const orderLine = lines.find((entry) => entry.toLowerCase().includes('order date:') && /\d/.test(entry))
  if (orderLine) {
    const parsed = normalizeDateCandidate(orderLine)
    if (parsed && parsed !== orderDate) return parsed
  }

  return undefined
}

function extractShipTo(lines: string[], text: string): string {
  const shipMatch = text.match(/Ship To:\s*(Port of [^\n]+)/i)
  if (shipMatch) return shipMatch[1].trim()

  const shipIndex = lines.findIndex((line) => line.toUpperCase() === 'SHIP TO')
  if (shipIndex >= 0 && lines[shipIndex + 1]) return lines[shipIndex + 1]

  const portMatch = text.match(/(Port of [A-Za-z ]+,\s*[A-Z]{2})/i)
  if (portMatch) return portMatch[1].trim()

  return ''
}

function extractFreightTerm(text: string): string | undefined {
  return text.match(/Frt Term:\s*(?:HIGH CUBE CY\s*)?([A-Z]+-[A-Z]+)/i)?.[1]
}

function mapFreightTermToBranch(freightTerm?: string): string | undefined {
  switch (freightTerm) {
    case 'DDP-LA':
      return 'LA'
    case 'DDP-SAV':
      return 'XA'
    case 'DDP-HOU':
      return 'TEXAS'
    case 'DDP-NY':
      return 'NE'
    case 'DDP-PDX':
      return 'VANC'
    default:
      return undefined
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractBranch(text: string, poNumber: string, freightTerm?: string): string | undefined {
  const direct = text.match(/^\s*B\s*ranch:\s*([A-Z]{2,10})\s*$/im)?.[1]
  if (direct && direct.toUpperCase() !== 'BRANCH') return direct

  const blockPattern = new RegExp(
    `PURCHASE\\s*ORDER\\s*\\n+\\s*${escapeRegExp(poNumber)}\\s*\\n+\\s*[A-Z]{2,10}\\s*\\n+\\s*([A-Z]{2,10})\\s*\\n`,
    'i',
  )
  const blockMatch = text.match(blockPattern)?.[1]
  if (blockMatch) return blockMatch

  return mapFreightTermToBranch(freightTerm)
}

function parseMoney(value: string): number {
  return Number(value.replace(/[,\s$]/g, ''))
}

function extractMoneyValues(text: string): number[] {
  return Array.from(text.matchAll(/\$?\s*((?:\d\s*){1,3}(?:,\s*\d{3})*\.\d{2})/g))
    .map((match) => parseMoney(match[1]))
    .filter((value) => Number.isFinite(value))
}

function isSectionBoundary(line: string): boolean {
  return /^(?:QUANTITY|QUA\/TITY|UOM|TOTAL(?: QUANTITY)?|ITEM.?DESCRIPTION|PRICE.?UOM|AMOU.?T|Reference:|Verbal PO:|Ship Via:|Order Date:|Exp Ship Date:|Type:|WH(?:WHType:)?|Frt Term:|HIGH CUBE CY|Page \d+ of \d+|Reprinted:|Supplier:|Ship To:|Account:|Branch:|Phone:|Fax:|Buyer:|Buyer 2:|Confirmed:|W H Confirmed:|Payment Terms:|Due at Receipt of Documentation|Printed:)/i.test(line)
}

function isValueNoise(line: string): boolean {
  const stripped = line
    .replace(/\b(?:UNIT|MSF|CY|USD)\b/gi, '')
    .replace(/[0-9\s,.$/:-]/g, '')
    .trim()
  return stripped === ''
}

function dedupeLines(lines: string[]): string[] {
  const normalized: string[] = []
  for (const line of lines.map(cleanLine).filter(Boolean)) {
    if (normalized[normalized.length - 1] !== line) {
      normalized.push(line)
    }
  }
  return normalized
}

function buildParsedItem(
  quantity: number,
  itemCode: string,
  totalAmount: number,
  descriptionLines: string[],
  priceUom?: string,
) {
  const descriptionBody = dedupeLines(descriptionLines).join('\n').trim()
  if (!descriptionBody) return null

  return {
    description: `${quantity} Units ${itemCode} — ${descriptionBody}`,
    quantity,
    unitPrice: quantity > 0 ? Number((totalAmount / quantity).toFixed(2)) : totalAmount,
    amount: totalAmount,
    priceUom,
  }
}

function normalizeDescriptionLine(line: string): string {
  return cleanLine(
    line
      .replace(/D\+NE/g, 'D+/E')
      .replace(/\bDNE\b/g, 'D/E')
      .replace(/\+N-/g, '+/-')
      .replace(/([A-Za-z0-9])N(?=[A-Za-z0-9])/g, '$1/')
      .replace(/\/{2,}/g, '/'),
  )
}

function isDescriptionStop(line: string): boolean {
  return /^(?:Subtotal|MAXIMUM WEIGHT|Total$|Load:|Payment Terms:|Weight:|Printed:)/i.test(line)
}

function isLikelyDescriptionLine(line: string): boolean {
  const normalized = normalizeDescriptionLine(line)
  if (!normalized) return false
  if (isSectionBoundary(normalized) || isDescriptionStop(normalized)) return false
  if (!/[A-Za-z]/.test(normalized)) return false
  if (/^[\d\s,.$/%:-]+$/.test(normalized)) return false
  return true
}

function extractItemCodeCandidate(line: string): string | null {
  const compact = normalizeCompactItemLine(line)
  const mergedPriceMatch = compact.match(/([A-Z]{2,6}[A-Z0-9]{2,12}?)(?=\d{2,4}(?:\.\d{2})?(?:N\d{2,4}(?:\.\d{2})?)?(?:\/|N)[A-Z]{2,10})/i)?.[1]
  if (mergedPriceMatch) {
    return mergedPriceMatch.replace(/^(?:UNIT)+/i, '')
  }

  const candidates = cleanLine(line).match(/\b[A-Z0-9]{6,16}\b/g) ?? []
  for (const candidate of candidates) {
    if (!/^[A-Z]/.test(candidate)) continue
    if (!/[A-Z]/.test(candidate) || !/\d/.test(candidate)) continue
    if ((candidate.match(/[A-Z]/g) ?? []).length < 2) continue
    if ((candidate.match(/\d/g) ?? []).length < 2) continue
    if (/^(?:ACCOUNT|AMOUNT|BRANCH|BUYER|CONFIRMED|ORDER|PAGE|PHONE|PORTLAND|PRINTED|QUANTITY|REFERENCE|SHIP|SUBTOTAL|SUPPLIER|TOTAL|UNIT|VENDOR|VERBAL|WEIGHT)$/i.test(candidate)) {
      continue
    }
    return candidate
  }

  return null
}

function normalizeRepeatedDigits(value: string): string {
  const compact = value.replace(/\s+/g, '')
  if (/^\d+$/.test(compact) && compact.length % 2 === 0) {
    const half = compact.length / 2
    if (compact.slice(0, half) === compact.slice(half)) {
      return compact.slice(0, half)
    }
  }
  return compact
}

function normalizeCompactItemLine(line: string): string {
  return line
    .replace(/\s+/g, '')
    .replace(/U\/IT/gi, 'UNIT')
    .replace(/(\d+(?:\.\d+)?)N\1N([A-Z]{2,10})/gi, '$1/$2')
    .replace(/(\d+(?:\.\d+)?)N([A-Z]{2,10})/gi, '$1/$2')
}

function extractQuantityFromItemLine(line: string): number {
  const compact = normalizeCompactItemLine(line)
  const leading = compact.match(/^(\d+)(?:UNIT|U\/IT)/i)?.[1]
  if (leading) {
    const quantity = Number(normalizeRepeatedDigits(leading))
    if (Number.isFinite(quantity)) return quantity
  }

  const rateQuantity = compact.match(/(\d+)\.00\/(?:UNIT|U\/IT)/i)?.[1]
  if (rateQuantity) {
    const quantity = Number(normalizeRepeatedDigits(rateQuantity))
    if (Number.isFinite(quantity)) return quantity
  }

  return 0
}

function extractPriceUom(line: string): string | undefined {
  const compact = normalizeCompactItemLine(line)
  const matches = Array.from(compact.matchAll(/(\d+(?:\.\d+)?\/[A-Z]{2,10})/g)).map((match) => match[1])
  return matches.reverse().find((value) => !/\/UNIT$/i.test(value))
}

function collectLeadingDescription(lines: string[], itemIndex: number): string[] {
  const leading: string[] = []

  for (let i = itemIndex - 1; i >= 0; i--) {
    const line = lines[i]
    const normalized = normalizeDescriptionLine(line)
    if (!normalized) {
      continue
    }
    if (isSectionBoundary(normalized)) break
    if (isDescriptionStop(normalized)) break
    if (!isLikelyDescriptionLine(line)) {
      if (leading.length) break
      continue
    }
    leading.unshift(normalized)
  }

  return leading
}

function collectTrailingDescription(lines: string[], itemIndex: number): string[] {
  const trailing: string[] = []

  for (let i = itemIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    const normalized = normalizeDescriptionLine(line)
    if (!normalized) {
      continue
    }
    if (isDescriptionStop(normalized) || /^TOTAL$/i.test(normalized)) {
      break
    }
    if (!isLikelyDescriptionLine(line)) continue
    trailing.push(normalized)
  }

  return trailing
}

function extractTotalAmount(lines: string[], text: string): number {
  const dollarCandidates = lines.flatMap((line) => line.includes('$') ? extractMoneyValues(line) : [])
  if (dollarCandidates.length) return Math.max(...dollarCandidates)

  const labeledCandidates: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (/(Subtotal|(?:^| )Total(?:$| ))/i.test(lines[i]) && !/TOTAL QUANTITY/i.test(lines[i])) {
      for (const line of lines.slice(i, i + 2)) {
        labeledCandidates.push(...extractMoneyValues(line))
      }
    }
  }
  if (labeledCandidates.length) return Math.max(...labeledCandidates)

  const matches = extractMoneyValues(text)
  if (matches.length === 0) return 0
  return Math.max(...matches)
}

function extractPrimaryItem(lines: string[], totalAmount: number) {
  const inlineItemIndex = lines.findIndex((line) => {
    const compact = line.replace(/\s+/g, '')
    return /(?:UNIT|U\/IT)/i.test(compact) && Boolean(extractItemCodeCandidate(line))
  })
  if (inlineItemIndex >= 0) {
    const line = lines[inlineItemIndex]
    const quantity = extractQuantityFromItemLine(line)
    const itemCode = extractItemCodeCandidate(line)
    if (quantity && itemCode) {
      const descriptionLines = [
        ...collectLeadingDescription(lines, inlineItemIndex),
        ...collectTrailingDescription(lines, inlineItemIndex),
      ]
      const priceUom = extractPriceUom(line) ?? extractPriceUom(lines[inlineItemIndex + 1] ?? '')
      return buildParsedItem(quantity, itemCode, totalAmount, descriptionLines, priceUom)
    }
  }

  const itemIndex = lines.findIndex((line) => {
    const cleaned = cleanLine(line)
    const itemCode = extractItemCodeCandidate(cleaned)
    return itemCode !== null && itemCode === cleaned
  })
  if (itemIndex < 0) return null

  const itemCode = cleanLine(lines[itemIndex])
  const numericWindow = lines.slice(Math.max(0, itemIndex - 2), Math.min(lines.length, itemIndex + 2)).join(' ')
  const quantity = extractQuantityFromItemLine(numericWindow)

  const descriptionLines = [
    ...collectLeadingDescription(lines, itemIndex),
    ...collectTrailingDescription(lines, itemIndex),
  ]

  const priceUom = lines
    .slice(Math.max(0, itemIndex - 1), Math.min(lines.length, itemIndex + 2))
    .map(extractPriceUom)
    .find(Boolean)

  return buildParsedItem(quantity, itemCode, totalAmount, descriptionLines, priceUom)
}

function extractRawTableItem(lines: string[], totalAmount: number) {
  const headerIndex = lines.findIndex((line) => /ITEM.?DESCRIPTION/i.test(line))
  if (headerIndex < 0) return null

  const sectionLines: string[] = []
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    const normalized = cleanLine(line)
    if (!normalized) continue
    if (isDescriptionStop(normalized) || /^TOTAL$/i.test(normalized) || /^Subtotal/i.test(normalized)) {
      break
    }
    sectionLines.push(line)
  }

  if (sectionLines.length === 0) return null

  const itemLine = sectionLines.find((line) => extractItemCodeCandidate(line) && extractQuantityFromItemLine(line))
    ?? sectionLines.find((line) => extractItemCodeCandidate(line))
    ?? ''

  const itemCode = extractItemCodeCandidate(itemLine) ?? ''
  const quantity = extractQuantityFromItemLine(itemLine) || 1
  const priceUom = sectionLines.map(extractPriceUom).find(Boolean)

  const descriptionLines = sectionLines
    .map((line) => normalizeDescriptionLine(line))
    .filter(Boolean)
    .filter((line) => {
      if (line === normalizeDescriptionLine(itemLine)) return false
      if (/^[\d\s,.$/%:-]+$/.test(line)) return false
      return !isDescriptionStop(line)
    })

  if (descriptionLines.length === 0) return null

  const descriptionBody = dedupeLines(descriptionLines).join('\n').trim()
  if (!descriptionBody) return null

  return {
    description: itemCode ? `${quantity} Units ${itemCode} — ${descriptionBody}` : descriptionBody,
    quantity,
    unitPrice: quantity > 0 ? Number((totalAmount / quantity).toFixed(2)) : totalAmount,
    amount: totalAmount,
    priceUom,
  }
}

function extractNotes(lines: string[], text: string): string {
  const startIndex = lines.findIndex((line) => /MAXIMUM WEIGHT/i.test(line))
  if (startIndex >= 0) {
    const noteLines: string[] = []
    for (let i = startIndex; i < lines.length; i++) {
      const normalized = cleanLine(lines[i])
      if (!normalized) {
        if (noteLines.length) break
        continue
      }
      if (/^(Payment Terms:|Weight:|Printed:|Total$|Load:)/i.test(normalized)) break
      noteLines.push(normalized)
    }
    return noteLines.join(' ')
  }

  const noteMatch = text.match(/(MAXIMUM WEIGHT[\s\S]*?)(?:\n\s*\n|Total\b|Payment Terms:|Weight:|$)/i)
  return noteMatch?.[1]?.replace(/\s+/g, ' ').trim() || ''
}

function extractPOData(text: string, fileName: string) {
  const normalizedText = normalizePdfText(text)
  const poNumber = extractPONumber(normalizedText, fileName)

  const rawLines = normalizedText
    .split('\n')
    .map((line) => line.replace(/\r/g, '').trimEnd())
    .filter((line) => line.trim())

  const lines = rawLines
    .map(cleanLine)
    .filter(Boolean)

  const vendorName = extractVendor(lines, normalizedText)
  const shipTo = extractShipTo(lines, normalizedText)
  const date = extractOrderDate(lines)
  const expShipDate = extractExpShipDate(lines, date)
  const totalAmount = extractTotalAmount(lines, normalizedText)
  const primaryItem = extractPrimaryItem(rawLines, totalAmount)
  const rawTableItem = extractRawTableItem(rawLines, totalAmount)
  const freightTerm = extractFreightTerm(normalizedText)
  const branch = extractBranch(normalizedText, poNumber, freightTerm)
  const notes = extractNotes(rawLines, normalizedText)

  const mergedItem = (() => {
    if (primaryItem && rawTableItem) {
      return {
        ...primaryItem,
        description: rawTableItem.description.length > primaryItem.description.length
          ? rawTableItem.description
          : primaryItem.description,
        quantity: primaryItem.quantity || rawTableItem.quantity,
        unitPrice: primaryItem.unitPrice || rawTableItem.unitPrice,
        amount: primaryItem.amount || rawTableItem.amount,
        priceUom: rawTableItem.priceUom || primaryItem.priceUom,
      }
    }

    return primaryItem ?? rawTableItem ?? null
  })()

  const lineItems = mergedItem ? [mergedItem] : []

  // Final fallback if no item details could be recovered from the source table.
  if (lineItems.length === 0 && totalAmount > 0) {
    lineItems.push({
      description: 'Unable to recover full line item details from the source PDF',
      quantity: 1,
      unitPrice: totalAmount,
      amount: totalAmount,
      priceUom: undefined,
    })
  }

  return {
    poNumber,
    vendorName,
    shipTo,
    date,
    expShipDate,
    lineItems,
    totalAmount,
    notes,
    branch,
    freightTerm,
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file || file.type !== 'application/pdf') {
      return NextResponse.json({ success: false, error: 'A PDF file is required' }, { status: 400 })
    }

    if (file.size === 0) {
      return NextResponse.json(
        { success: false, error: 'This PDF file is empty. If it came from Dropbox, download the file locally before uploading it.' },
        { status: 400 }
      )
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'File too large (max 5 MB)' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const text = await extractPdfText(buffer)
    const po = extractPOData(text, file.name)

    return NextResponse.json({ success: true, po })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[parse-pdf]', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
