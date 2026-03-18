'use client'

import { useState, useCallback, useRef } from 'react'
import {
  Upload, FileText, CheckCircle2, Download,
  Loader2, Send, Trash2, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react'

interface LineItem {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

interface ParsedPO {
  id: string
  fileName: string
  poNumber: string
  vendorName: string
  shipTo: string
  date: string
  lineItems: LineItem[]
  totalAmount: number
  notes?: string
  status: 'parsed' | 'syncing' | 'synced' | 'error'
  qbId?: string
  qbDocNumber?: string
  error?: string
  syncedAt?: string
}

function saveToHistory(po: ParsedPO) {
  try {
    const key = 'igf_synced_pos'
    const existing = JSON.parse(localStorage.getItem(key) || '[]')
    // Replace if same PO number already exists, otherwise prepend
    const filtered = existing.filter((p: { poNumber: string }) => p.poNumber !== po.poNumber)
    filtered.unshift({
      poNumber: po.qbDocNumber || po.poNumber,
      vendorName: po.vendorName,
      shipTo: po.shipTo,
      totalAmount: po.totalAmount,
      qbId: po.qbId,
      qbDocNumber: po.qbDocNumber,
      syncedAt: po.syncedAt,
    })
    localStorage.setItem(key, JSON.stringify(filtered.slice(0, 500)))
  } catch (_) { /* localStorage unavailable */ }
}

export function IGFPOProcessor() {
  const [orders, setOrders] = useState<ParsedPO[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [parsingFiles, setParsingFiles] = useState<string[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const parseFile = useCallback(async (file: File) => {
    const tempId = `${file.name}-${Date.now()}`
    setParsingFiles(prev => [...prev, file.name])
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/parse-pdf', { method: 'POST', body: formData })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Parse failed')
      const po: ParsedPO = { ...data.po, id: tempId, fileName: file.name, status: 'parsed' }
      setOrders(prev => {
        const idx = prev.findIndex(o => o.poNumber === po.poNumber)
        if (idx >= 0) { const u = [...prev]; u[idx] = { ...po, id: prev[idx].id }; return u }
        return [...prev, po]
      })
    } catch (err) {
      console.error(`Failed to parse ${file.name}:`, err)
    } finally {
      setParsingFiles(prev => prev.filter(n => n !== file.name))
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf').forEach(parseFile)
  }, [parseFile])

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files || []).filter(f => f.type === 'application/pdf').forEach(parseFile)
    e.target.value = ''
  }

  const syncOrder = async (order: ParsedPO) => {
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'syncing' } : o))
    try {
      const res = await fetch('/api/quickbooks/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poNumber: order.poNumber,
          customerPONumber: order.poNumber,
          vendorName: order.vendorName,
          shipTo: order.shipTo,
          date: order.date,
          lineItems: order.lineItems,
          totalAmount: order.totalAmount,
          notes: order.notes,
        }),
      })
      const data = await res.json()
      if (data.success) {
        const syncedAt = new Date().toLocaleString('en-US', {
          timeZone: 'America/Los_Angeles',
          month: '2-digit', day: '2-digit', year: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        }) + ' PST'
        const updated: ParsedPO = {
          ...order,
          status: 'synced',
          qbId: data.purchaseOrder.id,
          qbDocNumber: data.purchaseOrder.docNumber,
          syncedAt,
        }
        setOrders(prev => prev.map(o => o.id === order.id ? updated : o))
        saveToHistory(updated)
      } else throw new Error(data.error)
    } catch (err) {
      setOrders(prev => prev.map(o =>
        o.id === order.id ? { ...o, status: 'error', error: err instanceof Error ? err.message : 'Sync failed' } : o
      ))
    }
  }

  const syncAll = async () => {
    for (const order of orders.filter(o => o.status === 'parsed' || o.status === 'error')) {
      await syncOrder(order)
    }
  }

  const removeOrder = (id: string) => {
    setOrders(prev => prev.filter(o => o.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  const parsed = orders.filter(o => o.status === 'parsed').length
  const synced = orders.filter(o => o.status === 'synced').length
  const errors = orders.filter(o => o.status === 'error').length
  const isSyncing = orders.some(o => o.status === 'syncing')
  const isProcessing = parsingFiles.length > 0

  return (
    <div className="space-y-5">
      {orders.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'PDFs Loaded', value: orders.length, color: 'text-gray-900' },
            { label: 'Ready to Sync', value: parsed, color: 'text-amber-600' },
            { label: 'In QuickBooks', value: synced, color: 'text-emerald-600' },
            { label: 'Errors', value: errors, color: 'text-red-500' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false) }}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={[
          'border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 select-none',
          orders.length === 0 ? 'py-20' : 'py-10',
          isDragging ? 'border-blue-400 bg-blue-50 scale-[1.005]'
          : isProcessing ? 'border-amber-300 bg-amber-50'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
        ].join(' ')}
      >
        <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleFiles} />
        <div className="flex flex-col items-center gap-3">
          {isProcessing ? (
            <>
              <Loader2 className="w-9 h-9 text-amber-500 animate-spin" />
              <div className="text-center">
                <p className="font-medium text-amber-700">Parsing {parsingFiles.length} PDF{parsingFiles.length > 1 ? 's' : ''}…</p>
                <p className="text-xs text-amber-600 mt-1">{parsingFiles.slice(0, 3).join(' · ')}{parsingFiles.length > 3 ? ` +${parsingFiles.length - 3} more` : ''}</p>
              </div>
            </>
          ) : (
            <>
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${isDragging ? 'bg-blue-100' : 'bg-gray-100'}`}>
                <Upload className={`w-6 h-6 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
              </div>
              <div className="text-center">
                <p className={`font-semibold text-base ${isDragging ? 'text-blue-700' : 'text-gray-800'}`}>
                  {isDragging ? 'Release to parse' : orders.length > 0 ? 'Drop more IGF PDFs' : 'Drop IGF PO PDFs here'}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  {isDragging ? 'PDFs will be parsed automatically' : 'Multiple files supported · click to browse'}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
      {(parsed > 0 || errors > 0) && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {parsed > 0 && `${parsed} order${parsed > 1 ? 's' : ''} ready`}
            {parsed > 0 && errors > 0 && ' · '}
            {errors > 0 && `${errors} failed`}
          </p>
          <button onClick={syncAll} disabled={isSyncing}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            {isSyncing ? <><Loader2 className="w-4 h-4 animate-spin" /> Syncing…</> : <><Send className="w-4 h-4" /> Sync All to QuickBooks</>}
          </button>
        </div>
      )}
      {orders.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
          <div className="grid grid-cols-4 gap-4 px-5 py-3 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <span>PO Number</span><span>Vendor</span><span>Ship To</span><span className="text-right">Amount</span>
          </div>
          {orders.map(order => (
            <div key={order.id}>
              <div className="flex items-center px-5 py-4 gap-3 hover:bg-gray-50 transition-colors">
                <div className="flex-1 grid grid-cols-4 gap-4 min-w-0">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-gray-900 truncate">{order.poNumber}</p>
                    <p className="text-xs text-gray-400 truncate">{order.fileName}</p>
                  </div>
                  <div className="min-w-0"><p className="text-sm text-gray-700 truncate">{order.vendorName}</p></div>
                  <div className="min-w-0"><p className="text-sm text-gray-500 truncate">{order.shipTo}</p></div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">${order.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {order.status === 'parsed' && (
                    <button onClick={() => syncOrder(order)} className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                      <Send className="w-3 h-3" /> Send to QB
                    </button>
                  )}
                  {order.status === 'syncing' && <span className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Syncing</span>}
                  {order.status === 'synced' && (
                    <>
                      <a
                        href={`/api/generate-po-pdf/${order.qbDocNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                        onClick={e => e.stopPropagation()}
                      >
                        <Download className="w-3 h-3" /> Download PDF
                      </a>
                      <span className="text-xs bg-emerald-50 text-emerald-700 font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3" /> In QuickBooks
                      </span>
                    </>
                  )}
                  {order.status === 'error' && (
                    <button onClick={() => syncOrder(order)} title={order.error} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                      <RefreshCw className="w-3 h-3" /> Retry
                    </button>
                  )}
                  <button onClick={() => setExpandedId(expandedId === order.id ? null : order.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                    {expandedId === order.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <button onClick={() => removeOrder(order.id)} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {expandedId === order.id && (
                <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-400 border-b border-gray-200">
                        <th className="text-left font-medium pb-2">Description</th>
                        <th className="text-right font-medium pb-2 w-14">Qty</th>
                        <th className="text-right font-medium pb-2 w-28">Unit Price</th>
                        <th className="text-right font-medium pb-2 w-24">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {order.lineItems.map((item, i) => (
                        <tr key={i}>
                          <td className="py-2 text-gray-700 pr-4 leading-snug">{item.description}</td>
                          <td className="py-2 text-right text-gray-600">{item.quantity}</td>
                          <td className="py-2 text-right text-gray-600">${item.unitPrice.toFixed(2)}</td>
                          <td className="py-2 text-right font-medium text-gray-900">${item.amount.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200">
                        <td colSpan={3} className="pt-3 text-right text-sm font-semibold text-gray-700">Total</td>
                        <td className="pt-3 text-right font-bold text-gray-900">${order.totalAmount.toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                  {order.notes && <p className="mt-3 text-xs text-gray-500 bg-white rounded-lg px-3 py-2 border border-gray-100">{order.notes}</p>}
                  {order.qbId && (
                    <div className="mt-3 space-y-1">
                      {order.syncedAt && <p className="text-xs text-gray-400">Synced: {order.syncedAt}</p>}
                      <a href={`https://qbo.intuit.com/app/purchaseorder?txnId=${order.qbId}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                        View in QuickBooks →{order.qbDocNumber && ` QB #${order.qbDocNumber}`}
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {orders.length === 0 && !isProcessing && (
        <div className="text-center py-10">
          <FileText className="w-10 h-10 mx-auto mb-3 text-gray-200" />
          <p className="text-sm text-gray-400">Drop IGF PDFs above — each will be parsed and ready to sync</p>
        </div>
      )}
    </div>
  )
}
