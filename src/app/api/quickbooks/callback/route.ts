import { NextRequest, NextResponse } from 'next/server'

const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

function getRedirectUri(request: NextRequest) {
  return `${request.nextUrl.origin}/api/quickbooks/callback`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderPage(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(135deg, #f7f2e9 0%, #f4ede2 52%, #fffdf8 100%);
        color: #16212a;
      }
      main {
        max-width: 760px;
        margin: 48px auto;
        padding: 0 20px;
      }
      .card {
        background: rgba(255, 255, 255, 0.88);
        border: 1px solid rgba(22, 33, 42, 0.12);
        border-radius: 28px;
        padding: 28px;
        box-shadow: 0 24px 60px rgba(66, 48, 24, 0.12);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 32px;
        line-height: 1.05;
      }
      p {
        margin: 10px 0 0;
        line-height: 1.7;
        color: #53616d;
      }
      pre {
        margin: 18px 0 0;
        padding: 16px;
        border-radius: 18px;
        background: #16212a;
        color: #f7f2e9;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .label {
        margin-top: 18px;
        font-size: 12px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #8b959d;
      }
      .warn {
        color: #bc5135;
        font-weight: 600;
      }
      a {
        color: #0f766e;
        font-weight: 600;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <h1>${escapeHtml(title)}</h1>
        ${body}
      </div>
    </main>
  </body>
</html>`,
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
      },
    },
  )
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get('error')
  const errorDescription = request.nextUrl.searchParams.get('error_description')
  if (error) {
    return renderPage(
      'QuickBooks authorization failed',
      `<p class="warn">${escapeHtml(error)}</p><p>${escapeHtml(errorDescription || 'QuickBooks did not complete the authorization flow.')}</p>`,
      400,
    )
  }

  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const realmId = request.nextUrl.searchParams.get('realmId') || process.env.QBO_REALM_ID || ''
  const expectedState = request.cookies.get('qb_oauth_state')?.value

  if (!code || !state || !expectedState || state !== expectedState) {
    const response = renderPage(
      'QuickBooks authorization could not be verified',
      '<p>Start again from the reconnect page so the app can verify the OAuth state cookie before exchanging the code.</p>',
      400,
    )
    response.cookies.set('qb_oauth_state', '', { maxAge: 0, path: '/' })
    return response
  }

  if (!process.env.QBO_CLIENT_ID || !process.env.QBO_CLIENT_SECRET) {
    const response = renderPage(
      'QuickBooks credentials are missing',
      '<p>This deployment is missing the QuickBooks client credentials required to finish the OAuth exchange.</p>',
      500,
    )
    response.cookies.set('qb_oauth_state', '', { maxAge: 0, path: '/' })
    return response
  }

  const credentials = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64')
  const tokenResponse = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(request),
    }),
    cache: 'no-store',
  })

  if (!tokenResponse.ok) {
    const response = renderPage(
      'QuickBooks token exchange failed',
      `<p class="warn">Intuit rejected the authorization code exchange.</p><pre>${escapeHtml(await tokenResponse.text())}</pre>`,
      500,
    )
    response.cookies.set('qb_oauth_state', '', { maxAge: 0, path: '/' })
    return response
  }

  const data = await tokenResponse.json() as {
    refresh_token?: string
    x_refresh_token_expires_in?: number
  }

  const refreshToken = data.refresh_token || ''
  const expiresIn = data.x_refresh_token_expires_in
  const response = renderPage(
    'QuickBooks reconnect complete',
    `<p>Copy the value below into Vercel as <strong>QBO_REFRESH_TOKEN</strong>.</p>
<div class="label">QBO_REFRESH_TOKEN</div>
<pre>${escapeHtml(refreshToken)}</pre>
<div class="label">QBO_REALM_ID</div>
<pre>${escapeHtml(realmId)}</pre>
${expiresIn ? `<p>Refresh token lifetime reported by Intuit: ${escapeHtml(String(expiresIn))} seconds.</p>` : ''}
<p class="warn">Keep only the newest refresh token. Older ones can stop working after rotation.</p>`,
    200,
  )

  response.cookies.set('qb_oauth_state', '', { maxAge: 0, path: '/' })
  return response
}
