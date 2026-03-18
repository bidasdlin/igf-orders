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
  })
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
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePdfText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .replace(/\f/g, '\n')
    .replace(/\u1100/g, '2')
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
  const line = lines.find((entry) => entry.toLowerCase().includes('order date:'))
  if (line) {
    const match = line.match(/Order Date:\s*(\d\s*\d\/\d\s*\d\/\d{2,4})/i)
    if (match) return toIsoDate(match[1].replace(/\s+/g, ''))
  }
  return findDateAroundLabel(lines, 'Order Date:')
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
  return text.match(/Frt Term:\s*([A-Z]+-[A-Z]+)/i)?.[1]
}

function extractBranch(text: string): string | undefined {
  return text.match(/B\s*ranch:\s*([A-Z]+)/i)?.[1]
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
  return /^(?:QUANTITY|UOM|TOTAL QUANTITY|ITEM\/DESCRIPTION|PRICE\/UOM|AMOUNT|Reference:|Verbal PO:|Ship Via:|Order Date:|Exp Ship Date:|Type:|WH|Frt Term:|HIGH CUBE CY|Page \d+ of \d+|Reprinted:|Supplier:|Ship To:|Account:|Branch:|Phone:|Fax:|Buyer:|Buyer 2:|W H Confirmed:)/i.test(line)
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

function buildParsedItem(quantity: number, itemCode: string, totalAmount: number, descriptionLines: string[]) {
  const descriptionBody = dedupeLines(descriptionLines).join('\n').trim()
  if (!descriptionBody) return null

  return {
    description: `${quantity} Units ${itemCode} — ${descriptionBody}`,
    quantity,
    unitPrice: quantity > 0 ? Number((totalAmount / quantity).toFixed(2)) : totalAmount,
    amount: totalAmount,
  }
}

function collectLeadingDescription(lines: string[], itemIndex: number): string[] {
  const leading: string[] = []
  let collecting = false

  for (let i = itemIndex - 1; i >= 0; i--) {
    const line = lines[i]
    if (isValueNoise(line)) {
      if (!collecting) continue
      break
    }
    if (isSectionBoundary(line)) break
    leading.unshift(line)
    collecting = true
  }

  return leading
}

function collectTrailingDescription(lines: string[], itemIndex: number): string[] {
  const trailing: string[] = []

  for (let i = itemIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (
      /^(Subtotal|MAXIMUM WEIGHT|Total$|Load:|Payment Terms:|Weight:|Printed:)/i.test(line) ||
      /^TOTAL$/i.test(line)
    ) {
      break
    }
    if (isValueNoise(line)) continue
    trailing.push(line)
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
  const inlineItemIndex = lines.findIndex((line) => /^\d(?:\s*\d)*(?:\.\d+)?\s+UNIT\s+[A-Z][A-Z0-9]+/i.test(line))
  if (inlineItemIndex >= 0) {
    const line = lines[inlineItemIndex]
    const match = line.match(/^((?:\d\s*)+(?:\.\d+)?)\s+UNIT\s+([A-Z][A-Z0-9]+)/i)
    if (match) {
      const quantity = Number(match[1].replace(/\s+/g, ''))
      const itemCode = match[2]
      const descriptionLines = [
        ...collectLeadingDescription(lines, inlineItemIndex),
        ...collectTrailingDescription(lines, inlineItemIndex),
      ]
      return buildParsedItem(quantity, itemCode, totalAmount, descriptionLines)
    }
  }

  const itemIndex = lines.findIndex((line) => /^(?!TOTAL$)[A-Z]{2,}\d+[A-Z0-9]+$/i.test(line))
  if (itemIndex < 0) return null

  const itemCode = lines[itemIndex]
  let quantity = 0
  for (let i = itemIndex - 1; i >= Math.max(0, itemIndex - 6); i--) {
    const match = lines[i].match(/(\d+(?:\.\d+)?)\s*\/(?:\s*UNIT)?$/i)
    if (match) {
      quantity = Number(match[1])
      break
    }
  }

  if (!quantity) {
    const numericWindow = lines.slice(Math.max(0, itemIndex - 6), itemIndex).join(' ')
    const match = numericWindow.match(/(\d+(?:\.\d+)?)\s*\/\s*UNIT/i)
    if (match) quantity = Number(match[1])
  }

  const descriptionLines = [
    ...collectLeadingDescription(lines, itemIndex),
    ...collectTrailingDescription(lines, itemIndex),
  ]

  return buildParsedItem(quantity, itemCode, totalAmount, descriptionLines)
}

function extractNotes(text: string): string {
  const noteMatch = text.match(/(MAXIMUM WEIGHT[\s\S]*?)(?:\n\s*\n|Total\b|Payment Terms:|Weight:|$)/i)
  return noteMatch?.[1]?.replace(/\s+/g, ' ').trim() || ''
}

function extractPOData(text: string, fileName: string) {
  const normalizedText = normalizePdfText(text)
  const poNumber = extractPONumber(normalizedText, fileName)

  const lines = normalizedText
    .split('\n')
    .map(cleanLine)
    .filter(Boolean)

  const vendorName = extractVendor(lines, normalizedText)
  const shipTo = extractShipTo(lines, normalizedText)
  const date = extractOrderDate(lines)
  const totalAmount = extractTotalAmount(lines, normalizedText)
  const primaryItem = extractPrimaryItem(lines, totalAmount)
  const branch = extractBranch(normalizedText)
  const freightTerm = extractFreightTerm(normalizedText)
  const notes = extractNotes(normalizedText)

  const lineItems = primaryItem ? [primaryItem] : []

  // Fallback if no items found
  if (lineItems.length === 0 && totalAmount > 0) {
    lineItems.push({
      description: 'Refer to attached PO for line item details',
      quantity: 1,
      unitPrice: totalAmount,
      amount: totalAmount,
    })
  }

  return {
    poNumber,
    vendorName,
    shipTo,
    date,
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
