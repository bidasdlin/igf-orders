import { IGFPOProcessor } from '@/components/igf-po-processor'

export default function Home() {
  return (
    <main className="max-w-6xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">IGF Order Processing</h1>
        <p className="text-gray-500 mt-2">Convert IGF customer purchase orders into vendor POs and sync to QuickBooks.</p>
      </div>
      <IGFPOProcessor />
    </main>
  )
}
