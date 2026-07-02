---
phase: 91-lemon-squeezy-checkout-webhook
verified: 2026-07-02
verdict: PASSED-CODE (empirical closure gated on operator M1-M4)
plans: [91-01, 91-02]
---

# Phase 91 Verification — Lemon Squeezy checkout + webhook

Verified against ROADMAP Success Criteria (SC1–SC4) and the Plan 91-02 must_haves. All checks re-run live on 2026-07-02 (not inherited from SUMMARY claims), on `feat/mvp-remediation-w0-w2` at `7b9ae25`, Playwright on fallback port 3099 (3001 occupied by main EF frontend).

## Success Criteria

| SC | Statement | Status | Evidence |
|----|-----------|--------|----------|
| 1 | "Buy Starter" opens LS checkout; test purchase fires webhook | **Code-verified / empirically gated** | `grep -c getCheckoutUrl marketing/components/sections/pricing.tsx` = 4 (3 tiers + import); `phase-91-pricing-with-checkout-urls.png` (212 KB) committed; checkout-with-env/without-env specs pass per 91-01-SUMMARY. Real purchase requires M2 (LS store). |
| 2 | Webhook is signature-verified — invalid signatures return 401 | **VERIFIED LIVE** | Tests 3+4 pass against the running route: wrong-secret HMAC → 401 `invalid_signature`; missing header → 401 `missing_signature`. `timingSafeEqual` grep = 3 in route.ts. Fail-closed: Test 9 passes live — secret unset → 500 `webhook_secret_not_configured` (never 200). |
| 3 | New order row in marketing Supabase with generated license key | **Code-complete, gated on M1+M4** | INSERT path + 23505 discrimination implemented; migration SQL has both UNIQUE constraints (grep = 1 each); Tests 1/2/8 skip per D-17 until the Supabase project exists. |
| 4 | Confirmation email with license key arrives | **Code-complete, gated on M3** | `sendLicenseEmail` with D-14 locked subject/body (grep gates pass); Resend-failure resilience implemented per T-91-06. |

## Additional live evidence (2026-07-02)

- `tests/license-key.spec.ts` **3/3 pass**: D-23 regex ×100, uniqueness ×100, 24-char invariant.
- `tests/webhook.spec.ts` Tests 3–7 **5/5 pass live** with dummy secret + variant IDs (no DB needed): invalid/missing signature, missing event-id 400, ignored event-type 200, unknown variant 200.
- Test 9 fail-closed **passes live** (D-07).
- **6 of 9 webhook scenarios empirically verified**; the 3 DB-touching scenarios (1, 2, 8) skip per D-17.
- `npx tsc --noEmit` clean; `npm run lint` 0 errors / 5 pre-existing Phase 89 warnings.
- D-03 honored: `grep -c '"@lemonsqueezy' marketing/package.json` = 0; D-13 honored: `resend` is the sole new dep.
- T-91-01 (only HIGH threat) mitigation empirically confirmed (SC2 row above) — the plan's HIGH-severity gate is closed.

## Gaps (all operator-gated, none code-side)

1. **M1** marketing Supabase project + **M4** apply `0001_create_orders_table.sql` → unblocks Tests 1/2/8 + SC3.
2. **M2** LS store + 3 variants + webhook registration → unblocks SC1 end-to-end + real webhook delivery.
3. **M3** Resend account → unblocks SC4.
4. Proof artifact `phase-91-webhook-success.json` is produced by Test 1 (currently skipped); commit with `git add -f` (root `.gitignore:114` override — known pattern).

## Verdict

**PASSED-CODE.** Every automatically verifiable truth passes; every remaining gap requires operator credentials the autonomous loop cannot provision. MARK-03 + MARK-04 marked *Code-complete* in REQUIREMENTS.md (not *Satisfied*) until M1–M4 land. Phase 92 (account dashboard) is unblocked — it depends on Phase 91's code surface, not on the LS store being live.
