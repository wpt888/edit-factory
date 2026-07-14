import { createBrowserClient } from '@supabase/ssr'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

let browserClient: SupabaseClient | undefined

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");

  if (browserClient) return browserClient

  if (process.env.NEXT_PUBLIC_DESKTOP_MODE === "true") {
    // Electron owns a persistent Chromium profile under app.getPath("userData").
    // Keep the refresh token in that profile so closing and reopening Blipost
    // restores the account without retaining the user's plaintext password.
    browserClient = createSupabaseClient(url, key, {
      auth: {
        storage: typeof window === "undefined" ? undefined : window.localStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
    return browserClient
  }

  browserClient = createBrowserClient(url, key)
  return browserClient
}
