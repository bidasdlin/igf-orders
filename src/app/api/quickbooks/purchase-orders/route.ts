import { NextRequest, NextResponse } from 'next/server'
import { createPurchaseOrder, listPurchaseOrders } from '@/lib/quickbooks'

const QBO_BASE_URL = 'https://quickbooks.api.intuit.com/v3/company'

async function getAccessToken(): Promise<string> {
  const clientId = process.env.QBO_CLIENT_ID!
  const clientSecret = process.env.QBO_CLIENT_SECRET!
  const refreshToken = process.env.QBO_REFRESH_TOKEN!
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (!res.ok) throw new Error(`Token error: ${await res.text()}`)
  const data = await res.json()
  return data.access_token
}

async function getOrCreateVendor(vendorName: string, token: string): Promise<string> {
  const realmId = process.env.QBO_REALM_ID!
  // Search for existing vendor
  const q = encodeURIComponent(`SELECT * FROM Vendor WHERE DisplayName = '${vendorName.replace(/'/g, "\\'")}' MAXRESULTS 1`)
  const searchRes = await fetch(`${QBO_BASE_URL}/${realmId}/query?query=${q}&minorversion=65`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  })
  if (searchRes.ok) {
    const searchData = await searchRes.json()
    const vendors = searchData.QueryResponse?.Vendor
    if (vendors?.[0]?.Id) return vendors[0].Id
  }
  // Create vendor
  const createRes = await fetch(`${QBO_BASE_URL}/${realmId}/vendor?minorversion=65`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ DisplayName: vendorName, CompanyName: vendorName, PrintOnCheckName: vendorName }),
  })
  if (!createRes.ok) throw new Error(`Vendor create error: ${await createRes.text()}`)
  const createData = await createRes.json()
  return createData.Vendor.Id
}

export async function GET() {
  try {
    const data = await listPurchaseOrders()
    return NextResponse.json(data)
  } catch (error) {
    console.error('GET /api/quickbooks/purchase-orders error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Resolve vendorName → vendorId if needed
    let vendorId = body.vendorId
    if (!vendorId && body.vendorName) {
      const token = await getAccessToken()
      vendorId = await getOrCreateVendor(body.vendorName, token)
    }
    if (!vendorId) {
      return NextResponse.json({ error: 'vendorId or vendorName is required' }, { status: 400 })
    }

    const result = await createPurchaseOrder({
      ...body,
      vendorId,
    })

    return NextResponse.json(
      { success: true, purchaseOrder: { id: result.PurchaseOrder?.Id, docNumber: result.PurchaseOrder?.DocNumber } },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/quickbooks/purchase-orders error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
