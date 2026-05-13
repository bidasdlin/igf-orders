import { NextResponse } from 'next/server'
import { listVendors } from '@/lib/quickbooks'

function getReconnectReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('invalid_grant') || message.includes('QB token refresh failed')) {
    return 'QuickBooks reconnect required'
  }
  return 'QuickBooks check failed'
}

export async function GET() {
  try {
    await listVendors(1)
    return NextResponse.json({
      ok: true,
      status: 'connected',
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      {
        ok: false,
        status: 'reconnect_required',
        reason: getReconnectReason(error),
        error: message,
        checkedAt: new Date().toISOString(),
      },
      { status: 503 },
    )
  }
}
