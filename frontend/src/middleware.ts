import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_ROUTES = ["/login", "/signup", "/auth/callback", "/setup"]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Desktop build: auth is the local backend gate (/desktop/auth + 1234 login),
  // NOT a Supabase SSR session. Skip the Supabase auth gate entirely so a
  // packaged/clean/CI build never redirect-loops to /login or returns 503 when
  // the Supabase env vars aren't baked in. Inlined at build time from
  // .env.production (NEXT_PUBLIC_DESKTOP_MODE=true) → deterministic.
  if (process.env.NEXT_PUBLIC_DESKTOP_MODE === "true") {
    return NextResponse.next()
  }

  // Skip public routes — no auth required
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Auth disabled in development — allow all requests through
  if (process.env.NEXT_PUBLIC_AUTH_DISABLED === "true") {
    return NextResponse.next()
  }

  // Create Supabase client with cookie access for middleware context
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    if (process.env.NODE_ENV !== "production") {
      return response
    }
    return new NextResponse("Supabase auth middleware is misconfigured.", {
      status: 503,
    })
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Refresh session and check auth
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  matcher: [
    // Match all routes except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
