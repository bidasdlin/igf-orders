'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { IGFPOProcessor } from '@/components/igf-po-processor'

export default function Home() {
  function openUpload() {
    document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

    const input = document.getElementById('igf-upload-input') as (HTMLInputElement & { showPicker?: () => void }) | null
    if (!input) {
      window.dispatchEvent(new Event('igf-open-upload'))
      return
    }

    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker()
        return
      } catch {
        // Fall through to click when showPicker is blocked.
      }
    }

    input.click()
  }

  return (
    <main className="pb-16 pt-8 md:pb-24 md:pt-12">
      <section className="site-shell">
        <div className="panel subtle-grid px-6 py-8 md:px-8 md:py-10">
          <span className="eyebrow enter-fade">IGF order desk</span>
          <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <h1 className="display-title enter-fade stagger-1">
              ORDER CONVERT
            </h1>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={openUpload} className="btn-primary justify-center">
                Upload PO PDFs
                <ArrowRight className="h-4 w-4" />
              </button>
              <Link
                href="/downloads"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-white/80 px-5 py-3 text-sm font-semibold text-[var(--ink)] transition hover:-translate-y-0.5"
              >
                Batch downloads
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="upload" className="site-shell mt-8 scroll-mt-8">
        <IGFPOProcessor />
      </section>
    </main>
  )
}
