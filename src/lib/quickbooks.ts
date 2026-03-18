// QuickBooks Online API Client
// Benchwick LLC B2B sync (Production)

const QBO_BASE_URL = 'https://quickbooks.api.intuit.com/v3/company'
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

const CLIENT_ID = process.env.QBO_CLIENT_ID!
const CLIENT_SECRET = process.env.QBO_CLIENT_SECRET!
const REALM_ID = process.env.QBO_REALM_ID!
const REFRESH_TOKEN = process.env.QBO_REFRESH_TOKEN!

let cachedAccessToken: string | null = null
let tokenExpiry: number = 0
let cachedCogsAccount: { value: string; name: string } | null = null

// Get fresh access token using refresh token
async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiry) {
    return cachedAccessToken
  }

  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')

  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: REFRESH_TOKEN,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`QB token refresh failed: ${error}`)
  }

  const data = await response.json()
  cachedAccessToken = data.access_token
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000 // refresh 1 min early
  return cachedAccessToken!
}

// Generic QB API request
async function qbRequest(method: string, endpoint: string, body?: object) {
  const token = await getAccessToken()
  const url = `${QBO_BASE_URL}/${REALM_ID}/${endpoint}`

  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`QB API error [${response.status}]: ${error}`)
  }

  return response.json()
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IGFPOLineItem {
  description: string
  qty: number
  unitPrice: number
  amount: number
}

export interface IGFPurchaseOrder {
  poNumber: string          // e.g. "UFP-IGF-104657"
  customerPONumber: string  // e.g. "104657"
  vendorName: string        // e.g. "United Forest Products PTE"
  shipTo: string            // e.g. "Port of Los Angeles, CA"
  date: string              // e.g. "02/19/2026"
  lineItems: IGFPOLineItem[]
  totalAmount: number
  notes?: string
}

export interface QBVendor {
  Id: string
  DisplayName: string
  CompanyName?: string
}

export interface QBPurchaseOrder {
  [key: string]: unknown
  Id: string
  DocNumber: string
  TxnDate: string
  TotalAmt: number
  POStatus: string
  VendorRef: { value: string; name: string }
  Line: Array<{
    DetailType: string
    Amount: number
    ItemBasedExpenseLineDetail?: {
      Qty: number
      UnitPrice: number
      ItemRef: { value: string; name: string }
    }
    Description?: string
  }>
}

// ─── Account lookup ────────────────────────────────────────────────────────────

// Find the Cost of Goods Sold account (or any CostOfGoodsSold-type account)
async function getCogsAccount(): Promise<{ value: string; name: string }> {
  if (cachedCogsAccount) return cachedCogsAccount

  // Try exact name match first
  const nameQuery = `SELECT * FROM Account WHERE Name = 'Cost of Goods Sold' MAXRESULTS 1`
  const nameData = await qbRequest('GET', `query?query=${encodeURIComponent(nameQuery)}`)
  const byName = nameData.QueryResponse?.Account?.[0]
  if (byName) {
    cachedCogsAccount = { value: byName.Id, name: byName.Name }
    return cachedCogsAccount
  }

  // Fall back to any CostOfGoodsSold account type
  const typeQuery = `SELECT * FROM Account WHERE AccountType = 'Cost of Goods Sold' MAXRESULTS 1`
  const typeData = await qbRequest('GET', `query?query=${encodeURIComponent(typeQuery)}`)
  const byType = typeData.QueryResponse?.Account?.[0]
  if (byType) {
    cachedCogsAccount = { value: byType.Id, name: byType.Name }
    return cachedCogsAccount
  }

  // Last resort: any Expense account
  const expQuery = `SELECT * FROM Account WHERE AccountType = 'Expense' MAXRESULTS 1`
  const expData = await qbRequest('GET', `query?query=${encodeURIComponent(expQuery)}`)
  const byExp = expData.QueryResponse?.Account?.[0]
  if (byExp) {
    cachedCogsAccount = { value: byExp.Id, name: byExp.Name }
    return cachedCogsAccount
  }

  throw new Error('No suitable account found in QuickBooks. Please ensure a Cost of Goods Sold or Expense account exists.')
}

// ─── Vendor operations ────────────────────────────────────────────────────────

export async function searchVendor(vendorName: string): Promise<QBVendor | null> {
  const query = `SELECT * FROM Vendor WHERE DisplayName = '${vendorName.replace(/'/g, "\\'")}' MAXRESULTS 1`
  const data = await qbRequest('GET', `query?query=${encodeURIComponent(query)}`)

  const vendors = data.QueryResponse?.Vendor
  return vendors?.[0] ?? null
}

export async function createVendor(vendorName: string): Promise<QBVendor> {
  const data = await qbRequest('POST', 'vendor', {
    DisplayName: vendorName,
    CompanyName: vendorName,
    PrintOnCheckName: vendorName,
  })
  return data.Vendor
}

export async function getOrCreateVendor(vendorName: string): Promise<QBVendor> {
  const existing = await searchVendor(vendorName)
  if (existing) return existing
  return createVendor(vendorName)
}

// ─── Purchase Order operations ─────────────────────────────────────────────────

export async function createPurchaseOrder(po: IGFPurchaseOrder): Promise<QBPurchaseOrder> {
  const [vendor, cogsAccount] = await Promise.all([
    getOrCreateVendor(po.vendorName),
    getCogsAccount(),
  ])

  const txnDate = (() => {
    // Accept YYYY-MM-DD (ISO) or MM/DD/YYYY
    if (po.date.match(/^\d{4}-\d{2}-\d{2}$/)) return po.date
    const parts = po.date.split('/')
    if (parts.length === 3) return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
    return new Date().toISOString().split('T')[0]
  })()

  const lines = po.lineItems.map((item, index) => {
    // Support both "qty" and "quantity" field names (frontend sends "quantity")
    const qty = (item as any).quantity ?? item.qty ?? 1
    return {
      DetailType: 'AccountBasedExpenseLineDetail',
      Amount: item.amount,
      Description: item.description,
      AccountBasedExpenseLineDetail: {
        AccountRef: cogsAccount,
        BillableStatus: 'NotBillable',
        Qty: qty,
        UnitPrice: item.unitPrice,
      },
      LineNum: index + 1,
    }
  })

  // Add shipping note as last line if provided
  const notesLine = po.notes ? [{
    DetailType: 'AccountBasedExpenseLineDetail',
    Amount: 0,
    Description: po.notes,
    AccountBasedExpenseLineDetail: {
      AccountRef: cogsAccount,
      BillableStatus: 'NotBillable',
    },
    LineNum: po.lineItems.length + 1,
  }] : []

  const body = {
    DocNumber: po.poNumber,
    TxnDate: txnDate,
    VendorRef: { value: vendor.Id, name: vendor.DisplayName },
    ShipTo: { Line1: po.shipTo },
    POStatus: 'Open',
    TotalAmt: po.totalAmount,
    Line: [...lines, ...notesLine],
    CustomField: [
      { DefinitionId: '1', Name: 'Customer PO#', Type: 'StringType', StringValue: po.customerPONumber },
    ],
    PrivateNote: `IGF Customer PO: ${po.customerPONumber} | Ship to: ${po.shipTo}`,
  }

  const data = await qbRequest('POST', 'purchaseorder', body)
  return data.PurchaseOrder
}

// List all purchase orders, optionally filtered by date
export async function listPurchaseOrders(params?: {
  startDate?: string
  endDate?: string
  status?: 'Open' | 'Closed'
}): Promise<QBPurchaseOrder[]> {
  let query = 'SELECT * FROM PurchaseOrder'
  const conditions: string[] = []

  if (params?.startDate) conditions.push(`TxnDate >= '${params.startDate}'`)
  if (params?.endDate) conditions.push(`TxnDate <= '${params.endDate}'`)
  if (params?.status) conditions.push(`POStatus = '${params.status}'`)
  if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`
  query += ' ORDERBY TxnDate DESC MAXRESULTS 100'

  const data = await qbRequest('GET', `query?query=${encodeURIComponent(query)}`)
  return data.QueryResponse?.PurchaseOrder ?? []
}

export async function getPurchaseOrder(id: string): Promise<QBPurchaseOrder> {
  const data = await qbRequest('GET', `purchaseorder/${id}`)
  return data.PurchaseOrder
}

export async function getPurchaseOrderByDocNumber(docNumber: string): Promise<QBPurchaseOrder | null> {
  const query = `SELECT * FROM PurchaseOrder WHERE DocNumber = '${docNumber.replace(/'/g, "\\'")}' MAXRESULTS 1`
  const data = await qbRequest('GET', `query?query=${encodeURIComponent(query)}`)
  return data.QueryResponse?.PurchaseOrder?.[0] ?? null
}
