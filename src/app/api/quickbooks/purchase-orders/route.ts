import { NextRequest, NextResponse } from 'next/server'
import {
  createPurchaseOrder,
  updatePurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrderByDocNumber,
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

    if (body.lineItems.some((item) => item.description.startsWith('Unable to recover full line item details'))) {
      return NextResponse.json(
        { success: false, error: 'Full line item details were not recovered from the original PDF. Review this PO before syncing.' },
        { status: 422 }
      )
    }

    const computedTotal = body.lineItems.reduce((sum, item) => sum + item.amount, 0)
    if (Math.abs(computedTotal - body.totalAmount) > 0.01) {
      return NextResponse.json(
        { success: false, error: `Total mismatch: line items sum to ${computedTotal.toFixed(2)}, but totalAmount is ${body.totalAmount}` },
        { status: 400 }
      )
    }

    // Try to create; if duplicate DocNumber, update the existing PO with fresh descriptions
    let qbPO
    try {
      qbPO = await createPurchaseOrder(body)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      // QB error code 6140 = Duplicate Document Number — update existing instead
      if (msg.includes('6140') || msg.includes('Duplicate Document Number')) {
        const existing = await getPurchaseOrderByDocNumber(body.poNumber)
        if (existing) {
          qbPO = await updatePurchaseOrder(existing, body)
        } else {
          throw err
        }
      } else {
        throw err
      }
    }

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
