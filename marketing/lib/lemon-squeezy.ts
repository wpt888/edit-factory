/**
 * Lemon Squeezy hosted-checkout URL construction + variant-id → tier reverse-lookup.
 *
 * Phase 91 — MARK-03 (frontend wiring) + MARK-04 (webhook consumer of variantIdToTier).
 *
 * Design choices locked in CONTEXT.md D-01..D-18 and Plan 91-01 D-19..D-23:
 *
 * - D-02 Hosted checkout URLs over JS overlay — no client-side JS surface.
 * - D-03 No `@lemonsqueezy/lemonsqueezy.js` SDK — URLs are string concat;
 *        webhook signature verification uses `node:crypto` directly in Plan 91-02.
 * - D-04 Variant IDs are env vars, NOT hardcoded — operator provisions them via
 *        M-prerequisite M2 (Lemon Squeezy dashboard).
 *
 * Tier slug convention (D-19 underscore-vs-hyphen resolution):
 *
 *   - Function API uses UNDERSCORE form 'cloud_sync' — matches the Supabase
 *     CHECK constraint `subscription_tier in ('starter', 'pro', 'cloud_sync')`
 *     in marketing/supabase/migrations/0001_create_orders_table.sql (D-11).
 *   - Fallback hrefs use the HYPHEN form for the third tier slug — preserves
 *     byte-compat with Phase 90's placeholder hrefs (no other code paths
 *     depend on the hyphen form today; Phase 90 landing.spec.ts does not
 *     assert pricing CTAs).
 *
 * Dual env-var pattern (Pattern S2 in 91-PATTERNS.md):
 *
 *   - `getCheckoutUrl()` (called from server-rendered pricing.tsx) reads
 *     CLIENT-visible `NEXT_PUBLIC_LEMON_SQUEEZY_*` env vars. Returns the
 *     `/signup?plan=*` FALLBACK when any required env var is absent — does
 *     NOT throw, so dev landing page works without M2 provisioned.
 *   - `variantIdToTier()` (called from the webhook handler in Plan 91-02)
 *     reads SERVER-only `LEMON_SQUEEZY_*_VARIANT_ID` env vars (no
 *     NEXT_PUBLIC_ prefix). Returns null for unknown variant IDs so the
 *     webhook can return 200 + 'unknown_variant' per CONTEXT.md <specifics>
 *     line 246.
 *
 * | tier arg       | Client env (URL construction)                    | Server env (variantIdToTier)        |
 * |----------------|--------------------------------------------------|--------------------------------------|
 * | 'starter'      | NEXT_PUBLIC_LEMON_SQUEEZY_STARTER_VARIANT_ID     | LEMON_SQUEEZY_STARTER_VARIANT_ID     |
 * | 'pro'          | NEXT_PUBLIC_LEMON_SQUEEZY_PRO_VARIANT_ID         | LEMON_SQUEEZY_PRO_VARIANT_ID         |
 * | 'cloud_sync'   | NEXT_PUBLIC_LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID  | LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID  |
 *
 * Store slug: NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG (browser-safe).
 */

export type LemonSqueezyTier = "starter" | "pro" | "cloud_sync";

const TIER_TO_FALLBACK_SLUG: Record<LemonSqueezyTier, string> = {
  starter: "starter",
  pro: "pro",
  // D-19: hyphen in fallback href preserves Phase 90 byte-compat
  cloud_sync: "cloud-sync",
};

const TIER_TO_CLIENT_ENV_VAR: Record<LemonSqueezyTier, string> = {
  starter: "NEXT_PUBLIC_LEMON_SQUEEZY_STARTER_VARIANT_ID",
  pro: "NEXT_PUBLIC_LEMON_SQUEEZY_PRO_VARIANT_ID",
  cloud_sync: "NEXT_PUBLIC_LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID",
};

const TIER_TO_SERVER_ENV_VAR: Record<LemonSqueezyTier, string> = {
  starter: "LEMON_SQUEEZY_STARTER_VARIANT_ID",
  pro: "LEMON_SQUEEZY_PRO_VARIANT_ID",
  cloud_sync: "LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID",
};

/**
 * Build the Lemon Squeezy hosted-checkout URL for `tier`. Falls back to
 * `/signup?plan=<tier-slug>` when any required env var is absent — does NOT throw.
 *
 * Safe to call from server components AND client components (reads NEXT_PUBLIC_*
 * env vars only).
 *
 * Examples:
 *   getCheckoutUrl('starter') // with env: 'https://<slug>.lemonsqueezy.com/buy/<variantId>'
 *   getCheckoutUrl('starter') // without env: '/signup?plan=starter'
 *   getCheckoutUrl('cloud_sync') // without env: '/signup?plan=<hyphen-form>' (see TIER_TO_FALLBACK_SLUG)
 */
export function getCheckoutUrl(tier: LemonSqueezyTier): string {
  const slug = process.env.NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG;
  const variantEnvName = TIER_TO_CLIENT_ENV_VAR[tier];
  const variantId = process.env[variantEnvName];

  if (!slug || !variantId) {
    return `/signup?plan=${TIER_TO_FALLBACK_SLUG[tier]}`;
  }

  return `https://${slug}.lemonsqueezy.com/buy/${variantId}`;
}

/**
 * Reverse-lookup: given a Lemon Squeezy variant ID (string, numeric body, from
 * a webhook payload), return the subscription tier it maps to, or null when
 * the variant ID does not match any of the 3 known tiers' server env vars.
 *
 * Plan 91-02 webhook handler calls this and returns 200 + 'unknown_variant'
 * (NOT 4xx) when this returns null — prevents Lemon Squeezy retry loops for
 * variants outside Phase 91's scope (per CONTEXT.md <specifics> line 246).
 *
 * Reads SERVER-only env vars (LEMON_SQUEEZY_*_VARIANT_ID, no NEXT_PUBLIC_ prefix).
 * Throws if any required server env var is unset — webhook routes the throw to
 * a 500 'webhook_secret_not_configured'-style failure mode (D-07 fail-closed).
 */
export function variantIdToTier(variantId: string): LemonSqueezyTier | null {
  const tiers: LemonSqueezyTier[] = ["starter", "pro", "cloud_sync"];
  for (const tier of tiers) {
    const envName = TIER_TO_SERVER_ENV_VAR[tier];
    const configured = process.env[envName];
    if (!configured) {
      throw new Error(
        `${envName} is not set. ` +
          "Provision the Lemon Squeezy store + 3 product variants per M-prerequisite M2 " +
          "in 91-CONTEXT.md and add the variant IDs to marketing/.env.local. " +
          "See marketing/.env.example for the full env contract."
      );
    }
    if (configured === variantId) {
      return tier;
    }
  }
  return null;
}
