import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_ROUTES = ["/login", "/signup", "/auth/callback", "/setup"]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Electron restores Supabase auth in the renderer. Its local standalone
  // server starts without assuming a server-readable session cookie; the
  // client guard still blocks protected content and API calls validate JWTs.
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
