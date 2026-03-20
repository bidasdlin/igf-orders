import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'Hardcoded bulk sync is disabled. Upload original PO PDFs so the full source description is preserved.',
    },
    { status: 410 },
  )
}
