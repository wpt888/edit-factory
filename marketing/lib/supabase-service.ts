import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for the Marketing app webhook route handler.
 *
 * Phase 91 — MARK-04. Closes Phase 89 review WR-02 (service-role key in
 * cookie-aware factory).
 *
 * Why a separate file from marketing/lib/supabase.ts (D-16):
 *
 *   The webhook route handler at marketing/app/api/lemon-squeezy/webhook/route.ts
 *   has no cookies / no session / no user context — Lemon Squeezy POSTs directly
 *   to the route. The cookie-aware getMarketingSupabase() factory at
 *   marketing/lib/supabase.ts:23 would either no-op (cookie callbacks are stubs
 *   from Phase 89) or throw (depending on Next.js runtime). This file is the
 *   service-role client EXPLICITLY without cookie machinery.
 *
 * Uses the SAME env vars as marketing/lib/supabase.ts (MARKETING_SUPABASE_URL +
 * MARKETING_SUPABASE_KEY) provisioned via M-prerequisite M1 — but uses
 * createClient from '@supabase/supabase-js' instead of createServerClient from
 * '@supabase/ssr', which is the right factory for cookie-less server contexts.
 *
 * Per D-12 (Phase 89): missing env vars surface as a thrown Error with the
 * specific missing var name, NOT a silent undefined.
 */
export function getMarketingSupabaseServiceClient(): SupabaseClient {
  const url = process.env.MARKETING_SUPABASE_URL;
  const key = process.env.MARKETING_SUPABASE_KEY;

  if (!url) {
    throw new Error(
      "MARKETING_SUPABASE_URL is not set. " +
        "Provision the marketing Supabase project per M-prerequisite M1 in 91-CONTEXT.md " +
        "and add the URL to marketing/.env.local. " +
        "See marketing/.env.example for the full env contract."
    );
  }
  if (!key) {
    throw new Error(
      "MARKETING_SUPABASE_KEY is not set. " +
        "Add the service-role key from the Supabase dashboard to marketing/.env.local. " +
        "Do NOT prefix with NEXT_PUBLIC_ — this is a server-only secret. " +
        "See M-prerequisite M1 in 91-CONTEXT.md."
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
