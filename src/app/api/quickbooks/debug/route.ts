import { NextResponse } from 'next/server'

const QB_BASE = `https://quickbooks.api.intuit.com/v3/company/${process.env.QBO_REALM_ID}`
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

async function getAccessToken() {
  const creds = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: `grant_type=refresh_token&refresh_token=${process.env.QBO_REFRESH_TOKEN}`
  })
  if (!res.ok) throw new Error(`Token error: ${await res.text()}`)
  const data = await res.json()
  return data.access_token
}

export async function GET() {
  try {
    const token = await getAccessToken()
    const url = `${QB_BASE}/query?query=${encodeURIComponent('SELECT * FROM Vendor MAXRESULTS 200')}&minorversion=65`
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } })
    const data = await res.json()
    const vendors = (data?.QueryResponse?.Vendor ?? []).map((v) => ({ id: v.Id, name: v.DisplayName }))
    return NextResponse.json({ count: vendors.length, vendors })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const { name } = await req.json()
    const token = await getAccessToken()
    const url = `${QB_BASE}/vendor?minorversion=65`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ DisplayName: name, CompanyName: name })
    })
    const data = await res.json()
    return NextResponse.json({ ok: res.ok, status: res.status, data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
