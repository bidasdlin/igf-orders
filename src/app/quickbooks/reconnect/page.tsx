import Link from 'next/link'

export default function QuickBooksReconnectPage() {
  return (
    <main className="pb-16 pt-8 md:pb-24 md:pt-12">
      <section className="site-shell">
        <div className="panel subtle-grid mx-auto max-w-3xl px-6 py-10 md:px-8 md:py-12">
          <span className="eyebrow">QuickBooks reconnect</span>
          <div className="mt-6 space-y-4">
            <h1 className="display-title">Reconnect QuickBooks and issue a fresh refresh token.</h1>
            <p className="max-w-2xl text-base leading-7 text-[var(--muted)] md:text-lg">
              Use this one-time flow when QuickBooks starts returning <code>invalid_grant</code>. After approval, the callback page
              will show the new <code>QBO_REFRESH_TOKEN</code> and <code>QBO_REALM_ID</code>.
            </p>
          </div>

          <div className="mt-8 rounded-[24px] border border-[var(--border)] bg-white/72 p-5">
            <p className="text-sm leading-7 text-[var(--muted)]">
              Only use the newest refresh token that Intuit returns. Once you see it, send it back here and I can update Vercel.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/api/quickbooks/connect" className="btn-primary">
              Start QuickBooks reconnect
            </Link>
            <Link href="/" className="btn-secondary">
              Back to app
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
