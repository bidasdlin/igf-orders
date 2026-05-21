import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      version: 'parser-total-check-2026-05-21',
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
