---
phase: 91-lemon-squeezy-checkout-webhook
plan: 2
status: complete-code / M4-deferred
completed: 2026-07-02
commits:
  - f1ce524 (Task 1 — resend dep + 4 utility files + license-key spec + migration)
  - d90b55d (Task 3 — webhook route handler + webhook.spec.ts)
requirements: [MARK-04]
---

# Plan 91-02 Summary — Lemon Squeezy webhook handler

## What shipped

**Files created (6):**
- `marketing/lib/supabase-service.ts` — `getMarketingSupabaseServiceClient()`: cookie-less service-role client via `createClient` from `@supabase/supabase-js` (D-16; closes Phase 89 review WR-02). Env-var-throws pattern S1 preserved.
- `marketing/lib/license-key.ts` — `generateLicenseKey()`: `EF13-XXXX-XXXX-XXXX-XXXX`, 64-bit entropy, D-23 regex contract.
- `marketing/lib/email.ts` — `sendLicenseEmail({to, licenseKey, tier})` via Resend; D-14 subject + body LOCKED verbatim; GitHub Release download links from `NEXT_PUBLIC_GITHUB_REPO` (default `obsidsrl/edit-factory`).
- `marketing/supabase/migrations/0001_create_orders_table.sql` — byte-faithful to CONTEXT.md D-11: UNIQUE on `lemon_squeezy_event_id` (D-08) + `license_key` (D-10), CHECK on tier (underscore `cloud_sync` per D-19) + event_type, `orders_buyer_email_idx`, RLS enabled with 0 policies.
- `marketing/app/api/lemon-squeezy/webhook/route.ts` — POST handler: D-07 fail-closed 500 on missing secret → raw-body HMAC-SHA256 `timingSafeEqual` (D-06/T-91-01) → event-type routing (order_created + subscription_created; others 200 `event_type_ignored_in_phase_91`) → `variantIdToTier` (Plan 91-01 contract; unknown variant → 200 `unknown_variant`) → idempotent INSERT with 23505 discrimination (event-id dup → 200 `duplicate_event_id` no email; license-key dup → retry ≤3 per D-10) → conditional `sendLicenseEmail` with T-91-06 catch (Resend failure logged, 200 returned, row persisted).
- `marketing/tests/webhook.spec.ts` — 9 scenarios: 8 in the main describe gated by D-17 `test.skip()` on M1/M2 env absence; Test 9 (fail-closed branch) runs only when the secret is UNSET.

**Files modified (1):**
- `marketing/package.json` — `resend@^6.16.0` (sole new dep, D-13; `@lemonsqueezy` grep = 0 per D-03) + `test:webhook` / `test:webhook:no-secret` scripts (D-20 pattern).

## Test outcomes (2026-07-02, PLAYWRIGHT_PORT=3099 — port 3001 occupied by main EF frontend)

- `tests/license-key.spec.ts`: **3/3 passed** (regex ×100, uniqueness ×100, 24-char).
- `tests/webhook.spec.ts`: **8 skipped** (D-17 — M1/M2 env vars absent) + **Test 9 passed** (route live, returns 500 `webhook_secret_not_configured`).
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors / 5 pre-existing Phase 89 warnings (baseline preserved).
- All grep acceptance gates pass (resend=1, @lemonsqueezy=0, timingSafeEqual=3, fail-closed=1, dup=1, SQL constraints all=1, test.skip=6).

## Task 2 outcome — **M4 DEFERRED** ("skip — Supabase project not provisioned yet")

`marketing/.env.local` does not exist; M1 (marketing Supabase project) / M2 (Lemon Squeezy store + 3 variants) / M3 (Resend) are all unprovisioned. The plan's sanctioned third resume-signal applies: migration SQL remains in-repo, DB-touching tests skip per D-17, code is shippable. **MARK-04 is code-complete but not empirically closed** until the operator:
1. (M1) Creates the `editfactory-marketing` Supabase project; wires `MARKETING_SUPABASE_URL` + `MARKETING_SUPABASE_KEY` (+ `NEXT_PUBLIC_*` pair) into `marketing/.env.local`.
2. (M4) Applies `0001_create_orders_table.sql` via `npx supabase db push` or the SQL Editor.
3. (M2) Creates the LS store + Starter/Pro/Cloud Sync variants; wires `LEMON_SQUEEZY_WEBHOOK_SECRET` + 3 `*_VARIANT_ID` vars; registers the webhook at `https://YOUR_DOMAIN/api/lemon-squeezy/webhook` subscribed to `order_created` + `subscription_created`.
4. (M3) Provisions Resend (`RESEND_API_KEY` + `RESEND_FROM_EMAIL`).
5. Re-runs `npm run test:webhook` — 8 tests then execute; Test 1 writes the proof artifact.

## Known gap — proof artifact + gitignore

`marketing/screenshots/phase-91-webhook-success.json` is only produced by Test 1, which skipped. When produced, `git check-ignore` currently exits 0 because root `.gitignore:114` (`screenshots/`) overrides the `marketing/.gitignore` exception (Git nested-gitignore semantics — same as Phase 90/91-01). Use **`git add -f`** exactly as recorded in STATE.md Phase 91 decision notes.

## Cross-references

- Plan 91-01 SUMMARY covers the MARK-03 frontend half (checkout CTAs). Combined, the two plans complete Phase 91's code surface.
- Production deployment notes: set all M1/M2/M3 env vars in the Vercel/host project env; webhook URL registration is per-environment.
