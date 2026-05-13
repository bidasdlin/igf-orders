import { NextRequest, NextResponse } from 'next/server'
import { createVendor, listVendors } from '@/lib/quickbooks'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const vendors = await listVendors(200)
    const normalized = vendors.map((vendor) => ({
      id: vendor.Id,
      name: vendor.DisplayName,
    }))

    return NextResponse.json(
      { count: normalized.length, vendors: normalized },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json()
    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 })
    }

    const vendor = await createVendor(name.trim())
    return NextResponse.json({ ok: true, data: vendor })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
