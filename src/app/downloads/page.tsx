import Link from 'next/link'
import { Download, FileText, ArrowLeft, Package } from 'lucide-react'
import { ALL_POS } from '@/lib/po-data'

export default function DownloadsPage() {
  const vendors = [...new Set(ALL_POS.map(p => p.vendor))].sort()
  const totalValue = ALL_POS.reduce((s, p) => s + p.total_amount, 0)

  return (
    <main className="max-w-5xl mx-auto py-8 px-4">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">NDC Purchase Orders</h1>
          <p className="text-gray-500 mt-1">
            {ALL_POS.length} POs &nbsp;·&nbsp; Total:{' '}
            <span className="font-semibold text-gray-700">
              ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </p>
        </div>
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800">
          <ArrowLeft className="w-4 h-4" />
          Back to Processing
        </Link>
      </div>

      {vendors.map(vendor => {
        const pos = ALL_POS.filter(p => p.vendor === vendor)
        const vendorTotal = pos.reduce((s, p) => s + p.total_amount, 0)
        return (
          <div key={vendor} className="mb-5 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="bg-gray-50 px-5 py-3 flex items-center justify-between border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-gray-400" />
                <span className="font-semibold text-gray-800">{vendor}</span>
                <span className="text-xs text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">
                  {pos.length} PO{pos.length !== 1 ? 's' : ''}
                </span>
              </div>
              <span className="text-sm font-medium text-gray-600">
                ${vendorTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="divide-y divide-gray-100">
              {pos.map(po => (
                <div key={po.po_number} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="w-4 h-4 text-gray-300 shrink-0" />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-mono font-semibold text-gray-800">{po.po_number}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-gray-500">{po.order_date}</span>
                      <span className="text-gray-300">·</span>
                      <span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">{po.freight_term}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-gray-500">{po.items[0].item_code}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 ml-4">
                    <span className="text-sm font-medium text-gray-700 hidden sm:block">
                      ${po.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                    <a
                      href={`/api/generate-po-pdf/${po.po_number}`}
                      className="inline-flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      PDF
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </main>
  )
}
