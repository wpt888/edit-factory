import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  // Simplified proxy - just pass through without Supabase session check
  return NextResponse.next()
}

export const config = {
  matcher: [
    // Only match API routes or protected routes if needed
    // For now, exclude everything to test if proxy is the issue
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
