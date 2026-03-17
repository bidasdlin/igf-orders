import { NextRequest, NextResponse } from 'next/server'
import { createPurchaseOrder, listPurchaseOrders } from '@/lib/quickbooks'

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
    const result = await createPurchaseOrder(body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('POST /api/quickbooks/purchase-orders error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
