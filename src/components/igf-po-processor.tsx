'use client'

import { useState } from 'react'

interface LineItem {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

interface IGFOrder {
  poNumber: string
  customerPONumber: string
  vendorName: string
  vendorId: string
  shipTo: string
  date: string
  lineItems: LineItem[]
  totalAmount: number
  notes?: string
}

interface ProcessResult {
  poNumber: string
  status: 'success' | 'error' | 'pending'
  qbId?: string
  qbDocNumber?: string
  error?: string
}

const SAMPLE_ORDERS: IGFOrder[] = [
  {
    poNumber: 'UFP-IGF-104657',
    customerPONumber: '104657',
    vendorName: 'United Forest Products PTE',
    vendorId: '1',
    shipTo: 'IGF Warehouse',
    date: '2026-03-17',
    totalAmount: 23921.66,
    lineItems: [
      { description: 'Lumber - 2x4x8 SPF', quantity: 500, unitPrice: 18.50, amount: 9250.00 },
      { description: 'Plywood - 4x8 3/4"', quantity: 200, unitPrice: 45.00, amount: 9000.00 },
      { description: 'OSB - 4x8 7/16"', quantity: 150, unitPrice: 11.14, amount: 1671.66 },
      { description: 'Shipping & Handling', quantity: 1, unitPrice: 4000.00, amount: 4000.00 },
    ],
    notes: 'IGF Customer PO #104657 - Rush Order',
  },
]

export function IGFPOProcessor() {
  const [orders] = useState<IGFOrder[]>(SAMPLE_ORDERS)
  const [results, setResults] = useState<Record<string, ProcessResult>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [globalLoading, setGlobalLoading] = useState(false)

  const successCount = Object.values(results).filter(r => r.status === 'success').length
  const errorCount = Object.values(results).filter(r => r.status === 'error').length

  async function sendToQB(order: IGFOrder) {
    setLoading(prev => ({ ...prev, [order.poNumber]: true }))
    try {
      const res = await fetch('/api/quickbooks/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId: order.vendorId,
          poNumber: order.poNumber,
          memo: order.notes,
          lineItems: order.lineItems.map(li => ({
            description: li.description,
            qty: li.quantity,
            unitPrice: li.unitPrice,
            amount: li.amount,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      const qbPO = data.PurchaseOrder
      setResults(prev => ({
        ...prev,
        [order.poNumber]: {
          poNumber: order.poNumber,
          status: 'success',
          qbId: qbPO?.Id,
          qbDocNumber: qbPO?.DocNumber,
        },
      }))
    } catch (err) {
      setResults(prev => ({
        ...prev,
        [order.poNumber]: {
          poNumber: order.poNumber,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        },
      }))
    } finally {
      setLoading(prev => ({ ...prev, [order.poNumber]: false }))
    }
  }

  async function sendAll() {
    setGlobalLoading(true)
    for (const order of orders) {
      if (!results[order.poNumber] || results[order.poNumber].status === 'error') {
        await sendToQB(order)
      }
    }
    setGlobalLoading(false)
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold">{orders.length}</div>
          <div className="text-sm text-gray-500">Total Orders</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">{successCount}</div>
          <div className="text-sm text-gray-500">Sent to QuickBooks</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-red-500">{errorCount}</div>
          <div className="text-sm text-gray-500">Errors</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Purchase Orders</h2>
        <button
          onClick={sendAll}
          disabled={globalLoading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
        >
          {globalLoading ? 'Processing...' : 'Create All in QuickBooks'}
        </button>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">PO Number</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Vendor</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Amount</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {orders.map(order => {
              const result = results[order.poNumber]
              const isLoading = loading[order.poNumber]
              return (
                <tr key={order.poNumber} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono font-medium">{order.poNumber}</td>
                  <td className="px-4 py-3 text-gray-600">{order.vendorName}</td>
                  <td className="px-4 py-3 text-gray-600">{order.date}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    ${order.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3">
                    {!result && <span className="text-gray-400">Pending</span>}
                    {result?.status === 'success' && (
                      <span className="text-green-600 font-medium">✓ QB #{result.qbDocNumber || result.qbId}</span>
                    )}
                    {result?.status === 'error' && (
                      <span className="text-red-500 text-xs" title={result.error}>✗ Error</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => sendToQB(order)}
                      disabled={isLoading || result?.status === 'success'}
                      className="text-blue-600 hover:underline disabled:text-gray-300 disabled:no-underline text-sm"
                    >
                      {isLoading ? 'Sending...' : result?.status === 'success' ? 'Sent' : 'Send to QB'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
