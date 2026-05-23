# Phase 91: lemon-squeezy-checkout-webhook — Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 12 (8 new, 4 modified)
**Analogs found:** 8 / 12 (4 files have NO repo analog — planner should use CONTEXT.md `<specifics>` skeletons directly)

This map is organized by **Plan** (per CONTEXT.md D-01 split) so the planner can lift each section directly into a `PLAN.md`. Cross-cutting shared patterns are collected in the final section.

---

## File Classification

| New/Modified File | Plan | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `marketing/components/sections/pricing.tsx` (M) | 91-01 | component (RSC) | request-response | (self — Phase 90 file) | self / exact |
| `marketing/lib/lemon-squeezy.ts` (N) | 91-01 | utility (env-reader + URL constructor) | transform | `marketing/lib/supabase.ts` | role-match (env-var-throws pattern only) |
| `marketing/tests/checkout.spec.ts` (N) | 91-01 | test (Playwright e2e) | request-response | `marketing/tests/landing.spec.ts` | exact (Playwright + screenshot + href assertion) |
| `marketing/.gitignore` (M) | 91-01 + 91-02 | config | n/a | (self — Phase 90 file) | self / exact |
| `marketing/.env.example` (M) | 91-01 + 91-02 | config | n/a | (self — Phase 89 file) | self / exact |
| `marketing/package.json` (M) | 91-02 | config | n/a | (self) | self / exact |
| `marketing/lib/supabase-service.ts` (N) | 91-02 | utility (Supabase service-role client factory) | CRUD-client | `marketing/lib/supabase.ts` | role-match (env-var-throws pattern; D-16 EXCLUDES cookie callbacks) |
| `marketing/app/api/lemon-squeezy/webhook/route.ts` (N) | 91-02 | route handler (Next.js Route Handler — POST) | request-response (webhook) | `frontend/src/app/auth/callback/route.ts` | **file-shape only**; logic has no analog |
| `marketing/lib/license-key.ts` (N) | 91-02 | utility (crypto-based key generator) | transform | **NO ANALOG** | use CONTEXT.md D-09 verbatim |
| `marketing/lib/email.ts` (N) | 91-02 | utility (Resend SDK wrapper) | request-response (outbound HTTP) | **NO ANALOG** | use CONTEXT.md D-14 template + Resend docs |
| `marketing/supabase/migrations/0001_create_orders_table.sql` (N) | 91-02 | migration (DDL) | n/a | **NO ANALOG** | use CONTEXT.md D-11 verbatim |
| `marketing/tests/webhook.spec.ts` (N) | 91-02 | test (Playwright HTTP-driven) | request-response | `marketing/tests/landing.spec.ts` (skeleton only) | partial — marketing tests have NO `fetch()`/`request` fixture usage yet |

Legend: **(N)** = new file, **(M)** = modified file.

---

# Plan 91-01 — Checkout URL wiring (frontend-only)

## `marketing/components/sections/pricing.tsx` (M)

**Role:** component (server component — no `'use client'`)
**Analog:** the file itself — Phase 91 rewires 3 hardcoded hrefs to call `getCheckoutUrl()`.

**Lines to change (currently at `marketing/components/sections/pricing.tsx`):**

| Line | Current | Phase 91 target |
|------|---------|-----------------|
| 33-34 | `<Button asChild className="w-full"><a href="/signup?plan=starter">Buy Starter</a>` | `href={getCheckoutUrl('starter')}` |
| 58-59 | `<Button asChild className="w-full"><a href="/signup?plan=pro">Buy Pro</a>` | `href={getCheckoutUrl('pro')}` |
| 82-83 | `<Button asChild variant="outline" className="w-full"><a href="/signup?plan=cloud-sync">Add Cloud Sync</a>` | `href={getCheckoutUrl('cloud_sync')}` |

**Imports to add at line 1-4:**
```tsx
import { getCheckoutUrl } from "@/lib/lemon-squeezy";
```

**Constraints to preserve (per CONTEXT.md `<canonical_refs>` "DO NOT break"):**
- File MUST remain server-component (no `'use client'` — Phase 90 D-14 grep-locked exactly 1 `'use client'` at `faq.tsx`)
- Tailwind classes on `Card`, `CardHeader`, `Button`, `Badge`, `Separator` must be byte-identical to current
- Section structure (3 `<Card>` blocks, Most-popular badge on tier 2, `outline` variant on tier 3) must be byte-identical
- Tier 3 keyword in `getCheckoutUrl()` call is `'cloud_sync'` (underscore) — matches the Supabase CHECK constraint in D-11; the href slug remains `/signup?plan=cloud-sync` (hyphen) in the **fallback** branch of `getCheckoutUrl` for backward compat with Phase 90's landing test (`landing.spec.ts` does NOT assert this href today, so no conflict).

---

## `marketing/lib/lemon-squeezy.ts` (NEW)

**Role:** utility — env-var reader + URL constructor + variant-id → tier mapping
**Analog:** `marketing/lib/supabase.ts` (env-var-throws pattern only; LS-specific logic has no analog)

**Pattern to reuse — env-var-throws-with-named-error from `marketing/lib/supabase.ts:23-40`:**
```typescript
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
  // …
}
```

**Same → copy:** named-error pattern (`"<ENV_VAR_NAME> is not set. <how to provision> <see file>"`), with explicit guidance pointing the operator at M-prerequisite M2.

**Different → adapt for Phase 91:**
- `getCheckoutUrl(tier)` MUST **return a fallback** `/signup?plan=<tier-slug>` when ANY of the 4 client-visible env vars (`NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG` + 3 variant IDs) is absent — NOT throw. Rationale per CONTEXT.md D-04 + checkout.spec.ts dual-path requirement: dev landing page must still render without M2 provisioned.
- `variantIdToTier(id: string)` (consumed by webhook handler in 91-02) reads SERVER-side env vars (`LEMON_SQUEEZY_*_VARIANT_ID`, no `NEXT_PUBLIC_` prefix) and MAY throw when env absent (the webhook returns 500 in that case, per the D-07 fail-closed semantics — but `variantIdToTier` itself should return `null` for unknown IDs so the handler can `return Response.json({ error: 'unknown_variant' }, { status: 200 })` per the CONTEXT.md `<specifics>` skeleton).
- Hardcoded constants forbidden — CONTEXT.md D-04 acceptance: `grep -E "[0-9]{6,}" marketing/lib/lemon-squeezy.ts marketing/components/sections/pricing.tsx` returns 0 matches.
- URL shape locked by CONTEXT.md D-02: `https://${slug}.lemonsqueezy.com/buy/${variantId}`.

**Tier ↔ env-var mapping table (lift directly into the file's JSDoc):**

| `tier` arg | Client env (URL construction) | Server env (variantIdToTier reverse-lookup) |
|------------|------------------------------|----------------------------------------------|
| `'starter'` | `NEXT_PUBLIC_LEMON_SQUEEZY_STARTER_VARIANT_ID` | `LEMON_SQUEEZY_STARTER_VARIANT_ID` |
| `'pro'` | `NEXT_PUBLIC_LEMON_SQUEEZY_PRO_VARIANT_ID` | `LEMON_SQUEEZY_PRO_VARIANT_ID` |
| `'cloud_sync'` | `NEXT_PUBLIC_LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID` | `LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID` |

(Slug everywhere: `NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG`.)

---

## `marketing/tests/checkout.spec.ts` (NEW)

**Role:** test — Playwright e2e asserting href values + MANDATORY screenshot
**Analog:** `marketing/tests/landing.spec.ts` (exact match — same framework, same patterns)

**Pattern A — `toHaveAttribute('href', '…')` assertion from `marketing/tests/landing.spec.ts:27-28`:**
```typescript
// Hero CTAs.
await expect(page.getByRole('link', { name: 'Get Started' })).toHaveAttribute('href', '/signup');
await expect(page.getByRole('link', { name: 'See pricing' })).toHaveAttribute('href', '#pricing');
```

**Same → copy:** the `page.getByRole('link', { name: '…' })` + `toHaveAttribute('href', …)` chain.

**Different → adapt:**
- Phase 91 asserts 3 hrefs: "Buy Starter", "Buy Pro", "Add Cloud Sync" (button text from `pricing.tsx`).
- **Two test cases** per CONTEXT.md D-01 + D-17: (a) env-PRESENT — set `NEXT_PUBLIC_LEMON_SQUEEZY_*` via `process.env` mutation BEFORE the dev server spawns; assert href matches `/^https:\/\/[\w-]+\.lemonsqueezy\.com\/buy\/\d+$/`. (b) env-ABSENT — `delete process.env.NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG` etc.; assert href === `/signup?plan=starter` (fallback).
- ⚠ **Cross-test env contamination risk:** Next.js webServer in `playwright.config.ts:33-40` is spawned ONCE per test run — env-var mutations from inside `test()` bodies will NOT reach the spawned `next dev` process. Planner MUST either: (i) author two SEPARATE spec files run in two SEPARATE Playwright invocations with different env, OR (ii) use `dotenv` files (`.env.test.local`) + a wrapper script. Recommended: a single spec with `playwright.config.ts` reading `process.env.PHASE_91_MOCK_LS=1` to inject mock vars when set, and the spec running via two `npx playwright test` invocations in CI.

**Pattern B — pricing section scoping from `marketing/tests/landing.spec.ts:32-35`:**
```typescript
// Use section scoping to avoid strict-mode violation: '$79' also appears in comparison table.
const pricingSection = page.locator('section#pricing');
await expect(pricingSection.getByText('$79')).toBeVisible();
```

**Same → copy:** scope all assertions to `page.locator('section#pricing')` to avoid strict-mode violations when "$79" / button text appears elsewhere.

**Pattern C — MANDATORY screenshot per CLAUDE.md from `marketing/tests/landing.spec.ts:126-142`:**
```typescript
test('Test 3: MANDATORY full-page screenshot per CLAUDE.md', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);  // webfonts + hydration settle

  await page.screenshot({
    path: 'screenshots/phase-90-landing.png',
    fullPage: true,
  });

  const fs = await import('node:fs');
  const stat = fs.statSync('screenshots/phase-90-landing.png');
  expect(stat.size, `screenshot size ${stat.size} must be > 100000 bytes`).toBeGreaterThan(100000);
});
```

**Same → copy:** structure exactly. The fs.statSync size assertion is the gap-closure prevention from Phase 90 — keep it.

**Different → adapt for Phase 91:**
- Screenshot path: `screenshots/phase-91-pricing-with-checkout-urls.png` (per CONTEXT.md D-18).
- Run this screenshot test ONLY in the env-PRESENT variant (so the screenshot proves LS URLs are wired, not the fallback).

---

# Plan 91-02 — Webhook handler + Supabase + license-key + email

## `marketing/lib/supabase-service.ts` (NEW)

**Role:** utility — service-role Supabase client factory, EXPLICITLY no cookies
**Analog:** `marketing/lib/supabase.ts` (env-var-throws pattern; D-16 EXCLUDES the cookie callbacks)

**Pattern to reuse — env-var-throws from `marketing/lib/supabase.ts:24-40` (see Plan 91-01 excerpt above).**

**Same → copy:**
- Function signature shape: `export function getMarketingSupabaseServiceClient()` (matches the existing `getMarketingSupabase()` naming style).
- Env-var-throws for `MARKETING_SUPABASE_URL` + `MARKETING_SUPABASE_KEY` (the SAME service-role env vars as `supabase.ts:24-25`).
- Named-error guidance pointing at M-prerequisite M1.

**Different → critical changes per CONTEXT.md D-16 (closes Phase 89 review WR-02):**
- **Import from `@supabase/supabase-js`, NOT `@supabase/ssr`**. Use `createClient(url, key)` — the plain client, no cookie machinery.
- **OMIT the cookies callback object entirely** (the `supabase.ts:42-54` `{ cookies: { get, set, remove } }` block is exactly what must be excluded).
- Add a JSDoc paragraph stating: "Service-role client for the webhook route handler (Phase 91 / MARK-04). The webhook has no session / no cookies / no user context — the cookie-aware `getMarketingSupabase()` factory at `marketing/lib/supabase.ts:23` would either no-op (cookie callbacks are stubs from Phase 89) or throw depending on Next.js runtime. This separation closes Phase 89 review WR-02."

**Reference — what NOT to copy from `supabase.ts:42-54`:**
```typescript
// DO NOT COPY THIS BLOCK INTO supabase-service.ts (D-16):
return createServerClient(url, key, {
  cookies: {
    get() { return undefined; },
    set(_name, _value, _options) { /* no-op */ },
    remove(_name, _options) { /* no-op */ },
  },
});
```

**Instead, use** (idiomatic `@supabase/supabase-js`):
```typescript
import { createClient } from '@supabase/supabase-js';
// after env checks:
return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
```

---

## `marketing/app/api/lemon-squeezy/webhook/route.ts` (NEW)

**Role:** Next.js App Router Route Handler — `POST` only
**Analog:** `frontend/src/app/auth/callback/route.ts` — **file-shape only**; HMAC + Supabase + email logic has NO repo analog.

**Pattern to reuse — Next.js Route Handler shape from `frontend/src/app/auth/callback/route.ts:1-22`:**
```typescript
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // …
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("Auth exchange failed:", error);
  }
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
```

**Same → copy (file shape only):**
- `export async function POST(request: Request): Promise<Response>` (Next.js Route Handler convention).
- Import alias `@/lib/...` for Supabase client factory.
- Use `Response.json({...}, { status: N })` for JSON responses (or `NextResponse.json` — equivalent in App Router; pick one and be consistent).

**Different → all webhook-specific logic per CONTEXT.md `<specifics>` skeleton (lines 211-253) — NO repo analog for any of this:**
- `await request.text()` BEFORE `JSON.parse` to capture the raw body for HMAC verification.
- `node:crypto` `createHmac('sha256', secret).update(rawBody).digest()` + `timingSafeEqual` (D-06). **First use of `node:crypto` in this repo.**
- D-07 fail-closed: `if (!secret) return Response.json({ error: 'webhook_secret_not_configured' }, { status: 500 })` — NEVER 200.
- D-08 idempotency: `INSERT … ON CONFLICT (lemon_squeezy_event_id) DO NOTHING RETURNING id`; email send conditional on RETURNING returning ≥ 1 row.
- D-10 license-key retry: catch PG `23505` unique-violation, regenerate, retry up to 3 times.
- Unknown variant + ignored event-type return `200` (NOT 4xx) to prevent LS retry loops — per `<specifics>` skeleton lines 241, 246.

**Pattern adjacent (not analog) — Python fail-closed when secret missing from `app/api/desktop_ml_routes.py:117-135` (per CONTEXT.md `<specifics>` reference):**
```python
# ---- VERIFY STAGE ----
yield {"event": "progress", "data": json.dumps({"stage": "verify"})}
try:
    expected_hex = await _fetch_expected_sha256(base_url + filename + ".sha256")
    actual_hex = await asyncio.to_thread(_hash_file_sha256, partial_path)
    if actual_hex.lower() != expected_hex.lower():
        if partial_path.exists():
            partial_path.unlink()
        yield {"event": "error", "data": json.dumps({"error": f"sha256 mismatch: …", "stage": "verify"})}
        return
```

**What to copy semantically (NOT byte-wise — language is different):**
- Fail-closed posture: any failure in signature/secret path returns an error, never silently proceeds.
- Cleanup-on-failure semantics (the Python unlinks the partial download; the TS analog is: do NOT INSERT the order row when signature fails).

**What is NOT applicable from `app/api/ml_gating.py`** (CONTEXT.md explicitly excludes this):
- The `settings.auth_disabled or settings.desktop_mode` dev-bypass at lines 91-94 — webhook ALWAYS requires real signature, even in dev mode. Dev convenience for Phase 91 is the test-skip pattern (D-17), NOT a route-level bypass.

---

## `marketing/lib/license-key.ts` (NEW) — NO ANALOG

**Role:** utility — crypto-based license-key generator
**Analog:** NONE. `app/services/credentials/license.py` is a different shape (Python, HTTP client to LS validate API, not a generator). No `crypto.randomBytes` usage exists in `marketing/`.

**Planner action:** implement directly from CONTEXT.md D-09:
```typescript
import { randomBytes } from 'node:crypto';

export function generateLicenseKey(): string {
  // EF13-XXXX-XXXX-XXXX-XXXX → "EF13-" prefix + 16 hex chars (uppercase) in 4 groups of 4
  const hex = randomBytes(8).toString('hex').toUpperCase();
  const groups = hex.match(/.{4}/g);
  if (!groups || groups.length !== 4) {
    throw new Error('license-key generator: unexpected hex length');  // defensive — randomBytes(8)→16 hex always
  }
  return `EF13-${groups.join('-')}`;
}
```

**Acceptance:** `generateLicenseKey()` returns a string matching `/^EF13-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/`.

**Reuse env-var-throws pattern from `marketing/lib/supabase.ts:24-40`:** NOT NEEDED — this utility has no env-var inputs (pure crypto + format).

---

## `marketing/lib/email.ts` (NEW) — NO ANALOG

**Role:** utility — Resend SDK wrapper with locked subject + body template
**Analog:** NONE. No email integration anywhere in the repo.

**Planner action:** implement directly from CONTEXT.md D-12 + D-13 + D-14:
- Import `Resend` from the `resend` npm package (added to `package.json` per D-13).
- Read `RESEND_API_KEY` + `RESEND_FROM_EMAIL` via env-var-throws (reuse the pattern from `marketing/lib/supabase.ts:24-40`).
- Export `sendLicenseEmail({ to, licenseKey, tierDisplayName })`.
- Subject string locked: `"Your Edit Factory license key"`.
- Body template locked verbatim per D-14 (plain text + minimal HTML — both rendered).
- `{REPO}` substitution: read `process.env.NEXT_PUBLIC_GITHUB_REPO` with default `'obsidsrl/edit-factory'`.

**Reuse env-var-throws pattern from `marketing/lib/supabase.ts:24-40`** (see Plan 91-01 excerpt). Adapt error messages to point at M-prerequisite M3.

---

## `marketing/supabase/migrations/0001_create_orders_table.sql` (NEW) — NO ANALOG

**Role:** Supabase migration (DDL)
**Analog:** NONE. `marketing/supabase/` directory does NOT exist; no migration files exist anywhere in the repo. Phase 91 creates the directory.

**Planner action:** the schema is LOCKED in CONTEXT.md D-11 (lines 84-104). Paste verbatim into `marketing/supabase/migrations/0001_create_orders_table.sql`. Key constraints to preserve:
- `lemon_squeezy_event_id text not null unique` — drives D-08 idempotency
- `license_key text not null unique` — drives D-10 collision-retry
- `subscription_tier text not null check (subscription_tier in ('starter', 'pro', 'cloud_sync'))` — note underscore in `cloud_sync` (matches `getCheckoutUrl('cloud_sync')` in 91-01)
- `event_type text not null check (event_type in ('order_created', 'subscription_created'))` — Phase 91 ONLY accepts these two
- `total_usd_cents integer` + `tax_usd_cents integer` — never store currency as float
- `raw_payload jsonb not null` — forensics for Phase 92
- `alter table public.orders enable row level security;` — no policies in Phase 91; service-role bypasses RLS
- `create index orders_buyer_email_idx on public.orders (buyer_email);` — for Phase 92 lookups

---

## `marketing/tests/webhook.spec.ts` (NEW)

**Role:** test — Playwright HTTP-driven integration test
**Analog:** `marketing/tests/landing.spec.ts` (Playwright structure only — NO `fetch()` / `request` fixture usage exists in `marketing/tests/` today; confirmed via `grep -n "request\.(post|get|fetch)|page\.request|node:fetch|fetch\(" marketing/tests/` → 0 matches)

**Pattern to reuse — test.describe scaffolding from `marketing/tests/landing.spec.ts:11`:**
```typescript
test.describe('Phase 90: landing page + pricing', () => {
  test('Test 1: …', async ({ page }) => { … });
});
```

**Same → copy:** `test.describe('Phase 91: webhook handler', () => { … })` scoping; the `{ page }` fixture is NOT needed for HTTP-only tests — use `{ request }` instead.

**Different → all HTTP-driven logic per CONTEXT.md D-17 (NO repo analog):**
- Use Playwright's built-in `request` fixture: `test('signed payload returns 200', async ({ request }) => { const res = await request.post('/api/lemon-squeezy/webhook', { headers: { 'X-Signature': sig, 'X-Event-Id': id }, data: rawBody }); … })`.
- Compute the HMAC signature for each test fixture body using `node:crypto` (same `createHmac('sha256', secret).update(body).digest('hex')` shape as the route handler).
- **`test.skip` on missing env vars per D-17** — NO analog in the repo; explicit pattern:
  ```typescript
  test.beforeAll(() => {
    test.skip(!process.env.LEMON_SQUEEZY_WEBHOOK_SECRET, 'M-prerequisite LEMON_SQUEEZY_WEBHOOK_SECRET not set');
    test.skip(!process.env.MARKETING_SUPABASE_URL, 'M-prerequisite M1 MARKETING_SUPABASE_URL not set');
    test.skip(!process.env.MARKETING_SUPABASE_KEY, 'M-prerequisite M1 MARKETING_SUPABASE_KEY not set');
  });
  ```
  Skip messages MUST name the missing env var AND the M-step so operator can fix without rerunning.
- Mock LS payload available in CONTEXT.md `<specifics>` lines 268-286 — lift as a test fixture constant.
- Test matrix (planner authors):
  1. Valid HMAC + new `X-Event-Id` → 200 + DB row inserted + email sent (mock Resend).
  2. Valid HMAC + duplicate `X-Event-Id` → 200 + DB row count unchanged + email NOT re-sent (D-08).
  3. Invalid HMAC → 401 `invalid_signature` (D-06).
  4. Missing `X-Signature` header → 401.
  5. Missing `X-Event-Id` header → 400 `missing_event_id`.
  6. Unknown `event_name` (e.g., `subscription_payment_success`) → 200 acknowledged + no DB write (D-out-of-scope).
  7. Unknown `variant_id` → 200 `unknown_variant` + no DB write.
  8. `LEMON_SQUEEZY_WEBHOOK_SECRET` env absent at runtime → 500 `webhook_secret_not_configured` (D-07 fail-closed — verified via spawning a server WITHOUT the env var; planner determines mechanism — likely a second `webhook-no-secret.spec.ts` or env-override via the dual-spec pattern in 91-01 checkout.spec.ts).

**Proof-of-execution artifact per CONTEXT.md `<canonical_refs>` CLAUDE.md MANDATORY rule:**
- Plan 91-02 has no UI change → no MANDATORY screenshot.
- BUT: write a JSON snapshot of a successful webhook test response to `marketing/screenshots/phase-91-webhook-success.json` (per CONTEXT.md `<canonical_refs>` line 322).
- This is a gap-closure-prevention learning carried forward from Phase 90 — `.gitignore` MUST be pre-emptively extended to allow this artifact (see `.gitignore` modification below).

---

# Cross-cutting Modifications (both plans)

## `marketing/.gitignore` (M)

**Role:** config
**Analog:** the file itself — Phase 90 tightened it to allow named phase artifacts.

**Current state at `marketing/.gitignore` lines 6-12:**
```
# Per-run screenshots are ignored, but committed named phase artifacts survive
# (e.g. phase-90-landing.png is the CLAUDE.md MANDATORY proof per Phase 90 verification).
screenshots/*
!screenshots/.gitkeep
!screenshots/phase-*-landing.png
```

**Pattern to extend:** the `!screenshots/phase-*-…` exception line. Phase 91 adds:
```
!screenshots/phase-91-*.png
!screenshots/phase-91-*.json
```

**Rationale (Phase 90 inter-agent learning per `90-VERIFICATION.md:14-17, 150-157`):**
> Initial verification scored 11/12 because the MANDATORY `phase-90-landing.png` was excluded by `.gitignore: screenshots/`. Closure required force-add + gitignore tightening + re-verify cycle. Phase 91 pre-emptively author the `.gitignore` exceptions for `phase-91-*.png` (Plan 91-01 screenshot) and `phase-91-*.json` (Plan 91-02 webhook-response artifact) BEFORE the executor runs tests, so artifacts are committable in the same wave as their production.

**Also (per CONTEXT.md `<canonical_refs>` line 317):** if Plan 91-02 uses `npx supabase` CLI locally, planner determines whether to add `supabase/.branches/` + `supabase/.temp/` to `.gitignore` (Supabase CLI internal dirs).

---

## `marketing/.env.example` (M)

**Role:** config
**Analog:** the file itself — Phase 91 adds 13 new env-var names + comments referencing M-prerequisites.

**Current state at `marketing/.env.example:15-26`:**
```
# ─── Lemon Squeezy (Phase 91 — MARK-03 / MARK-04) ───
# Uncomment + populate when Phase 91 starts.
# LEMON_SQUEEZY_API_KEY=
# LEMON_SQUEEZY_WEBHOOK_SECRET=
# LEMON_SQUEEZY_STORE_ID=
# LEMON_SQUEEZY_VARIANT_STARTER=
# LEMON_SQUEEZY_VARIANT_PRO=
# LEMON_SQUEEZY_VARIANT_CLOUD_SYNC=

# ─── Resend (Phase 91 — license-key email delivery) ───
# RESEND_API_KEY=
# RESEND_FROM_EMAIL=
```

**Same → copy:** the `# ─── <provider> (Phase N — <REQ>) ───` section-header style + the commented `KEY=` placeholder lines.

**Different → expand per CONTEXT.md `<domain>` line 31 (13 env vars total, NOT the 7 currently stubbed):**
- Uncomment all entries (Phase 91 IS the phase that activates them).
- Add the missing 6 entries: `NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG`, `NEXT_PUBLIC_LEMON_SQUEEZY_STARTER_VARIANT_ID`, `NEXT_PUBLIC_LEMON_SQUEEZY_PRO_VARIANT_ID`, `NEXT_PUBLIC_LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID`, and rename `LEMON_SQUEEZY_VARIANT_*` to `LEMON_SQUEEZY_*_VARIANT_ID` (consistency with both webhook handler env reads + CONTEXT.md naming).
- Add a comment block per env block citing the M-step that provisions it (M1 for Supabase, M2 for LS, M3 for Resend) — operator-facing breadcrumbs.

**Variable-name canonical list (planner uses these EXACTLY, per CONTEXT.md `<domain>` line 31):**
```
# ─── Lemon Squeezy (Phase 91 — MARK-03 / MARK-04 — provisioned via M2) ───
LEMON_SQUEEZY_API_KEY=
LEMON_SQUEEZY_STORE_ID=
LEMON_SQUEEZY_WEBHOOK_SECRET=
LEMON_SQUEEZY_STARTER_VARIANT_ID=
LEMON_SQUEEZY_PRO_VARIANT_ID=
LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID=
NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG=
NEXT_PUBLIC_LEMON_SQUEEZY_STARTER_VARIANT_ID=
NEXT_PUBLIC_LEMON_SQUEEZY_PRO_VARIANT_ID=
NEXT_PUBLIC_LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID=

# ─── Resend (Phase 91 — license-key email delivery — provisioned via M3) ───
RESEND_API_KEY=
RESEND_FROM_EMAIL=

# ─── GitHub release downloads (referenced in license email body per D-14) ───
NEXT_PUBLIC_GITHUB_REPO=obsidsrl/edit-factory
```

---

## `marketing/package.json` (M)

**Role:** config
**Analog:** the file itself.

**Pattern to extend:** the `dependencies` block at lines 13-27. Per CONTEXT.md D-13, add EXACTLY ONE dep: `resend`.

**Different from D-13 expectation — confirm with CONTEXT.md `<canonical_refs>` line 312:**
- "verify no `@lemonsqueezy` package added" → `grep -c "@lemonsqueezy" marketing/package.json` MUST return 0 after planner edit.
- Use `npm install --save resend` from `marketing/` working directory; resulting line goes alphabetically into `dependencies` between `@supabase/supabase-js` and `class-variance-authority`.

---

# Shared Patterns (applied across Plan 91-01 + Plan 91-02)

## Pattern S1 — Env-var-throws with named error message

**Source:** `marketing/lib/supabase.ts:24-40` (Phase 89 D-12).

**Apply to:**
- `marketing/lib/lemon-squeezy.ts` (server-side variantIdToTier; client-side `getCheckoutUrl` returns fallback instead of throwing — see Plan 91-01)
- `marketing/lib/supabase-service.ts`
- `marketing/lib/email.ts`
- `marketing/app/api/lemon-squeezy/webhook/route.ts` (the `if (!secret) return 500 webhook_secret_not_configured` is the route-level variant — D-07)

**Excerpt to copy (see Plan 91-01 lemon-squeezy.ts section above for full quote).** Adapt each error message to:
1. Name the missing env var literally
2. Reference `marketing/.env.local` and `marketing/.env.example`
3. Cite the M-prerequisite (M1/M2/M3) that provisions it

---

## Pattern S2 — Dual env-var pattern (server + NEXT_PUBLIC_ siblings)

**Source:** `marketing/lib/supabase.ts:23-92` (Phase 89 D-05).

**Pattern shape:** server-side reads `MARKETING_SUPABASE_URL` (lines 24), client-side reads `NEXT_PUBLIC_MARKETING_SUPABASE_URL` (line 74). Same URL, different prefix — the `NEXT_PUBLIC_` prefix is the only flag Next.js uses to bundle the value into the browser.

**Apply to Phase 91:**
- LS variant IDs (3 pairs of server + NEXT_PUBLIC_ vars per CONTEXT.md `<domain>` line 31)
- LS store slug (client-only — `NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG`; URL construction happens client-side OR server-side, but the slug is browser-safe so it's NEXT_PUBLIC_-only, no server sibling)
- Webhook secret (server-only — `LEMON_SQUEEZY_WEBHOOK_SECRET`; never NEXT_PUBLIC_; if accidentally NEXT_PUBLIC_-prefixed the secret leaks into the JS bundle — security disaster, planner MUST add a CI check or lint rule against `NEXT_PUBLIC_LEMON_SQUEEZY_WEBHOOK_SECRET` typo)

---

## Pattern S3 — Playwright test skip on missing env

**Source:** NO repo analog — `marketing/tests/` has no `test.skip` patterns today. CONTEXT.md D-17 introduces this.

**Pattern shape:**
```typescript
test.beforeAll(() => {
  test.skip(!process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,
    'M-prerequisite M2 LEMON_SQUEEZY_WEBHOOK_SECRET not set — see CONTEXT.md M2');
});
```

**Apply to:**
- `marketing/tests/webhook.spec.ts` — all tests that hit Supabase or verify HMAC
- `marketing/tests/checkout.spec.ts` — env-PRESENT test variant skips when `NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG` absent; env-ABSENT variant runs unconditionally (asserts the fallback)

**Rationale:** M-prerequisites cannot be provisioned by the autonomous loop; CI without secrets must not fail the build; skip messages must name the missing env var AND the M-step.

---

## Pattern S4 — MANDATORY Playwright screenshot per CLAUDE.md

**Source:** `marketing/tests/landing.spec.ts:126-142`.

**Apply to:**
- Plan 91-01 → `marketing/tests/checkout.spec.ts` produces `screenshots/phase-91-pricing-with-checkout-urls.png` (env-PRESENT variant)
- Plan 91-02 → no UI change, but write `screenshots/phase-91-webhook-success.json` as proof-of-execution (CONTEXT.md `<canonical_refs>` line 322)

**Excerpt to copy (see Plan 91-01 checkout.spec.ts Pattern C above).** Keep the `fs.statSync` size assertion — it's the gap-closure prevention from Phase 90 verification.

---

## Pattern S5 — Named-artifact `.gitignore` exception

**Source:** `marketing/.gitignore:9-12` (Phase 90 gap-closure outcome — see `.planning/phases/90-landing-page-pricing/90-VERIFICATION.md:14-17, 150-157`).

**Apply to `marketing/.gitignore`:** extend the existing `!screenshots/phase-*-landing.png` line with `!screenshots/phase-91-*.png` + `!screenshots/phase-91-*.json` — pre-emptively, BEFORE the executor produces the artifacts, to avoid a Phase-90-style re-verify cycle.

---

# Files with NO Analog

These files have no close match in the codebase. The planner should reference CONTEXT.md `<specifics>` skeletons + external docs (Lemon Squeezy / Resend) directly, instead of looking for a repo pattern.

| File | Role | Why no analog | Planner reference |
|------|------|---------------|-------------------|
| `marketing/lib/license-key.ts` | crypto utility | No `node:crypto.randomBytes` usage in `marketing/`; `app/services/credentials/license.py` is a different shape (Python LS-API validator, not a generator) | CONTEXT.md D-09 |
| `marketing/lib/email.ts` | email/SDK wrapper | No email integration anywhere in repo | CONTEXT.md D-12 + D-13 + D-14; https://resend.com/docs/api-reference/emails/send-email |
| `marketing/supabase/migrations/0001_create_orders_table.sql` | DDL migration | `marketing/supabase/` directory does NOT exist; no migration files anywhere in repo | CONTEXT.md D-11 (schema is locked verbatim) |
| Webhook HMAC verification block of `marketing/app/api/lemon-squeezy/webhook/route.ts` | crypto verification | No `createHmac` / `timingSafeEqual` usage anywhere in repo | CONTEXT.md D-06 skeleton (lines 67-73) + https://docs.lemonsqueezy.com/help/webhooks/signing-requests |

For the Route Handler **file shape** (export POST, return Response), the only repo analog is `frontend/src/app/auth/callback/route.ts:1-22` (GET handler, redirect-based, no shared logic) — useful for confirming the Next.js Route Handler module convention but not for the security-critical body.

---

# Metadata

**Analog search scope:** `marketing/`, `app/api/`, `app/services/`, `frontend/src/app/`, `frontend/src/lib/`
**Files scanned:** ~25 TS/Python files read in full + ~30 ripgrep hits across `marketing/`, `app/`, and `frontend/`
**Pattern extraction date:** 2026-05-23
**No-analog count:** 4 / 12 — planner relies on CONTEXT.md `<specifics>` skeletons for these
**Cross-cutting shared patterns:** 5 (S1–S5)

**Phase 89 / 90 carry-forward decisions reused in this map:**
- D-05 (Phase 89 dual env-var pattern) → Pattern S2
- D-12 (Phase 89 env-var-throws with named error) → Pattern S1
- D-14 (Phase 90 grep-lock on `'use client'` count) → `pricing.tsx` constraint
- Phase 90 verification gap-closure on `.gitignore` → Pattern S5 + the `.gitignore` modification scope
