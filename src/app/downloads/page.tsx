'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import JSZip from 'jszip'
import { ArrowLeft, CheckSquare, Clock3, Download, ExternalLink, FileText, History, Loader2, Square } from 'lucide-react'

interface SyncedPO {
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
    lineItems: Array<{
      description: string
      quantity?: number
      qty?: number
      unitPrice?: number
      amount: number
    }>
    totalAmount: number
    notes?: string
    branch?: string
    freightTerm?: string
  }
}

export default function DownloadsPage() {
  const [pos, setPos] = useState<SyncedPO[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [isBatchDownloading, setIsBatchDownloading] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [batchError, setBatchError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('igf_synced_pos') || '[]')
      const next = Array.isArray(stored) ? stored : []
      setPos(next)
      setSelectedKeys(next.map((po, index) => `${po.qbDocNumber || po.poNumber}-${index}`))
    } catch (_) {
      setPos([])
      setSelectedKeys([])
    }
    setLoaded(true)
  }, [])

  const totalValue = pos.reduce((sum, po) => sum + (po.totalAmount || 0), 0)
  const latestSync = pos[0]?.syncedAt
  const selectedCount = selectedKeys.length
  const allSelected = pos.length > 0 && selectedCount === pos.length

  function getEntryKey(po: SyncedPO, index: number) {
    return `${po.qbDocNumber || po.poNumber}-${index}`
  }

  function toggleSelection(key: string) {
    setSelectedKeys((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key])
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedKeys([])
      return
    }
    setSelectedKeys(pos.map((po, index) => getEntryKey(po, index)))
  }

  async function fetchPdf(po: SyncedPO) {
    const docNumber = po.qbDocNumber || po.poNumber
    if (po.sourceData) {
      return fetch(`/api/generate-po-pdf/${encodeURIComponent(docNumber)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(po.sourceData),
      })
    }
    return fetch(`/api/generate-po-pdf/${encodeURIComponent(docNumber)}`)
  }

  async function downloadBatch() {
    const selected = pos.filter((po, index) => selectedKeys.includes(getEntryKey(po, index)))
    if (selected.length === 0) {
      setBatchError('Select at least one PO first.')
      return
    }

    setBatchError(null)
    setIsBatchDownloading(true)
    setBatchProgress({ current: 0, total: selected.length })

    try {
      const zip = new JSZip()

      for (let i = 0; i < selected.length; i++) {
        const po = selected[i]
        const docNumber = po.qbDocNumber || po.poNumber
        const response = await fetchPdf(po)
        if (!response.ok) {
          throw new Error(`Failed to generate PDF for ${docNumber}`)
        }

        const fileBlob = await response.blob()
        zip.file(`PO-${docNumber}.pdf`, fileBlob)
        setBatchProgress({ current: i + 1, total: selected.length })
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 10)
      link.href = url
      link.download = `igf-orders-${stamp}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : 'Batch download failed')
    } finally {
      setIsBatchDownloading(false)
      setBatchProgress(null)
    }
  }

  return (
    <main className="pb-16 pt-8 md:pb-24 md:pt-12">
      <section className="site-shell">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <div className="panel subtle-grid px-6 py-8 md:px-8 md:py-10">
            <span className="eyebrow">Downloads desk</span>
            <div className="mt-6 max-w-3xl space-y-4">
              <h1 className="display-title">Pull the final vendor PDFs for the current batch.</h1>
              <p className="max-w-2xl text-base leading-7 text-[var(--muted)] md:text-lg">
                This browser keeps a rolling history of processed purchase orders so you can reopen the generated PDF or jump straight into QuickBooks when it is available.
              </p>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                {
                  label: 'Tracked POs',
                  value: loaded ? pos.length.toString() : '--',
                  tone: 'text-[var(--ink)]',
                },
                {
                  label: 'Total value',
                  value: loaded ? `$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '--',
                  tone: 'text-[var(--accent)]',
                },
                {
                  label: 'Latest activity',
                  value: loaded ? (latestSync || 'No sync yet') : '--',
                  tone: 'text-[var(--warm)]',
                },
              ].map((item) => (
                <div key={item.label} className="rounded-[24px] border border-[var(--border)] bg-white/72 p-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    {item.label}
                  </div>
                  <div className={`mt-3 text-sm font-semibold ${item.tone} ${item.label === 'Latest activity' ? '' : 'font-data text-xl'}`}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="panel px-6 py-7">
            <Link href="/" className="btn-secondary w-full justify-between">
              <span className="inline-flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to processing
              </span>
              <History className="h-4 w-4" />
            </Link>
            <div className="mt-6 rounded-[24px] border border-[var(--border)] bg-white/72 p-5">
              <p className="text-sm font-semibold text-[var(--ink)]">Download options</p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                All orders are selected by default. One click downloads the whole batch as one ZIP file.
              </p>
            </div>
          </aside>
        </div>
      </section>

      <section className="site-shell mt-8">
        {loaded && pos.length === 0 && (
          <div className="panel px-6 py-16 text-center md:px-8">
            <div className="mx-auto inline-flex rounded-[24px] bg-[var(--accent-soft)] p-4 text-[var(--accent)]">
              <FileText className="h-8 w-8" />
            </div>
            <h2 className="section-title mt-6">No processed POs in this browser yet.</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">
              Sync a purchase order from the main intake page and it will appear here automatically.
            </p>
            <Link href="/" className="btn-primary mt-6">
              Return to the intake queue
            </Link>
          </div>
        )}

        {loaded && pos.length > 0 && (
          <div className="panel px-5 py-5 md:px-6">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-5 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="eyebrow">Processed output</div>
                <h2 className="section-title mt-4">Recent purchase orders</h2>
              </div>
              <p className="text-sm leading-6 text-[var(--muted)]">
                One click downloads the current batch. You can still uncheck any row you do not want.
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-3 rounded-[24px] border border-[var(--border)] bg-white/72 p-4 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:-translate-y-0.5"
                >
                {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  {allSelected ? 'Clear selection' : 'Select all'}
                </button>
                <p className="text-sm text-[var(--muted)]">
                  {selectedCount} ready
                </p>
                {batchProgress && (
                  <p className="text-sm text-[var(--muted)]">
                    Preparing {batchProgress.current}/{batchProgress.total}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={downloadBatch}
                disabled={isBatchDownloading || selectedCount === 0}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-55"
              >
                {isBatchDownloading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Building ZIP
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    {allSelected ? 'Download all ZIP' : 'Download selected ZIP'}
                  </>
                )}
              </button>
            </div>

            {batchError && (
              <div className="mt-4 rounded-[18px] border border-[rgba(188,81,53,0.18)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
                {batchError}
              </div>
            )}

            <div className="mt-5 space-y-4">
              {pos.map((po, index) => (
                <article key={`${po.poNumber}-${index}`} className="rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.76)] p-5">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                    <div className="grid flex-1 gap-4 md:grid-cols-[auto_1.1fr_1fr_1fr_auto]">
                      <button
                        type="button"
                        onClick={() => toggleSelection(getEntryKey(po, index))}
                        className="inline-flex h-10 w-10 items-center justify-center self-start rounded-2xl border border-[var(--border)] bg-white text-[var(--ink)] transition hover:-translate-y-0.5"
                        aria-label={`Select PO ${po.poNumber}`}
                      >
                        {selectedKeys.includes(getEntryKey(po, index)) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0">
                        <p className="font-data text-sm font-semibold uppercase tracking-[0.16em] text-[var(--ink)]">
                          {po.poNumber}
                        </p>
                        {po.syncedAt && (
                          <p className="mt-2 inline-flex items-center gap-2 text-xs text-[var(--muted)]">
                            <Clock3 className="h-3.5 w-3.5" />
                            {po.syncedAt}
                          </p>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                          Vendor
                        </div>
                        <p className="mt-2 truncate text-sm font-medium text-[var(--ink)]">{po.vendorName}</p>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                          Destination
                        </div>
                        <p className="mt-2 truncate text-sm text-[var(--muted)]">{po.shipTo}</p>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                          Amount
                        </div>
                        <p className="font-data mt-2 text-sm font-semibold text-[var(--ink)]">
                          ${(po.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setBatchError(null)
                          const response = await fetchPdf(po)
                          if (!response.ok) {
                            setBatchError(`Failed to generate PDF for ${po.qbDocNumber || po.poNumber}`)
                            return
                          }
                          const fileBlob = await response.blob()
                          const url = URL.createObjectURL(fileBlob)
                          const link = document.createElement('a')
                          link.href = url
                          link.download = `PO-${po.qbDocNumber || po.poNumber}.pdf`
                          document.body.appendChild(link)
                          link.click()
                          link.remove()
                          URL.revokeObjectURL(url)
                        }}
                        className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#0c645e]"
                      >
                        <Download className="h-4 w-4" />
                        Download PDF
                      </button>
                      {po.qbId && (
                        <a
                          href={`https://qbo.intuit.com/app/purchaseorder?txnId=${po.qbId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:-translate-y-0.5"
                        >
                          Open QuickBooks
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
