import { createBrowserClient, createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Server-side Supabase client for the Marketing app.
 *
 * Uses the SERVICE-ROLE key (MARKETING_SUPABASE_KEY — NO NEXT_PUBLIC_ prefix,
 * so it is NEVER bundled into the browser). Use this for:
 *   - Route Handlers (e.g., marketing/app/api/lemon-squeezy/webhook/route.ts in Phase 91)
 *   - Server Components reading privileged data
 *   - Server actions
 *
 * Phase 89 scope: scaffold only. Cookie wiring is intentionally minimal —
 * Phase 92 (account dashboard) and Phase 93 (OAuth) will extend this with
 * proper cookie read/write callbacks.
 *
 * MARK-06: this connects to a SEPARATE Supabase project from the existing
 * `frontend/` app — zero shared users.
 *
 * Per D-12: the Supabase project does NOT yet exist. Missing env vars
 * surface as a thrown Error with the specific missing var name, NOT a
 * silent undefined that would create a 500 at request time without context.
 */
export function getMarketingSupabase() {
  const url = process.env.MARKETING_SUPABASE_URL;
  const key = process.env.MARKETING_SUPABASE_KEY;

  if (!url) {
    throw new Error(
      "MARKETING_SUPABASE_URL is not set. " +
        "Provision the marketing Supabase project and add the URL to marketing/.env.local. " +
        "See marketing/.env.example for the full env contract."
    );
  }
  if (!key) {
    throw new Error(
      "MARKETING_SUPABASE_KEY is not set. " +
        "Add the service-role key from the Supabase dashboard to marketing/.env.local. " +
        "Do NOT prefix with NEXT_PUBLIC_ — this is a server-only secret."
    );
  }

  // Phase 89: scaffold-mode cookie callbacks. Real cookie wiring lands in Phase 92/93.
  return createServerClient(url, key, {
    cookies: {
      get() {
        return undefined;
      },
      set(_name: string, _value: string, _options: CookieOptions) {
        // no-op in scaffold; Phase 92 wires this to next/headers cookies()
      },
      remove(_name: string, _options: CookieOptions) {
        // no-op in scaffold
      },
    },
  });
}

/**
 * Browser-side Supabase client for the Marketing app.
 *
 * Uses the ANON key (NEXT_PUBLIC_MARKETING_SUPABASE_ANON_KEY — safe to ship
 * to the browser; row-level security on the Supabase side gates access).
 *
 * Use this for:
 *   - Client components that need auth state
 *   - Phase 92 `/account` UI reading the user's own subscription
 *
 * Per D-05 dual-env-var pattern: server-side uses MARKETING_SUPABASE_URL +
 * MARKETING_SUPABASE_KEY (service role); browser-side uses NEXT_PUBLIC-prefixed
 * vars (URL is duplicated so the prefix difference is the only flag — Next.js's
 * NEXT_PUBLIC_ mechanism only exposes prefixed vars to the client bundle).
 */
export function getMarketingBrowserClient() {
  const url = process.env.NEXT_PUBLIC_MARKETING_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_MARKETING_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_MARKETING_SUPABASE_URL is not set. " +
        "Add it to marketing/.env.local (and the Vercel project env in Phase 96 deploy). " +
        "See marketing/.env.example."
    );
  }
  if (!anonKey) {
    throw new Error(
      "NEXT_PUBLIC_MARKETING_SUPABASE_ANON_KEY is not set. " +
        "Add the anon key from the Supabase dashboard to marketing/.env.local."
    );
  }

  return createBrowserClient(url, anonKey);
}
