import Link from 'next/link'
import { Download } from 'lucide-react'
import { IGFPOProcessor } from '@/components/igf-po-processor'

export default function Home() {
  return (
    <main className="max-w-6xl mx-auto py-8 px-4">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">IGF Order Processing</h1>
          <p className="text-gray-500 mt-2">Convert IGF customer purchase orders into vendor POs and sync to QuickBooks.</p>
        </div>
        <Link
          href="/downloads"
          className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition-colors"
        >
          <Download className="w-4 h-4" />
          Download POs
        </Link>
      </div>
      <IGFPOProcessor />
    </main>
  )
}
