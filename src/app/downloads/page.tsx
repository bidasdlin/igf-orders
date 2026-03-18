'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Download, FileText, ArrowLeft, Package, ChevronDown } from 'lucide-react'
import { ALL_POS } from '@/lib/po-data'

type SortMode = 'vendor' | 'date' | 'port'

function parseDate(d: string): number {
  const parts = d.split('/')
  if (parts.length === 3) {
    const [m, day, y] = parts
    return new Date(2000 + parseInt(y), parseInt(m) - 1, parseInt(day)).getTime()
  }
  return 0
}

export default function DownloadsPage() {
  const [sortMode, setSortMode] = useState<SortMode>('vendor')

  const totalValue = ALL_POS.reduce((s, p) => s + p.total_amount, 0)

  // Build groups based on sort mode
  const groupKey = (po: typeof ALL_POS[0]) => {
    if (sortMode === 'vendor') return po.vendor
    if (sortMode === 'date') return po.order_date
    if (sortMode === 'port') return po.freight_term
    return po.vendor
  }

  const groupsMap = new Map<string, typeof ALL_POS>()
  const sorted = [...ALL_POS].sort((a, b) => parseDate(a.order_date) - parseDate(b.order_date))
  for (const po of sorted) {
    const key = groupKey(po)
    if (!groupsMap.has(key)) groupsMap.set(key, [])
    groupsMap.get(key)!.push(po)
  }

  // Sort group keys
  const groupKeys = Array.from(groupsMap.keys()).sort((a, b) => {
    if (sortMode === 'date') return parseDate(a) - parseDate(b)
    return a.localeCompare(b)
  })

  const sortLabels: Record<SortMode, string> = {
    vendor: '按供应商',
    date: '按时间',
    port: '按港口',
  }

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
        <div className="flex items-center gap-3">
          {/* Sort dropdown */}
          <div className="relative">
            <select
              value={sortMode}
              onChange={e => setSortMode(e.target.value as SortMode)}
              className="appearance-none bg-white border border-gray-200 rounded-lg pl-3 pr-8 py-2 text-sm text-gray-700 cursor-pointer hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
            >
              <option value="vendor">按供应商</option>
              <option value="date">按时间</option>
              <option value="port">按港口</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800">
            <ArrowLeft className="w-4 h-4" />
            Back to Processing
          </Link>
        </div>
      </div>

      {groupKeys.map(groupName => {
        const pos = groupsMap.get(groupName)!
        const groupTotal = pos.reduce((s, p) => s + p.total_amount, 0)
        return (
          <div key={groupName} className="mb-5 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="bg-gray-50 px-5 py-3 flex items-center justify-between border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-gray-400" />
                <span className="font-semibold text-gray-800">{groupName}</span>
                <span className="text-xs text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">
                  {pos.length} PO{pos.length !== 1 ? 's' : ''}
                </span>
              </div>
              <span className="text-sm font-medium text-gray-600">
                ${groupTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
                      {sortMode !== 'vendor' && (
                        <>
                          <span className="text-gray-300">·</span>
                          <span className="text-xs text-gray-500">{po.vendor}</span>
                        </>
                      )}
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
