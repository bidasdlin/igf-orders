'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Download, FileText, ArrowLeft, Clock } from 'lucide-react'

interface SyncedPO {
  poNumber: string
  vendorName: string
  shipTo: string
  totalAmount: number
  qbId?: string
  qbDocNumber?: string
  syncedAt?: string
}

export default function DownloadsPage() {
  const [pos, setPos] = useState<SyncedPO[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('igf_synced_pos') || '[]')
      setPos(stored)
    } catch (_) {
      setPos([])
    }
    setLoaded(true)
  }, [])

  const totalValue = pos.reduce((s, p) => s + (p.totalAmount || 0), 0)

  return (
    <main className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Processed POs</h1>
          <p className="text-gray-500 mt-1">
            {loaded ? (
              pos.length > 0
                ? <>{pos.length} PO{pos.length !== 1 ? 's' : ''} &nbsp;·&nbsp; Total: <span className="font-semibold text-gray-700">${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></>
                : 'No POs processed yet in this browser'
            ) : 'Loading…'}
          </p>
        </div>
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800">
          <ArrowLeft className="w-4 h-4" />
          Back to Processing
        </Link>
      </div>

      {loaded && pos.length === 0 && (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
          <FileText className="w-12 h-12 mx-auto mb-4 text-gray-200" />
          <p className="text-gray-500 font-medium">No processed POs yet</p>
          <p className="text-sm text-gray-400 mt-1">Process and sync a PO to QuickBooks — it will appear here automatically.</p>
          <Link href="/" className="inline-flex items-center gap-2 mt-5 text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg">
            Go process a PO
          </Link>
        </div>
      )}

      {loaded && pos.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-4 px-5 py-3 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <span>PO Number</span>
            <span>Vendor</span>
            <span>Ship To</span>
            <span className="text-right">Amount</span>
          </div>
          {pos.map((po, i) => (
            <div key={po.poNumber + i} className="flex items-center px-5 py-4 gap-3 hover:bg-gray-50 transition-colors">
              <div className="flex-1 grid grid-cols-[1fr_1fr_1fr_auto] gap-4 min-w-0 items-center">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-gray-900 truncate">{po.poNumber}</p>
                  {po.syncedAt && (
                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />{po.syncedAt}
                    </p>
                  )}
                </div>
                <p className="text-sm text-gray-700 truncate">{po.vendorName}</p>
                <p className="text-sm text-gray-500 truncate">{po.shipTo}</p>
                <p className="text-sm font-semibold text-gray-900 text-right whitespace-nowrap">
                  ${(po.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <a
                  href={`/api/generate-po-pdf/${po.qbDocNumber || po.poNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Download className="w-3 h-3" />
                  PDF
                </a>
                {po.qbId && (
                  <a
                    href={`https://qbo.intuit.com/app/purchaseorder?txnId=${po.qbId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                  >
                    QB →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
