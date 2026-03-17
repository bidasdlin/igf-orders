const QBO_BASE_URL = 'https://quickbooks.api.intuit.com/v3/company'

async function getAccessToken(): Promise<string> {
  const clientId = process.env.QBO_CLIENT_ID!
  const clientSecret = process.env.QBO_CLIENT_SECRET!
  const refreshToken = process.env.QBO_REFRESH_TOKEN!

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token refresh failed: ${text}`)
  }

  const data = await response.json()
  return data.access_token
}

export async function createPurchaseOrder(poData: {
  vendorId: string
  lineItems: Array<{ description: string; amount: number; qty: number; unitPrice: number }>
  memo?: string
  poNumber?: string
}) {
  const accessToken = await getAccessToken()
  const realmId = process.env.QBO_REALM_ID!

  const body = {
    VendorRef: { value: poData.vendorId },
    POEmail: { Address: '' },
    CustomField: poData.poNumber ? [{ DefinitionId: '1', StringValue: poData.poNumber, Type: 'StringType' }] : [],
    Memo: poData.memo || '',
    Line: poData.lineItems.map((item, i) => ({
      Id: String(i + 1),
      LineNum: i + 1,
      Description: item.description,
      Amount: item.amount,
      DetailType: 'ItemBasedExpenseLineDetail',
      ItemBasedExpenseLineDetail: {
        Qty: item.qty,
        UnitPrice: item.unitPrice,
        ItemRef: { value: '1', name: 'Services' },
      },
    })),
  }

  const response = await fetch(`${QBO_BASE_URL}/${realmId}/purchaseorder`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`QuickBooks API error: ${text}`)
  }

  return response.json()
}

export async function listPurchaseOrders() {
  const accessToken = await getAccessToken()
  const realmId = process.env.QBO_REALM_ID!

  const query = encodeURIComponent('SELECT * FROM PurchaseOrder MAXRESULTS 100')
  const response = await fetch(`${QBO_BASE_URL}/${realmId}/query?query=${query}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`QuickBooks API error: ${text}`)
  }

  return response.json()
}
