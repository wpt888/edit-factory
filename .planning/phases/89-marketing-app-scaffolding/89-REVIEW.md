---
phase: 89-marketing-app-scaffolding
reviewed: 2026-05-23T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - marketing/lib/supabase.ts
  - marketing/lib/utils.ts
  - marketing/tests/scaffold-smoke.spec.ts
  - marketing/playwright.config.ts
  - marketing/package.json
  - marketing/app/page.tsx
  - marketing/app/layout.tsx
  - marketing/app/globals.css
  - marketing/components/ui/button.tsx
  - marketing/components/ui/card.tsx
  - marketing/next.config.ts
  - marketing/tsconfig.json
  - marketing/eslint.config.mjs
  - marketing/.env.example
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Phase 89: Code Review Report

**Reviewed:** 2026-05-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found (0 critical, 2 warning, 5 info)

## Summary

Phase 89 scaffolds a greenfield Next.js 16 marketing app under `marketing/` with
dual Supabase clients, copied Shadcn primitives (Button + Card), an OKLCH
design-token globals.css mirroring the desktop frontend, and a Playwright
smoke test that produces the CLAUDE.md MANDATORY screenshot artifact. The five
prompt focus areas all check out clean at the Critical bar:

1. **Secrets-in-code**: `.env.example` is empty-key-only; `supabase.ts` reads
   exclusively from `process.env`. No hardcoded keys.
2. **XSS in placeholder page**: `app/page.tsx` renders static literal strings
   only — no user input, no `dangerouslySetInnerHTML`. Clean.
3. **Server/browser env-var boundary**: The dual factory split is correctly
   wired — `MARKETING_SUPABASE_KEY` (no `NEXT_PUBLIC_` prefix) is unreachable
   from the client bundle; the browser path uses `NEXT_PUBLIC_*` exclusively.
   The two factories never share a `process.env.*` read. No leak.
4. **Supply-chain risk in `package.json`**: All resolved versions in
   `package-lock.json` are current and free of known unpatched CVEs at review
   time — `next@16.2.6`, `react@19.2.1`, `@supabase/ssr@0.8.0`,
   `@supabase/supabase-js@2.106.1`, transitive `cookie@1.1.1` (above the
   CVE-2024-47764 affected range of `< 0.7.0`).
5. **The 5 ESLint warnings in `supabase.ts`**: traced to the deprecated cookie
   API surface — see WR-01 below. They are "intentional no-ops" in the sense
   that the executor put `// no-op in scaffold` comments in, but the warnings
   originate from the @supabase/ssr v0.8 `@deprecated` overload, not from
   ESLint's no-unused-vars rule. The warnings flag a forward-compatibility
   risk, not a stylistic preference.

Two warnings cover the deprecated cookie API divergence from in-repo precedent
and the service-role + cookie-machinery design smell. Five info items cover
defense-in-depth, test reliability, and minor code style.

The prompt's file inventory describes `next.config.ts` as "empty config —
defaults", but the actual file has `output: "standalone"` (intentional for
Phase 96 Vercel/Docker — confirmed in commit `8bb070f`). Inventory stale, not
a bug.

---

## Warnings

### WR-01: `getMarketingSupabase` uses the deprecated cookie API (get/set/remove) — will break on @supabase/ssr v0.9+

**File:** `marketing/lib/supabase.ts:43-55`

**Issue:** `createServerClient` is called with `cookies: { get, set, remove }`.
This matches the `CookieMethodsServerDeprecated` overload in
`@supabase/ssr@0.8.0/dist/main/createServerClient.d.ts`, which is explicitly
annotated:

> `@deprecated Please specify getAll and setAll cookie methods instead of the
> get, set and remove. These will not be supported in the next major version.`

Three concrete consequences:

1. **The 5 ESLint warnings the executor mentioned originate here.**
   `eslint-config-next` reads JSDoc `@deprecated` on imported overloads and
   warns at the call site. They are NOT "harmless unused-arg no-ops" — they
   are forward-compat warnings the lint rule is correctly raising.
2. **Divergence from in-repo precedent.** `frontend/src/lib/supabase/server.ts`
   (the existing app's pattern) uses `getAll` / `setAll`. The marketing
   scaffold establishes a contradictory pattern for Phase 92+ to inherit,
   which will require a refactor before that inheritance lands.
3. **Major-version upgrade risk.** `@supabase/ssr` is currently on `0.10.3`
   `latest`; the comment in the .d.ts says these methods "will not be
   supported in the next major version." A `npm update` past 0.8.x produces
   runtime breakage that `tsc --noEmit` will catch (CookieMethodsServer is
   the only allowed shape) — but the executor's verification flow uses
   pinned `^0.8.0`, so the regression will not surface until that bump.

**Fix:** Replace the cookie block with the supported API:

```typescript
import { createServerClient } from "@supabase/ssr";

// scaffold-mode: getAll returns nothing; setAll is a no-op.
// Phase 92 wires getAll() to cookies().getAll() and setAll() to cookies().set().
return createServerClient(url, key, {
  cookies: {
    getAll() {
      return [];
    },
    setAll(_cookiesToSet) {
      // no-op in scaffold; Phase 92 wires this to next/headers cookies()
    },
  },
});
```

This drops the `CookieOptions` import (no longer needed), eliminates the 5
deprecated-overload warnings, and matches `frontend/src/lib/supabase/server.ts`
exactly so Phase 92's "wire cookie callbacks" task becomes a 6-line diff
instead of an API migration.

---

### WR-02: Service-role key passed to `createServerClient` with cookie callbacks — RLS-aware machinery applied to an RLS-bypassing key

**File:** `marketing/lib/supabase.ts:23-56`

**Issue:** `getMarketingSupabase()` is documented (line 6) as using the
**SERVICE-ROLE** key (`MARKETING_SUPABASE_KEY`, no `NEXT_PUBLIC_` prefix).
Service-role keys **bypass Row Level Security entirely** and have no user
context. However, `createServerClient` from `@supabase/ssr` is designed for
**user-authenticated** SSR flows (anon key + per-request session cookies).
Combining them is conceptually muddled:

- The cookie callbacks (even as no-ops) signal "this client tracks a user
  session" — but the service-role key has no user.
- A future maintainer reading the call site has no signal that this client
  **bypasses all RLS** — they may treat it as a normal user-scoped client
  and write privileged queries without the input validation that
  service-role usage requires.
- The standard Supabase pattern for service-role server clients is
  `createClient` from `@supabase/supabase-js` with explicit
  `auth: { persistSession: false, autoRefreshToken: false }` — which is
  exactly what Phase 91's Lemon Squeezy webhook handler will need (the
  webhook has no user session; it just writes to a privileged table).

This is not a runtime bug — `@supabase/ssr`'s no-op cookies will silently
work — but the API choice paints Phase 91's webhook handler into a corner
where every privileged write goes through a cookie-aware client that
implies a user context that doesn't exist.

**Fix:** Switch the server factory to `@supabase/supabase-js` directly:

```typescript
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function getMarketingSupabase() {
  const url = process.env.MARKETING_SUPABASE_URL;
  const key = process.env.MARKETING_SUPABASE_KEY;

  if (!url) {
    throw new Error(
      "MARKETING_SUPABASE_URL is not set. " +
        "Provision the marketing Supabase project and add the URL to marketing/.env.local."
    );
  }
  if (!key) {
    throw new Error(
      "MARKETING_SUPABASE_KEY is not set. " +
        "Add the service-role key (server-only secret) to marketing/.env.local."
    );
  }

  return createSupabaseClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
```

If Phase 92's account dashboard needs an SSR-aware user-context client, it
should be a **third** factory (e.g., `getMarketingServerUserClient()`) that
uses the **anon** key + real cookie wiring — not a re-use of the
service-role factory. The two roles (privileged-bypass-RLS vs.
user-cookie-session) should not share an entry point.

---

## Info

### IN-01: `marketing/lib/supabase.ts` is not marked `import "server-only"`

**File:** `marketing/lib/supabase.ts:1`

**Issue:** `getMarketingSupabase()` reads `MARKETING_SUPABASE_KEY` (no
`NEXT_PUBLIC_` prefix). Next.js's bundler will not inline that env var into
client bundles — the **secret value** cannot leak. However, if a Client
Component accidentally imports `getMarketingSupabase` (e.g., via a top-level
re-export from `marketing/lib/index.ts` later), the entire `createServerClient`
codepath gets bundled and the function throws an "is not set" error at runtime
with no compile-time signal. Adding `import "server-only"` at the top of the
file makes any client-side import fail at build time with a clear error
message naming the offending import.

The existing `frontend/src/lib/supabase/server.ts` also omits this directive,
so the scaffold is consistent with repo precedent — flagging at Info, not
Warning. But marketing/ is a greenfield app with the chance to do this
right from day one before Phase 91/92 add Route Handlers + dashboard pages.

**Fix:**
```typescript
import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
// ... rest unchanged
```

Add `"server-only": "^0.0.4"` to `dependencies` in `package.json` (it is
shipped with Next.js but listing it explicitly is the documented pattern).

Note: this only applies to the server factory. `getMarketingBrowserClient`
must remain client-importable.

---

### IN-02: `playwright.config.ts` has redundant parallel-disabling settings

**File:** `marketing/playwright.config.ts:16,19`

**Issue:** `fullyParallel: false` (line 16) and `workers: 1` (line 19) are
redundant. `workers: 1` already serializes the entire run; `fullyParallel`
controls in-worker parallelism which is moot with a single worker. The
combination is harmless but signals "parallelism setting" twice with no
single source of truth.

**Fix:** Pick one. For a single-spec smoke test, `workers: 1` is sufficient
and self-documenting; drop `fullyParallel: false`.

---

### IN-03: `waitForLoadState('networkidle')` is flagged as flaky by Playwright docs

**File:** `marketing/tests/scaffold-smoke.spec.ts:13`

**Issue:** Playwright's official docs (test best-practices page) explicitly
discourage `networkidle` because "this rarely works as expected with
modern apps" — long-poll connections, sonner Toaster, and Next.js's HMR
WebSocket all keep the network non-idle indefinitely. The current test
passes because the `await expect(...).toBeVisible()` calls have their own
auto-waiting, masking the `networkidle` step entirely. If a future change
makes any background fetch keep-alive past 60 s, this assertion times out
with a misleading error.

**Fix:** Remove the `waitForLoadState` call entirely — the subsequent
`expect.toBeVisible()` already auto-waits with the configured 60 s timeout:

```typescript
// Remove line 13:
//   await page.waitForLoadState('networkidle');
// The expect.toBeVisible() below auto-waits for the element to render.
```

Or, if waiting for the DOM is desired, use `'domcontentloaded'` instead.

---

### IN-04: Redundant optional chaining after non-null assertion

**File:** `marketing/tests/scaffold-smoke.spec.ts:9-10`

**Issue:** Line 9 asserts `response, '...').not.toBeNull()` but line 10
still uses `response?.status()` with optional chaining. Either the assertion
makes the optional chain unnecessary (TS narrowing won't apply across
`expect()` boundaries, but at runtime the `?.` is dead code), or the
optional chain is a hedge that the assertion's failure path doesn't actually
short-circuit — in fact `expect().not.toBeNull()` does throw on null, so
line 10 is unreachable with `response === null`.

**Fix:** Use a non-null assertion or restructure:

```typescript
const response = await page.goto('/');
expect(response, 'page.goto should return a Response').not.toBeNull();
expect(response!.status(), 'home page should return HTTP 200').toBe(200);
```

Or assert directly without the intermediate null check:
```typescript
const response = await page.goto('/');
expect(response?.status() ?? 0, 'home page should return HTTP 200').toBe(200);
```

---

### IN-05: `package.json` mixes exact-pin and caret-range — react/react-dom exact, every other dep capped at caret

**File:** `marketing/package.json:14-37`

**Issue:** `react@19.2.1` and `react-dom@19.2.1` are pinned exactly (no `^`),
but every other dep uses `^` ranges. This is intentional per D-02 in the
SUMMARY ("React 19.2.1 exact pin") but the rationale is not documented
in-tree. A maintainer looking at `package.json` alone cannot infer why
React is special-cased — they may be tempted to "fix the inconsistency" by
removing the pin, which silently breaks React 19's strict-mode + Tailwind 4
+ Next.js 16 compatibility envelope that Phase 89 verified.

**Fix:** Add a one-line comment via the package.json `description` field
(JSON doesn't allow inline comments, but you can document at the top via a
single `"//"` key which most tools ignore):

```json
{
  "name": "marketing",
  "version": "0.1.0",
  "private": true,
  "//": "React/react-dom pinned EXACTLY (no ^) per Phase 89 D-02. The 19.2.1 stack was the validated envelope for Next.js 16.1.1 + Tailwind 4. Bump only via deliberate version-update phase.",
  "scripts": {
    "dev": "next dev --port 3001",
    ...
  }
}
```

Alternative: add the rationale to `marketing/README.md` (which doesn't exist
yet but should be created before Phase 90 to onboard future maintainers).

---

_Reviewed: 2026-05-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
