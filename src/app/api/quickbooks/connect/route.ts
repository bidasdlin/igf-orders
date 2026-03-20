import { NextRequest, NextResponse } from 'next/server'

const QB_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'

function getRedirectUri(request: NextRequest) {
  return `${request.nextUrl.origin}/api/quickbooks/callback`
}

export async function GET(request: NextRequest) {
  if (!process.env.QBO_CLIENT_ID) {
    return NextResponse.json({ error: 'Missing QBO_CLIENT_ID' }, { status: 500 })
  }

  const state = crypto.randomUUID()
  const authUrl = new URL(QB_AUTH_URL)
  authUrl.searchParams.set('client_id', process.env.QBO_CLIENT_ID)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'com.intuit.quickbooks.accounting')
  authUrl.searchParams.set('redirect_uri', getRedirectUri(request))
  authUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authUrl)
  response.cookies.set('qb_oauth_state', state, {
    httpOnly: true,
    maxAge: 60 * 10,
    path: '/',
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
  })

  return response
}
