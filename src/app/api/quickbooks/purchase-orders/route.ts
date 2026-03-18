import { NextRequest, NextResponse } from 'next/server'
import {
  createPurchaseOrder,
  listPurchaseOrders,
  type IGFPurchaseOrder,
} from '@/lib/quickbooks'

// GET /api/quickbooks/purchase-orders
export async function GET() {
  try {
    const orders = await listPurchaseOrders()
    return NextResponse.json({ success: true, orders })
  } catch (error) {
    console.error('GET /api/quickbooks/purchase-orders error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// POST /api/quickbooks/purchase-orders
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as IGFPurchaseOrder

    if (!body.poNumber || !body.vendorName || !body.lineItems?.length) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: poNumber, vendorName, lineItems' },
        { status: 400 }
      )
    }

    const computedTotal = body.lineItems.reduce((sum, item) => sum + item.amount, 0)
    if (Math.abs(computedTotal - body.totalAmount) > 0.01) {
      return NextResponse.json(
        { success: false, error: `Total mismatch: line items sum to ${computedTotal.toFixed(2)}, but totalAmount is ${body.totalAmount}` },
        { status: 400 }
      )
    }

    const qbPO = await createPurchaseOrder(body)

    return NextResponse.json({
      success: true,
      purchaseOrder: {
        id: qbPO.Id,
        docNumber: qbPO.DocNumber,
        status: qbPO.POStatus,
        totalAmount: qbPO.TotalAmt,
        vendor: qbPO.VendorRef.name,
        date: qbPO.TxnDate,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[QB PO POST]', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
