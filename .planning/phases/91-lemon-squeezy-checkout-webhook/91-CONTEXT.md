# Phase 91: Lemon Squeezy checkout + webhook — Context

**Gathered:** 2026-05-23
**Status:** Ready for planning
**Source:** Autonomous-loop pre-locked decisions (substitute for /gsd-discuss-phase, which is forbidden in autonomous mode).

The orchestrator distilled this CONTEXT.md from:
- `.planning/ROADMAP.md` § Phase 91 (top-level, mirrored from v13-ROADMAP.md in this iteration)
- `.planning/milestones/v13-ROADMAP.md` § Phase 91 (lines 174-184)
- `.planning/milestones/v13-REQUIREMENTS.md` § MARK-03 + MARK-04
- `.planning/v13-desktop-production/SCOPE.md` § C3 (Track C — Lemon Squeezy checkout integration)
- `.planning/v13-desktop-production/ARCHITECTURE.md` § 5 (Subscription enforcement layers) + § 6 (Marketing app stack) + § 9 (Risks — webhook race)
- `.planning/STATE.md` § Decisions L83-84 (pricing tiers locked) + L141-143 (Phase 91 prerequisites enumerated)
- `marketing/lib/supabase.ts` (server client + dual env-var contract from Phase 89)
- `marketing/components/sections/pricing.tsx` (existing placeholder `/signup?plan=*` CTAs — Phase 91 replaces them)
- `marketing/package.json` (existing deps; Phase 91 adds `resend` only — see D-13)

<domain>
## Phase Boundary

Phase 91 closes the loop from landing-page CTAs to a paid customer with a license key. It introduces (a) Lemon Squeezy hosted-checkout URL wiring on the existing Pricing section, (b) a server-side webhook handler that verifies the X-Signature HMAC-SHA256, persists the order in a new `orders` Supabase table, generates a deterministic-format license key, and (c) a Resend-powered confirmation email with the license key.

**In scope:**
- Replace the 3 placeholder hrefs in `marketing/components/sections/pricing.tsx` (`/signup?plan=starter|pro|cloud-sync`) with Lemon Squeezy hosted-checkout URLs computed from env vars
- New `marketing/lib/lemon-squeezy.ts` utility for checkout-URL construction + variant-id ↔ tier mapping (consumed by both Pricing.tsx and webhook handler)
- New webhook route handler at `marketing/app/api/lemon-squeezy/webhook/route.ts` (Next.js App Router Route Handler — `POST` only)
- New Supabase migration creating the `orders` table with idempotency unique constraint on `lemon_squeezy_event_id`
- New `marketing/lib/license-key.ts` utility for generating `EF13-XXXX-XXXX-XXXX-XXXX` format keys (16 hex chars in 4 groups, prefix `EF13`)
- New `marketing/lib/email.ts` utility wrapping Resend send-email with the locked confirmation template
- Integration tests in `marketing/tests/webhook.spec.ts` (Playwright HTTP-driven, exercising the webhook handler via `fetch()` to `http://localhost:3001/api/lemon-squeezy/webhook` with mocked Lemon Squeezy payloads)
- Env vars added to `marketing/.env.example` (NOT `.env.local` — that's gitignored and provisioned manually): `LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_STORE_ID`, `LEMON_SQUEEZY_WEBHOOK_SECRET`, `LEMON_SQUEEZY_STARTER_VARIANT_ID`, `LEMON_SQUEEZY_PRO_VARIANT_ID`, `LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID`, `NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG`, `NEXT_PUBLIC_LEMON_SQUEEZY_STARTER_VARIANT_ID`, `NEXT_PUBLIC_LEMON_SQUEEZY_PRO_VARIANT_ID`, `NEXT_PUBLIC_LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`

**Out of scope (deferred to later phases):**
- `/account` dashboard rendering of orders + license keys (Phase 92)
- OAuth/JWT issuance from license-key + email (Phase 93) — Phase 91 stores the order, Phase 93 reads it for OAuth claims
- Webhook delivery of `subscription_updated` / `subscription_cancelled` / `subscription_payment_*` events — Phase 91 implements `order_created` (Starter+Pro one-time) + `subscription_created` (Cloud Sync recurring) ONLY; lifecycle events deferred to a v13.x patch
- Refund handling (`order_refunded`) — deferred; manual via Lemon Squeezy dashboard in v13
- Custom Lemon Squeezy checkout overlay (the `<script src="https://app.lemonsqueezy.com/js/lemon.js">` overlay pattern) — Phase 91 uses hosted checkout URLs (simpler, no client-side JS); overlay is a post-launch UX improvement
- License-key activation / deactivation API endpoints — Phase 92 territory (`/account/license`)
- Email retries on Resend failure beyond Resend's built-in retry — Phase 91 logs failures + continues (Supabase row persists either way; manual re-send via Resend dashboard if needed)
- Multi-language email templates (English only)
- HTML-formatted emails beyond the Resend default — Phase 91 ships a plain-text + minimal HTML template; design polish is post-launch
- Tax handling — Lemon Squeezy collects tax server-side; Phase 91 stores `total` and `tax` columns but does not surface them in email
- PDF receipt generation — Lemon Squeezy emails its own receipt; Phase 91 only sends the license-key email

</domain>

<decisions>
## Implementation Decisions (locked by autonomous orchestrator, Iteration 89-pattern + Iteration 91-CONTEXT-pattern)

### Plan structure
- **D-01 Two plans, two waves, sequential.** ROADMAP estimates 2 plans for Phase 91. Orchestrator splits as:
  - **Plan 91-01** = Checkout URL wiring (frontend-only changes to `pricing.tsx` + new `lib/lemon-squeezy.ts` + Playwright test asserting both env-present and env-absent fallback paths).
  - **Plan 91-02** = Webhook handler + Supabase schema + license-key generation + email + integration tests.
  - **Why split**: 91-01 is a small focused change (~3 file modifications) that has zero external-service dependencies and can ship + verify standalone. 91-02 is the heavy server-side work with security implications (HMAC, idempotency, fail-closed semantics). Shipping 91-01 first means the landing page already routes correctly to a working Lemon Squeezy hosted checkout the moment the M-prerequisites are provisioned, even if 91-02 takes additional iterations.
  - **Sequential**: 91-02's webhook handler reads the variant-id → tier mapping that 91-01 establishes in `lib/lemon-squeezy.ts`. Parallel execution would create a mapping fork.
  - **Escape clause**: If planner determines >50% context budget would be exceeded in either plan, return `## PLAN SPLIT RECOMMENDED` and orchestrator will split into 91-02a (webhook signature verification + Supabase persistence + idempotency) + 91-02b (license-key + Resend email + tests).

### Lemon Squeezy integration
- **D-02 Hosted checkout URLs over overlay/embed**. Use Lemon Squeezy hosted checkout (`https://[STORE_SLUG].lemonsqueezy.com/buy/[VARIANT_ID]`) — NOT the JavaScript overlay at `https://app.lemonsqueezy.com/js/lemon.js`. Rationale: (a) zero client-side JS surface for the checkout button; (b) overlay requires `'use client'` directive on Pricing component which currently does NOT have one (D-14 from Phase 90 grep-locked exactly 1 `'use client'` at `faq.tsx`); (c) hosted URLs are simpler to test (just assert `href` attribute on the button); (d) overlay can be added post-launch without a webhook refactor.
- **D-03 No Lemon Squeezy SDK (`@lemonsqueezy/lemonsqueezy.js`)**. Construct checkout URLs by string concatenation in `lib/lemon-squeezy.ts`; verify webhook signatures with `node:crypto`'s `createHmac` + `timingSafeEqual`; do not add any LS-specific npm dependency. Rationale: (a) the SDK is in beta and adds an opaque dependency on undocumented API shapes; (b) hosted-checkout URLs and HMAC-SHA256 verification are 50 lines of code total; (c) no SDK = no version-pin churn when Lemon Squeezy ships breaking API changes; (d) easier security audit when the security-critical code is in our repo, not vendored.
- **D-04 Variant IDs are env vars, NOT hardcoded constants**. Even though the orchestrator could lock placeholder IDs here, the real IDs are generated by Lemon Squeezy at product-creation time (M-prerequisite M2). The planner MUST author `lib/lemon-squeezy.ts` to read from `process.env.LEMON_SQUEEZY_*_VARIANT_ID` server-side and `process.env.NEXT_PUBLIC_LEMON_SQUEEZY_*_VARIANT_ID` client-side (the dual-env-var pattern established in Phase 89 D-05). Acceptance: `grep -E "[0-9]{6,}" marketing/lib/lemon-squeezy.ts marketing/components/sections/pricing.tsx` returns 0 matches (no hardcoded LS IDs leak into source).

### Webhook handler
- **D-05 Route file path locked**: `marketing/app/api/lemon-squeezy/webhook/route.ts`. This is the path specified in MARK-04 verbatim. Exposes `POST` handler ONLY (Next.js Route Handler convention — no `GET`/`PUT`/`DELETE`).
- **D-06 Signature verification with `crypto.timingSafeEqual`** — NOT `===` string comparison. Use Node.js `node:crypto`:
  ```ts
  import { createHmac, timingSafeEqual } from 'node:crypto';
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(signatureHeader, 'hex');
  if (expected.length !== received.length) return new Response('Invalid signature', { status: 401 });
  if (!timingSafeEqual(expected, received)) return new Response('Invalid signature', { status: 401 });
  ```
  Rationale: `===` is timing-attack vulnerable; `timingSafeEqual` is constant-time. Lemon Squeezy signs the raw body (NOT the JSON-parsed object) with HMAC-SHA256 using `LEMON_SQUEEZY_WEBHOOK_SECRET` and sends the hex digest in the `X-Signature` header. The route handler MUST read the raw body via `await request.text()` BEFORE parsing JSON (Next.js Route Handlers expose this on the Web `Request` object).
- **D-07 Fail-closed on missing secret**. If `process.env.LEMON_SQUEEZY_WEBHOOK_SECRET` is missing or empty string, return `500 Internal Server Error` with `{"error": "webhook_secret_not_configured"}` — NEVER `200`. Rationale: returning `200` to an unsigned webhook payload would let an attacker insert arbitrary orders + license keys via a `curl` POST. The misconfiguration is loud + visible (failed Lemon Squeezy delivery in their dashboard → operator notices).
- **D-08 Idempotency via `X-Event-Id` header + Supabase unique constraint**. Lemon Squeezy sends a unique `X-Event-Id` header on every webhook delivery; retries (due to non-2xx response or timeout) re-use the same event ID. The `orders` table has a UNIQUE constraint on `lemon_squeezy_event_id`; the route handler attempts `INSERT … ON CONFLICT (lemon_squeezy_event_id) DO NOTHING RETURNING id`. If the row already exists (RETURNING returns 0 rows), the handler returns `200 OK` without re-sending email. Email send happens ONLY when INSERT actually wrote a new row.

### License-key generation
- **D-09 Format `EF13-XXXX-XXXX-XXXX-XXXX`** — `EF13` literal prefix (Edit Factory v13) + 16 hex chars (lowercase) split into 4 groups of 4 by dashes. Generated via `crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-')` then prepended with `EF13-`. Rationale: (a) the `EF13-` prefix lets ops scan a database row at a glance and know the cohort; (b) hex chars (0-9a-f) avoid ambiguity (no `0`/`O` or `1`/`I`/`l` confusion since hex excludes both); (c) 16 hex chars = 64 bits of entropy, sufficient for a per-customer key that is also rate-limited by the activation endpoint in Phase 92; (d) groups-of-4 with dashes is the licensing-industry idiom (matches JetBrains, Adobe, Microsoft).
- **D-10 Uniqueness asserted at DB level, not in code**. The `orders` table has a UNIQUE constraint on `license_key` (in addition to `lemon_squeezy_event_id`). The route handler generates one key + INSERTs; on the astronomical chance of a 64-bit collision, the INSERT raises a PG unique-violation, the handler catches it, generates a new key, retries up to 3 times, then returns `500`. Rationale: race-free + does not require a separate "exists?" check before generating.

### Supabase schema
- **D-11 New migration `marketing/supabase/migrations/0001_create_orders_table.sql`** (Supabase migration files live under `marketing/supabase/migrations/` per Supabase CLI convention; create the directory if absent). Schema:
  ```sql
  create table public.orders (
    id uuid primary key default gen_random_uuid(),
    lemon_squeezy_event_id text not null unique,
    lemon_squeezy_order_id text not null,
    lemon_squeezy_customer_id text not null,
    lemon_squeezy_variant_id text not null,
    buyer_email text not null,
    subscription_tier text not null check (subscription_tier in ('starter', 'pro', 'cloud_sync')),
    license_key text not null unique,
    total_usd_cents integer not null,
    tax_usd_cents integer not null default 0,
    event_type text not null check (event_type in ('order_created', 'subscription_created')),
    raw_payload jsonb not null,
    created_at timestamptz not null default now()
  );
  create index orders_buyer_email_idx on public.orders (buyer_email);
  -- RLS: webhook uses service-role key so RLS does not block inserts;
  -- Phase 92 will add a SELECT policy `auth.uid() = user_id` once user-orders linkage exists.
  alter table public.orders enable row level security;
  ```
  Rationale: (a) `subscription_tier` is a CHECK-constrained text (enum-like without the migration overhead of CREATE TYPE); (b) `raw_payload jsonb` lets Phase 92 forensics retrieve the original webhook even if Lemon Squeezy mutates its API later; (c) `total_usd_cents` integer NOT decimal — financial values use integer cents per the standard "never store currency as float" rule; (d) RLS is enabled but no policies are defined in Phase 91, so the service-role key (which bypasses RLS) is the ONLY way to insert/select — Phase 92 adds user-facing SELECT policy.

### Email
- **D-12 Resend over SendGrid / Postmark / SMTP**. Rationale: (a) the orchestrator's Decisions log L88 + ARCHITECTURE.md §6 already designate Resend; (b) Resend's React Email integration matches the Next.js stack; (c) free tier (3000 emails/month + 100/day) covers v13 launch traffic; (d) simple HTTP API, no SMTP server config.
- **D-13 Single new npm dependency: `resend`** (the official Resend Node.js SDK). No other deps in Phase 91. Acceptance: `cd marketing && npm install --save resend && grep "resend" package.json | wc -l` returns ≥ 1. Verify no LS SDK accidentally added: `grep -c "@lemonsqueezy" marketing/package.json` returns 0.
- **D-14 Email locked subject + body template**:
  - **Subject**: `Your Edit Factory license key`
  - **Body** (plain text + minimal HTML, both rendered):
    ```
    Thanks for buying Edit Factory!

    Your license key:    {LICENSE_KEY}
    Your tier:           {TIER_DISPLAY_NAME}

    Download Edit Factory:
      Windows:  https://github.com/{REPO}/releases/latest/download/editfactory-setup.exe
      macOS:    https://github.com/{REPO}/releases/latest/download/EditFactory.dmg

    Activate by entering your license key in the desktop app on first launch.

    Refund policy: 30-day no-questions refund. Reply to this email.

    Thanks,
    The Edit Factory team
    ```
    `{LICENSE_KEY}` is the generated `EF13-…` key. `{TIER_DISPLAY_NAME}` is `Starter` / `Pro` / `Cloud Sync`. `{REPO}` is a build-time-substituted placeholder reading from `NEXT_PUBLIC_GITHUB_REPO` env var (default `obsidsrl/edit-factory` if unset; planner can pick the actual repo slug from `git config remote.origin.url`).
  - Both plain-text and HTML versions ship in the Resend `send()` call; HTML version is the same content with `<br>` separators + a `<pre>` wrapping the license key for monospace rendering.

### Technical constraints
- **D-15 Zero modifications outside `marketing/`**. Same boundary constraint as Phase 89 + 90. Acceptance: `git diff --stat main..HEAD -- ':(exclude)marketing' ':(exclude).planning'` returns no changes (the `.planning/` exclude covers the planner's own ROADMAP + SUMMARY artifacts).
- **D-16 Webhook route does NOT use `getMarketingSupabase()` from `marketing/lib/supabase.ts` directly** — instead creates a NEW server-side client via `createClient(url, serviceRoleKey)` from `@supabase/supabase-js` (not `@supabase/ssr`) because the webhook has no cookies / no session / no user context. The cookie-aware `createServerClient` from `@supabase/ssr` would either no-op (cookie callbacks are stubs from Phase 89) or throw (depending on Next.js runtime). A NEW dedicated helper `marketing/lib/supabase-service.ts` exposes `getMarketingSupabaseServiceClient()` for service-role usage that explicitly does NOT touch cookies. Phase 89 review WR-02 (service-role key in cookie-aware factory) is closed by this separation.
- **D-17 Tests structured to xfail gracefully when env vars absent**. The Playwright integration spec `marketing/tests/webhook.spec.ts` checks for presence of `LEMON_SQUEEZY_WEBHOOK_SECRET` + `MARKETING_SUPABASE_URL` + `MARKETING_SUPABASE_KEY` at suite-setup; if any are absent, marks all tests as `test.skip()` (NOT xfail — Playwright's `test.skip()` is the analogue of pytest's `pytest.skip`). Rationale: M-prerequisites cannot be provisioned by the autonomous loop; CI without secrets must not fail the build; skip messages must say WHICH env var is missing so the operator can fix it without rerunning. Acceptance: the planner must include explicit `test.skip(!process.env.LEMON_SQUEEZY_WEBHOOK_SECRET, 'M-prerequisite LEMON_SQUEEZY_WEBHOOK_SECRET not set')` calls.

### Verification
- **D-18 Acceptance gate for both plans**: `npm --prefix marketing run typecheck` passes AND `npm --prefix marketing run lint` passes (zero new errors beyond Phase 89's 5 intentional Supabase cookie-stub warnings) AND `npx playwright test --grep "checkout|webhook"` passes locally with env-absence skips visible in output. **MANDATORY Playwright screenshot per CLAUDE.md** for any UI change in Plan 91-01: `marketing/screenshots/phase-91-pricing-with-checkout-urls.png` written by a test that loads the landing page with mock env vars set and asserts a button `href` resolves to a Lemon Squeezy URL.

</decisions>

<manual_prerequisites>
## Manual Prerequisites (NOT autonomous-loop solvable)

These prerequisites CANNOT be provisioned by the autonomous loop because they require navigating third-party web UIs (Supabase Web Dashboard, Lemon Squeezy Web Dashboard, Resend Web Dashboard) and approving credit-card / domain-verification flows. The planner MUST design tests to gracefully skip when the resulting env vars are absent (D-17), and the SUMMARY for each plan MUST re-document these prerequisites with operator-facing instructions.

### M1 — Marketing Supabase project
- Navigate to https://supabase.com/dashboard/new → create a project named `editfactory-marketing` in the closest region to the operator
- Capture from Settings → API:
  - **Project URL** → `MARKETING_SUPABASE_URL` and `NEXT_PUBLIC_MARKETING_SUPABASE_URL` (same value, dual env-var pattern from Phase 89 D-05)
  - **service_role secret** → `MARKETING_SUPABASE_KEY` (server-only; never NEXT_PUBLIC-prefixed)
  - **anon public** key → `NEXT_PUBLIC_MARKETING_SUPABASE_ANON_KEY` (browser-safe; row-level security gates access)
- Write all four into `marketing/.env.local` (gitignored)
- Apply the Phase 91 schema migration: `cd marketing && npx supabase db push` OR paste `marketing/supabase/migrations/0001_create_orders_table.sql` into Supabase SQL editor

### M2 — Lemon Squeezy store + 3 products
- Navigate to https://app.lemonsqueezy.com/ → create a Store (capture the **store slug** from the URL)
- Create 3 products (per the locked pricing from STATE.md L84):
  - **Starter** — Single-payment $79.00 USD → capture **variant ID** (numeric, 6-7 digits)
  - **Pro** — Single-payment $149.00 USD → capture **variant ID**
  - **Cloud Sync** — Subscription $39.00 USD/year → capture **variant ID**
- Navigate to Settings → API → create an API key → capture as `LEMON_SQUEEZY_API_KEY`
- Navigate to Settings → Webhooks → create a webhook pointing to `https://YOUR_MARKETING_DOMAIN/api/lemon-squeezy/webhook` with events `order_created` + `subscription_created` → capture the **signing secret** as `LEMON_SQUEEZY_WEBHOOK_SECRET`
- Write all eight env vars into `marketing/.env.local`:
  - `LEMON_SQUEEZY_API_KEY`
  - `LEMON_SQUEEZY_STORE_ID` (numeric)
  - `LEMON_SQUEEZY_WEBHOOK_SECRET`
  - `LEMON_SQUEEZY_STARTER_VARIANT_ID` + `NEXT_PUBLIC_LEMON_SQUEEZY_STARTER_VARIANT_ID` (same value, dual env)
  - `LEMON_SQUEEZY_PRO_VARIANT_ID` + `NEXT_PUBLIC_LEMON_SQUEEZY_PRO_VARIANT_ID`
  - `LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID` + `NEXT_PUBLIC_LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID`
  - `NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG` (the slug from store URL, e.g., `editfactory`)
- For local dev WITHOUT a public webhook URL: use Lemon Squeezy's `Send test event` feature pointed at `http://localhost:3001/api/lemon-squeezy/webhook` via an ngrok tunnel (`npx ngrok http 3001`)

### M3 — Resend account + verified sender domain
- Navigate to https://resend.com/ → create an account (free tier sufficient for v13 launch)
- Add a sending domain (e.g., `editfactory.app`) → verify DNS records (SPF + DKIM + DMARC) — typically takes 5-30 min for DNS propagation
- Create an API key → capture as `RESEND_API_KEY`
- Pick a sender address using the verified domain (e.g., `licenses@editfactory.app`) → write as `RESEND_FROM_EMAIL`
- Write both into `marketing/.env.local`
- For testing without a verified domain: use `onboarding@resend.dev` as `RESEND_FROM_EMAIL` (Resend's shared test sender; recipient must also be a verified Resend dashboard email)

### M4 — Apply Supabase migration
- After M1 + creating the `marketing/supabase/migrations/0001_create_orders_table.sql` file in Plan 91-02 execution:
  - Option A (recommended): `cd marketing && npx supabase db push` (requires `npx supabase login` + linking the project with `npx supabase link --project-ref YOUR_PROJECT_REF`)
  - Option B (manual): paste the SQL into Supabase Dashboard → SQL Editor → Run

### Verification of prerequisites being met
A single env-var presence check script `marketing/scripts/check-env.ts` SHOULD be authored as part of Plan 91-02 (NOT mandatory — out of scope if it bloats the plan past context budget). When all 13 prerequisite env vars are set, it prints `✓ All Phase 91 env vars present`; when any are missing, it lists them by name + which M-step provisions them.

</manual_prerequisites>

<threats>
## Known Threats (planner must address in PLAN.md threat model)

- **T-91-01 Webhook spoofing**: Attacker POSTs an unsigned `order_created` payload to `/api/lemon-squeezy/webhook` and gets a free license key + downloads. Mitigation: D-06 timing-safe HMAC verification + D-07 fail-closed on missing secret.
- **T-91-02 Replay attack**: Attacker captures a real signed webhook payload (e.g., via TLS-stripping network compromise) and replays it N times to create N orders for the same license key. Mitigation: D-08 idempotency via `X-Event-Id` unique constraint — replays return `200 OK` without DB writes.
- **T-91-03 Email enumeration / address harvesting**: Attacker observes which buyer emails appear in the Supabase `orders` table. Mitigation: RLS enabled (D-11); service-role key required for SELECT in Phase 91; Phase 92 will add user-context SELECT policy `auth.uid() = user_id`. Phase 91 does NOT expose any GET endpoint reading orders.
- **T-91-04 License-key collision**: Two simultaneous webhooks generate the same 64-bit hex key (probability ~1 in 2^64, but DB-level unique constraint catches it). Mitigation: D-10 retry-on-unique-violation up to 3 times.
- **T-91-05 Webhook handler timeout (Lemon Squeezy retries)**: Resend email send takes > 10s, Lemon Squeezy times out, Lemon Squeezy retries, second invocation also sends email → buyer gets duplicate email. Mitigation: D-08 idempotency at the DB layer means the second invocation finds the row already exists and SKIPS the email send (email send is conditional on the INSERT having written a NEW row).
- **T-91-06 Resend API failure**: Resend returns 500 / network failure → email send fails but order row already persisted. Mitigation: log the Resend error to Supabase (a `notes` JSONB column on `orders`? — out of scope for Phase 91; planner may add as a stretch goal) AND return `200 OK` to Lemon Squeezy (we don't want LS to retry just because email failed; the order is recorded). Operator monitors Resend dashboard for delivery failures; can manually re-send via Resend or Supabase.
- **T-91-07 Open-redirect / CSRF on hosted-checkout URLs**: User clicks "Buy Pro" on phishing page that crafted a malicious `https://*.lemonsqueezy.com` URL. Mitigation: hosted-checkout URLs are constructed in our code from env vars, NOT user input — no injection surface in our code path. (Off-domain phishing is the user's problem to detect, not ours.)
- **T-91-08 Tax handling / international compliance**: Lemon Squeezy collects + remits tax server-side based on buyer location (this is the MoR model — Merchant of Record). Phase 91 stores `total` + `tax` but does not surface them in our UI / receipt. The Lemon Squeezy receipt (sent automatically by LS) is the legal tax receipt. Our email is the LICENSE-KEY delivery, NOT a tax receipt.

</threats>

<specifics>
## Specific Patterns + References

### Webhook handler skeleton (planner may adapt; preserve D-06 / D-07 / D-08 semantics)
```ts
// marketing/app/api/lemon-squeezy/webhook/route.ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getMarketingSupabaseServiceClient } from '@/lib/supabase-service';
import { generateLicenseKey } from '@/lib/license-key';
import { sendLicenseEmail } from '@/lib/email';
import { variantIdToTier } from '@/lib/lemon-squeezy';

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: 'webhook_secret_not_configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const signatureHex = request.headers.get('X-Signature') ?? '';
  const eventId = request.headers.get('X-Event-Id') ?? '';
  if (!eventId) return Response.json({ error: 'missing_event_id' }, { status: 400 });

  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let received: Buffer;
  try { received = Buffer.from(signatureHex, 'hex'); }
  catch { return Response.json({ error: 'invalid_signature_format' }, { status: 401 }); }
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return Response.json({ error: 'invalid_signature' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const eventType = payload?.meta?.event_name;  // 'order_created' | 'subscription_created' | …
  if (eventType !== 'order_created' && eventType !== 'subscription_created') {
    return Response.json({ acknowledged: true, note: 'event_type_ignored_in_phase_91' });  // 200 — LS should not retry
  }

  const variantId = String(payload.data.attributes.first_order_item?.variant_id ?? payload.data.attributes.variant_id);
  const tier = variantIdToTier(variantId);
  if (!tier) return Response.json({ error: 'unknown_variant', variantId }, { status: 200 });  // 200 — unknown variant should not retry

  const supabase = getMarketingSupabaseServiceClient();
  // license-key generation with retry-on-unique-violation (D-10)
  // INSERT ON CONFLICT DO NOTHING RETURNING id (D-08)
  // email send only if row was actually written
  // …
}
```

### Pricing.tsx rewiring (Plan 91-01 reference)
```tsx
// marketing/components/sections/pricing.tsx (relevant change)
import { getCheckoutUrl } from '@/lib/lemon-squeezy';
// …
<Button asChild className="w-full">
  <a href={getCheckoutUrl('starter')}>Buy Starter</a>
</Button>
// getCheckoutUrl('starter') returns the LS URL when env vars present,
// or '/signup?plan=starter' fallback when absent (so dev landing page still works)
```

### Mock Lemon Squeezy payload for tests
```json
{
  "meta": { "event_name": "order_created", "custom_data": {} },
  "data": {
    "type": "orders",
    "id": "12345",
    "attributes": {
      "store_id": 99999,
      "customer_id": 77777,
      "user_email": "test@example.com",
      "first_order_item": { "variant_id": 11111, "product_id": 22222 },
      "total": 7900,
      "tax": 0,
      "currency": "USD"
    }
  }
}
```
The HMAC for this body with secret `test-secret` should be computed in the test setup and passed as `X-Signature` header.

### Reference implementations (planner should read for analog patterns)
- `marketing/lib/supabase.ts` (Phase 89) — pattern for env-var-throws-with-named-error-message
- `app/api/desktop_ml_routes.py` (Phase 86) — pattern for SSE / streaming response (NOT used in Phase 91 — webhook is fire-and-forget); referenced only for the "fail-closed when secret missing" pattern in `_unpack_and_promote` (Phase 86 also fails-closed on missing SHA256)
- `app/api/ml_gating.py` (Phase 87) — pattern for dev/desktop bypass (NOT applicable to webhook — webhook always requires real signature even in dev mode; dev convenience comes from the test-skip pattern D-17, not a bypass)
- `frontend/src/lib/supabase.ts` — DO NOT reference; that's the existing app's Supabase (different project per MARK-06)

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope sources
- `.planning/ROADMAP.md` § Phase 91 — top-level mirrored detail section (mirrored in this iteration)
- `.planning/milestones/v13-ROADMAP.md` § Phase 91 (lines 174-184) — full milestone-level detail
- `.planning/milestones/v13-REQUIREMENTS.md` § MARK-03 + MARK-04 — the two requirements this phase closes
- `.planning/v13-desktop-production/SCOPE.md` § C3 — "Lemon Squeezy checkout integration" + webhook + license-key + email
- `.planning/v13-desktop-production/ARCHITECTURE.md` § 5 (Subscription enforcement layers) + § 6 (Marketing app stack: Resend designated) + § 9 Risk-1 (race between purchase and JWT issuance)
- `.planning/STATE.md` § Decisions L83-84 — locked pricing tiers (used in variant-id → tier mapping)
- `.planning/STATE.md` § Manual follow-ups (line 32 / line 141-143) — enumerates Phase 91 prerequisites (M1-M3 mirror this list verbatim with operator-facing how-to)

### Existing Phase 89 + 90 scaffolding (DO NOT break)
- `marketing/package.json` — add `resend` ONLY (D-13); verify no `@lemonsqueezy` package added
- `marketing/lib/supabase.ts` — Phase 89 cookie-aware factories (Phase 91 ADDS a sibling `lib/supabase-service.ts`, does NOT modify the existing file — closes Phase 89 review WR-02)
- `marketing/components/sections/pricing.tsx` — Phase 90 placeholder hrefs (Phase 91 REWIRES; section structure + Tailwind classes preserved)
- `marketing/components/sections/{hero,features,screenshots,comparison,faq,footer}.tsx` — Phase 90 sections (Phase 91 does NOT modify any of these)
- `marketing/.env.example` — Phase 89 env contract (Phase 91 ADDS the 13 new env-var names with placeholder values + reference to M1/M2/M3 in comments)
- `marketing/.gitignore` — Phase 89 + Phase 90 (Phase 91 may need to add `supabase/.branches/` + `supabase/.temp/` if using `npx supabase` locally; planner determines)
- `marketing/playwright.config.ts` — Phase 89 with `PLAYWRIGHT_PORT` env-var override (Phase 91 reuses)
- `marketing/tests/{scaffold-smoke,landing}.spec.ts` — Phase 89 + 90 tests (Phase 91 ADDS `checkout.spec.ts` + `webhook.spec.ts`; does NOT modify existing)

### CLAUDE.md MANDATORY rule
- `CLAUDE.md` § "MANDATORY: Visual Testing with Playwright" — Plan 91-01 produces `marketing/screenshots/phase-91-pricing-with-checkout-urls.png` (UI change); Plan 91-02 has no UI change so no MANDATORY screenshot, but should write a JSON snapshot of a webhook test response to `marketing/screenshots/phase-91-webhook-success.json` as a proof-of-execution artifact (gap-closure prevention — Phase 90 90-VERIFICATION.md learned that artifact gitignore mismatches cost a re-verify cycle; Plan 91-02 should pre-emptively author its `.gitignore` exception for `marketing/screenshots/phase-91-*` per Phase 90 inter-agent learning)

### Lemon Squeezy / Resend docs (for the planner's research phase)
- https://docs.lemonsqueezy.com/help/webhooks/signing-requests — official HMAC-SHA256 spec
- https://docs.lemonsqueezy.com/api/webhooks/the-webhook-object — webhook payload schema
- https://docs.lemonsqueezy.com/help/online-store/checkout-overlay — overlay vs hosted comparison (D-02 picks hosted)
- https://resend.com/docs/api-reference/emails/send-email — Resend send-email API + Node.js SDK

</canonical_refs>

<deferred>
## Deferred Ideas (for v13.x or future milestones)

- **`subscription_updated` / `subscription_cancelled` / `subscription_payment_*` webhook handling** — Phase 91 handles `order_created` (one-time) + `subscription_created` (initial subscription) only. Subscription lifecycle events (renewals, payment failures, cancellations) are deferred to v13.x patch or v14
- **Custom Lemon Squeezy checkout overlay** (the `<script src="https://app.lemonsqueezy.com/js/lemon.js">` JS embed) — Phase 91 uses hosted URLs; overlay is a UX polish item for v13.x
- **Refund / `order_refunded` event handling** — manual via Lemon Squeezy dashboard in v13; programmatic refund handling in v14
- **License-key activation API endpoint** — `/account/license` UI lives in Phase 92; backend activation/deactivation endpoints are Phase 92 also
- **PDF receipt generation** — Lemon Squeezy sends its own receipt (sufficient for tax purposes via MoR model); custom PDF receipt is post-launch UX polish
- **React Email components** (HTML email templates with Tailwind) — Phase 91 uses minimal plain-text + minimal HTML in `lib/email.ts`; React Email is a Phase 92+ polish item once we have a design language for emails
- **Multi-language email templates** — English only in v13
- **Resend retry logic beyond the SDK default** — Phase 91 logs failures + continues; operator handles re-sends manually
- **`marketing/scripts/check-env.ts` script** — out-of-scope optional helper mentioned at the bottom of M-prerequisites; planner picks up if context budget allows
- **Linking `orders.user_id` to a Supabase auth user** — Phase 91 stores `buyer_email` only; Phase 92 adds the linkage when the auth user is created on first OAuth login (Phase 93)

</deferred>

---

*Phase: 91-lemon-squeezy-checkout-webhook*
*Context gathered: 2026-05-23 via autonomous-loop orchestrator (pre-locked decisions D-01..D-18 substitute for /gsd-discuss-phase which is forbidden in autonomous mode; M-prerequisites M1-M4 enumerate manual provisioning steps that the autonomous loop cannot execute)*
*Iteration learning carried forward from Phase 90: pre-emptively author `.gitignore` exceptions for named phase artifacts to avoid the gap-closure cycle that cost Phase 90 a re-verify (see Phase 90 STATE.md Decisions § "Gitignore exception pattern for named gitignored artifacts")*
