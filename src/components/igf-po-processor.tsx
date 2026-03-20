'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
  Upload,
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
  expShipDate?: string
  lineItems: LineItem[]
  totalAmount: number
  notes?: string
  branch?: string
  freightTerm?: string
  status: 'parsed' | 'syncing' | 'synced' | 'error'
  qbId?: string
  qbDocNumber?: string
  error?: string
  syncedAt?: string
}

interface HistoryPO {
  poNumber: string
  vendorName: string
  shipTo: string
  totalAmount: number
  qbId?: string
  qbDocNumber?: string
  syncedAt?: string
  sourceData?: {
    poNumber: string
    vendorName: string
    shipTo: string
    date: string
    expShipDate?: string
    lineItems: LineItem[]
    totalAmount: number
    notes?: string
    branch?: string
    freightTerm?: string
  }
}

function buildActivityStamp() {
  return `${new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} PST`
}

function saveToHistory(po: ParsedPO, activityAt = po.syncedAt) {
  try {
    const key = 'igf_synced_pos'
    const existing = JSON.parse(localStorage.getItem(key) || '[]')
    const docNumber = po.qbDocNumber || po.poNumber
    const filtered = existing.filter((item: HistoryPO) =>
      item.poNumber !== po.poNumber &&
      item.poNumber !== docNumber &&
      item.qbDocNumber !== docNumber,
    )
    filtered.unshift({
      poNumber: docNumber,
      vendorName: po.vendorName,
      shipTo: po.shipTo,
      totalAmount: po.totalAmount,
      qbId: po.qbId,
      qbDocNumber: po.qbDocNumber,
      syncedAt: activityAt,
      sourceData: {
        poNumber: docNumber,
        vendorName: po.vendorName,
        shipTo: po.shipTo,
        date: po.date,
        expShipDate: po.expShipDate,
        lineItems: po.lineItems,
        totalAmount: po.totalAmount,
        notes: po.notes,
        branch: po.branch,
        freightTerm: po.freightTerm,
      },
    })
    localStorage.setItem(key, JSON.stringify(filtered.slice(0, 500)))
  } catch (_) {
    // localStorage unavailable
  }
}

function formatMoney(value: number) {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function getStatusMeta(status: ParsedPO['status']) {
  switch (status) {
    case 'parsed':
      return {
        label: 'Ready',
        className: 'border-[var(--warm-soft)] bg-[var(--warm-soft)] text-[var(--warm)]',
      }
    case 'syncing':
      return {
        label: 'Syncing',
        className: 'border-[var(--border)] bg-[rgba(22,33,42,0.08)] text-[var(--ink)]',
      }
    case 'synced':
      return {
        label: 'In QuickBooks',
        className: 'border-[var(--accent-soft)] bg-[var(--accent-soft)] text-[var(--accent)]',
      }
    case 'error':
      return {
        label: 'Needs review',
        className: 'border-[var(--danger-soft)] bg-[var(--danger-soft)] text-[var(--danger)]',
      }
  }
}

export function IGFPOProcessor() {
  const [orders, setOrders] = useState<ParsedPO[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [parsingFiles, setParsingFiles] = useState<string[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isBatchSyncing, setIsBatchSyncing] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ordersRef = useRef<ParsedPO[]>([])
  const parsingFilesRef = useRef<string[]>([])
  const batchSyncRef = useRef(false)

  const openFilePicker = useCallback(() => {
    const input = fileInputRef.current
    if (!input) return

    const pickerInput = input as HTMLInputElement & { showPicker?: () => void }
    if (typeof pickerInput.showPicker === 'function') {
      try {
        pickerInput.showPicker()
        return
      } catch {
        // Fall back to click when showPicker is unsupported or blocked.
      }
    }

    input.click()
  }, [])

  useEffect(() => {
    ordersRef.current = orders
  }, [orders])

  useEffect(() => {
    parsingFilesRef.current = parsingFiles
  }, [parsingFiles])

  useEffect(() => {
    batchSyncRef.current = isBatchSyncing
  }, [isBatchSyncing])

  useEffect(() => {
    const openUpload = () => {
      openFilePicker()
    }

    window.addEventListener('igf-open-upload', openUpload)
    return () => {
      window.removeEventListener('igf-open-upload', openUpload)
    }
  }, [openFilePicker])

  const parseFile = useCallback(async (file: File) => {
    const tempId = `${file.name}-${Date.now()}`
    setParsingFiles((prev) => [...prev, file.name])
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/parse-pdf', { method: 'POST', body: formData })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Parse failed')
      const po: ParsedPO = { ...data.po, id: tempId, fileName: file.name, status: 'parsed' }
      setOrders((prev) => {
        const index = prev.findIndex((item) => item.poNumber === po.poNumber)
        if (index >= 0) {
          const next = [...prev]
          next[index] = { ...po, id: prev[index].id }
          return next
        }
        return [...prev, po]
      })
    } catch (err) {
      console.error(`Failed to parse ${file.name}:`, err)
    } finally {
      setParsingFiles((prev) => prev.filter((name) => name !== file.name))
    }
  }, [])

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
    Array.from(event.dataTransfer.files)
      .filter((file) => file.type === 'application/pdf')
      .forEach(parseFile)
  }, [parseFile])

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(event.target.files || [])
      .filter((file) => file.type === 'application/pdf')
      .forEach(parseFile)
    event.target.value = ''
  }

  const syncOrder = useCallback(async (order: ParsedPO) => {
    setOrders((prev) => prev.map((item) => item.id === order.id ? { ...item, status: 'syncing' } : item))
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
          expShipDate: order.expShipDate,
          lineItems: order.lineItems,
          totalAmount: order.totalAmount,
          notes: order.notes,
          branch: order.branch,
          freightTerm: order.freightTerm,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)

      const syncedAt = buildActivityStamp()

      const updated: ParsedPO = {
        ...order,
        status: 'synced',
        qbId: data.purchaseOrder.id,
        qbDocNumber: data.purchaseOrder.docNumber,
        syncedAt,
      }

      setOrders((prev) => prev.map((item) => item.id === order.id ? updated : item))
      saveToHistory(updated)
    } catch (err) {
      setOrders((prev) => prev.map((item) =>
        item.id === order.id
          ? { ...item, status: 'error', error: err instanceof Error ? err.message : 'Sync failed' }
          : item
      ))
    }
  }, [])

  const downloadOrderPdf = useCallback(async (order: ParsedPO) => {
    setDownloadingId(order.id)
    try {
      const docNumber = order.qbDocNumber || order.poNumber
      const response = await fetch(`/api/generate-po-pdf/${encodeURIComponent(docNumber)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poNumber: docNumber,
          vendorName: order.vendorName,
          shipTo: order.shipTo,
          date: order.date,
          expShipDate: order.expShipDate,
          lineItems: order.lineItems,
          totalAmount: order.totalAmount,
          notes: order.notes,
          branch: order.branch,
          freightTerm: order.freightTerm,
        }),
      })
      if (!response.ok) {
        throw new Error(`PDF export failed for ${docNumber}`)
      }

      const fileBlob = await response.blob()
      const url = URL.createObjectURL(fileBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `PO-${docNumber}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      saveToHistory(order, order.syncedAt || buildActivityStamp())
    } catch (error) {
      console.error('PDF export failed:', error)
      setOrders((prev) => prev.map((item) =>
        item.id === order.id
          ? { ...item, error: error instanceof Error ? error.message : 'PDF export failed' }
          : item
      ))
    } finally {
      setDownloadingId(null)
    }
  }, [])

  const syncAll = useCallback(async () => {
    if (batchSyncRef.current) return

    setIsBatchSyncing(true)
    try {
      while (true) {
        const nextOrder = ordersRef.current.find((item) => item.status === 'parsed' || item.status === 'error')

        if (nextOrder) {
          await syncOrder(nextOrder)
          continue
        }

        if (parsingFilesRef.current.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          continue
        }

        break
      }
    } finally {
      setIsBatchSyncing(false)
    }
  }, [syncOrder])

  const removeOrder = (id: string) => {
    setOrders((prev) => prev.filter((item) => item.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  const parsed = orders.filter((item) => item.status === 'parsed').length
  const synced = orders.filter((item) => item.status === 'synced').length
  const errors = orders.filter((item) => item.status === 'error').length
  const isSyncing = isBatchSyncing || orders.some((item) => item.status === 'syncing')
  const isProcessing = parsingFiles.length > 0

  const summaryCards = [
    {
      label: 'PDFs loaded',
      value: orders.length,
      tone: 'text-[var(--ink)]',
      note: orders.length > 0 ? 'Current intake queue' : 'Waiting for upload',
    },
    {
      label: 'Ready to sync',
      value: parsed,
      tone: 'text-[var(--warm)]',
      note: parsed > 0 ? 'Validated and staged' : 'No clean records yet',
    },
    {
      label: 'In QuickBooks',
      value: synced,
      tone: 'text-[var(--accent)]',
      note: synced > 0 ? 'Exportable right now' : 'Nothing pushed yet',
    },
    {
      label: 'Errors',
      value: errors,
      tone: 'text-[var(--danger)]',
      note: errors > 0 ? 'Requires a retry' : 'Queue is healthy',
    },
  ]

  return (
    <div className="space-y-8">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false)
          }}
          onDrop={handleDrop}
          onClick={openFilePicker}
          className={[
            'panel subtle-grid min-h-[320px] cursor-pointer border-2 border-dashed px-6 py-8 transition duration-200 md:px-8 md:py-10',
            isDragging
              ? 'scale-[1.01] border-[var(--accent)] bg-[rgba(15,118,110,0.08)]'
              : isProcessing
                ? 'border-[#d8b183] bg-[rgba(198,123,45,0.08)]'
                : 'border-[rgba(22,33,42,0.14)] hover:-translate-y-0.5 hover:border-[var(--warm)]',
          ].join(' ')}
        >
          <input
            id="igf-upload-input"
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            className="sr-only"
            onChange={handleFiles}
          />

          <div className="flex h-full flex-col justify-between gap-8">
            <div className="max-w-2xl">
              <div className="eyebrow">Upload PO PDFs</div>
              {isProcessing ? (
                <div className="mt-6 flex flex-col gap-4">
                  <div className="inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-[var(--warm-soft)] text-[var(--warm)]">
                    <Loader2 className="h-7 w-7 animate-spin" />
                  </div>
                  <div>
                    <h2 className="section-title">Parsing incoming PDFs</h2>
                    <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                      Processing {parsingFiles.length} file{parsingFiles.length === 1 ? '' : 's'} now.
                    </p>
                    <p className="mt-3 text-sm font-medium text-[var(--ink)]">
                      {parsingFiles.slice(0, 3).join(', ')}
                      {parsingFiles.length > 3 ? ` +${parsingFiles.length - 3} more` : ''}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  <div className={`inline-flex h-16 w-16 items-center justify-center rounded-3xl ${isDragging ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-white/80 text-[var(--ink)]'}`}>
                    <Upload className="h-7 w-7" />
                  </div>
                  <div>
                    <h2 className="section-title">
                      {isDragging
                        ? 'Release to add the batch'
                        : orders.length > 0
                          ? 'Drop another IGF purchase order'
                          : 'Upload IGF purchase orders here'}
                    </h2>
                    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          openFilePicker()
                        }}
                        className="btn-primary w-full justify-center sm:w-auto"
                      >
                        <Upload className="h-4 w-4" />
                        Upload PO PDFs
                      </button>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                        Click or drop PDF files here
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  label: 'Batch upload',
                  value: 'Multiple PDFs',
                },
                {
                  label: 'Accepted format',
                  value: 'Original PDF only',
                },
                {
                  label: 'Queue state',
                  value: orders.length > 0 ? `${orders.length} loaded` : 'Waiting for intake',
                },
              ].map((item) => (
                <div key={item.label} className="rounded-[24px] border border-[var(--border)] bg-white/70 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                    {item.label}
                  </div>
                  <div className="mt-3 text-sm font-semibold text-[var(--ink)]">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {summaryCards.map((card) => (
            <div key={card.label} className="panel px-5 py-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                {card.label}
              </div>
              <div className={`font-data mt-3 text-3xl font-semibold ${card.tone}`}>{card.value}</div>
              <p className="mt-2 text-sm text-[var(--muted)]">{card.note}</p>
            </div>
          ))}
        </div>
      </section>

      {orders.length > 0 && (
        <section className="panel px-5 py-5 md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="eyebrow">Queue control</div>
              <h2 className="section-title mt-4">Review and sync the current batch</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {isProcessing
                  ? `${parsingFiles.length} still parsing. Sync queue will continue automatically.`
                  : parsed > 0
                    ? `${parsed} ready to sync.`
                    : 'No ready records.'}
                {errors > 0 ? ` ${errors} need attention.` : ''}
              </p>
            </div>
            <button
              onClick={syncAll}
              disabled={isSyncing || ((parsed === 0 && errors === 0) && !isProcessing)}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isSyncing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Syncing full batch
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Sync all to QuickBooks
                </>
              )}
            </button>
          </div>
        </section>
      )}

      {orders.length > 0 ? (
        <section className="panel px-5 py-5 md:px-6">
          <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-5 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="eyebrow">PO review queue</div>
              <h2 className="section-title mt-4">Inspect the parsed records before sending</h2>
            </div>
            <p className="text-sm leading-6 text-[var(--muted)]">
              Expand a card to inspect line descriptions, totals, notes, and QuickBooks links.
            </p>
          </div>

          <div className="mt-5 space-y-4">
            {orders.map((order) => {
              const statusMeta = getStatusMeta(order.status)
              return (
                <article key={order.id} className="rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.76)] p-5">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="grid flex-1 gap-4 md:grid-cols-[1.2fr_1fr_1fr_auto]">
                      <div className="min-w-0">
                        <p className="font-data text-sm font-semibold uppercase tracking-[0.16em] text-[var(--ink)]">
                          {order.poNumber}
                        </p>
                        <p className="mt-2 truncate text-xs text-[var(--muted)]">{order.fileName}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">Order date {order.date}</p>
                        {order.expShipDate && (
                          <p className="mt-1 text-xs text-[var(--muted)]">Exp ship date {order.expShipDate}</p>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                          Vendor
                        </div>
                        <p className="mt-2 truncate text-sm font-medium text-[var(--ink)]">{order.vendorName}</p>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                          Destination
                        </div>
                        <p className="mt-2 truncate text-sm text-[var(--muted)]">{order.shipTo}</p>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                          Amount
                        </div>
                        <p className="font-data mt-2 text-sm font-semibold text-[var(--ink)]">
                          {formatMoney(order.totalAmount)}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${statusMeta.className}`}>
                        {order.status === 'syncing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        {statusMeta.label}
                      </span>

                      {order.status === 'parsed' && (
                        <button
                          onClick={() => syncOrder(order)}
                          className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5"
                        >
                          <Send className="h-4 w-4" />
                          Send to QB
                        </button>
                      )}

                      {order.status === 'error' && (
                        <button
                          onClick={() => syncOrder(order)}
                          title={order.error}
                          className="inline-flex items-center gap-2 rounded-full bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5"
                        >
                          <RefreshCw className="h-4 w-4" />
                          Retry
                        </button>
                      )}

                      {order.status !== 'syncing' && (
                        <button
                          type="button"
                          onClick={() => downloadOrderPdf(order)}
                          disabled={downloadingId === order.id}
                          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#0c645e]"
                        >
                          {downloadingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          Download PDF
                        </button>
                      )}

                      <button
                        onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:-translate-y-0.5"
                      >
                        {expandedId === order.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        Details
                      </button>

                      <button
                        onClick={() => removeOrder(order.id)}
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--muted)] transition hover:-translate-y-0.5 hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </button>
                    </div>
                  </div>

                  {expandedId === order.id && (
                    <div className="mt-5 rounded-[22px] border border-[var(--border)] bg-[rgba(255,255,255,0.72)] p-4">
                      <div className="overflow-x-auto">
                        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--bg-strong)] px-4 py-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Order date</div>
                            <div className="mt-2 text-sm font-medium text-[var(--ink)]">{order.date}</div>
                          </div>
                          {order.expShipDate && (
                            <div className="rounded-[18px] border border-[var(--border)] bg-[var(--bg-strong)] px-4 py-3">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Exp ship date</div>
                              <div className="mt-2 text-sm font-medium text-[var(--ink)]">{order.expShipDate}</div>
                            </div>
                          )}
                          {order.freightTerm && (
                            <div className="rounded-[18px] border border-[var(--border)] bg-[var(--bg-strong)] px-4 py-3">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Freight term</div>
                              <div className="mt-2 text-sm font-medium text-[var(--ink)]">{order.freightTerm}</div>
                            </div>
                          )}
                          {order.branch && (
                            <div className="rounded-[18px] border border-[var(--border)] bg-[var(--bg-strong)] px-4 py-3">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Branch</div>
                              <div className="mt-2 text-sm font-medium text-[var(--ink)]">{order.branch}</div>
                            </div>
                          )}
                        </div>
                        <table className="w-full min-w-[720px] text-sm">
                          <thead>
                            <tr className="border-b border-[var(--border)] text-left text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                              <th className="pb-3 pr-4">Description</th>
                              <th className="pb-3 text-right">Qty</th>
                              <th className="pb-3 text-right">Unit price</th>
                              <th className="pb-3 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {order.lineItems.map((item, index) => (
                              <tr key={index} className="border-b border-[rgba(22,33,42,0.06)] last:border-b-0">
                                <td className="whitespace-pre-line py-3 pr-4 leading-6 text-[var(--ink)]">{item.description}</td>
                                <td className="py-3 text-right text-[var(--muted)]">{item.quantity}</td>
                                <td className="py-3 text-right text-[var(--muted)]">{formatMoney(item.unitPrice)}</td>
                                <td className="py-3 text-right font-semibold text-[var(--ink)]">{formatMoney(item.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td colSpan={3} className="pt-4 text-right text-sm font-semibold text-[var(--muted)]">
                                Total
                              </td>
                              <td className="pt-4 text-right font-data text-sm font-semibold text-[var(--ink)]">
                                {formatMoney(order.totalAmount)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      {order.notes && (
                        <div className="mt-4 rounded-[18px] border border-[var(--border)] bg-[var(--bg-strong)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">
                          {order.notes}
                        </div>
                      )}

                      {order.qbId && (
                        <div className="mt-4 flex flex-col gap-2 text-sm text-[var(--muted)]">
                          {order.syncedAt && <p>Synced {order.syncedAt}</p>}
                          <a
                            href={`https://qbo.intuit.com/app/purchaseorder?txnId=${order.qbId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-[var(--accent)]"
                          >
                            Open PO {order.qbDocNumber ? `#${order.qbDocNumber}` : order.poNumber} in QuickBooks
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      ) : (
        !isProcessing && (
          <section className="panel px-6 py-14 text-center md:px-8">
            <div className="mx-auto inline-flex rounded-[24px] bg-[var(--accent-soft)] p-4 text-[var(--accent)]">
              <FileText className="h-8 w-8" />
            </div>
            <h2 className="section-title mt-6">No purchase orders in the queue yet.</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">
              Drop an IGF PDF above and the parsed record will appear here with vendor data, destination, amount, and line details ready for review.
            </p>
          </section>
        )
      )}
    </div>
  )
}
