# Desktop authentication and startup recovery

## Scope

This note records the July 2026 desktop authentication incident and the
invariants that must remain true when changing Supabase auth, the Next.js root
layout, Electron startup, or the standalone frontend build.

## User-visible symptoms

The incident appeared as several different failures, although they belonged to
the same startup/authentication chain:

- the desktop application opened without requiring an account;
- valid website credentials were rejected or the form appeared to do nothing;
- the backend returned `401` for `POST /api/v1/profiles/` after sign-in;
- the UI reported `Authentication is disabled` even though desktop auth was
  intended to be enabled;
- `next build` failed while prerendering `/media-library` with
  `useProfile must be used within ProfileProvider`;
- a second `npm run dev` exited immediately while the first Electron instance
  remained hidden or had already lost one of its child services;
- after services became healthy, Electron displayed Next's white
  `Application error` page.

Health checks alone were not sufficient: both ports could respond while the
React renderer had already crashed.

## Root causes

### 1. Build-time auth flags differed from runtime flags

`NEXT_PUBLIC_*` values are compiled into browser JavaScript. Setting
`NEXT_PUBLIC_AUTH_DISABLED=false` only when Electron starts
`.next/standalone/server.js` cannot change a bundle that was built with auth
disabled. The desktop build must force the auth and desktop flags during
`next build`, and those inputs must participate in the standalone-bundle
fingerprint.

The enforced desktop build contract is:

```text
NODE_ENV=production
NEXT_PUBLIC_AUTH_DISABLED=false
NEXT_PUBLIC_DESKTOP_MODE=true
AUTH_DISABLED=false
```

Do not rely on `.env.local` for a desktop production bundle.

### 2. Auth state and navigation raced after sign-in

Navigation could reach a protected route before the provider had committed the
new Supabase user/session. The desktop guard then interpreted the transient
state as signed out and returned to `/login`.

`AuthProvider.signIn()` must commit `session` and `user` from the successful
`signInWithPassword()` result before the login page navigates. The guard also
redirects an authenticated user away from `/login`, providing a recovery path
after a remount. Avoid an immediate `router.refresh()` after `router.replace()`;
it can restart session initialization and reintroduce the race.

### 3. Supabase identity and application profile were not guaranteed 1:1

A Supabase `auth.users` identity must have an application-owned default profile
whose `user_id` is that exact auth UUID. Migration
`050_create_default_profile_for_auth_user.sql` backfills existing identities
and installs the creation trigger for new identities.

Never create a desktop-only identity store or a second password table. Website
and desktop clients authenticate against the same Supabase project, and all
profile-scoped rows must resolve through the authenticated auth UUID.

Passwords and service-role keys must not be recorded in this wiki or committed
to the repository.

### 4. Small clock differences could invalidate a fresh JWT

The backend JWT verification path needs a small, explicit leeway for `iat` and
related time claims. Without it, a newly issued valid token could fail with
`ImmatureSignatureError`, presenting as a profile API `401` immediately after
successful sign-in. Keep the current 30-second leeway unless the identity
provider contract changes.

### 5. The root redirect conflicted with session restoration

The final white screen was React error `#310`:

```text
Rendered more hooks than during the previous render.
```

It was reproducible only when an authenticated browser loaded `/` directly.
The server component called Next.js `redirect("/pipeline")` while
`AuthProvider` was restoring the Supabase session and the desktop guard was
changing its protected-route state. The failure surfaced inside Next's
internal `Router` component, which made the production stack misleading.

The root page is now a stable client component that renders a loading state and
performs `window.location.replace("/pipeline")` in one unconditional effect.
This prevents `/` from remaining in history and avoids mixing the server
redirect signal with the auth-state transition.

### 6. Single-instance Electron masked dead child services

Electron correctly rejected a second application instance, so the second
`npm run dev` command returned immediately. Previously, the primary instance
could remain in the tray or keep a stale window even after its backend or
frontend child had stopped.

On `second-instance`, the primary process now:

1. restores, shows, raises, and focuses the existing window;
2. checks both backend and frontend health;
3. performs a controlled relaunch when either service is unavailable.

Renderer console errors and crashes are also copied to the desktop log. Keep
that logging: it distinguishes an HTTP service failure from a client-side
React exception.

## Provider/layout invariant

Every route rendered inside the application shell must remain below the
providers in this order:

```text
ThemeProvider
  AuthProvider
    ProfileProvider
      DesktopAuthGuard
        NavBarWrapper
          route content
```

Components calling `useProfile()` must never be rendered outside
`ProfileProvider`, including during static generation and public-route
rendering. After changing the root layout or navbar wrapper, run a production
build; dev navigation alone does not exercise prerendering.

## Required regression procedure

Run these checks after changing auth, providers, root navigation, Electron
startup, or build environment handling:

```powershell
cd frontend
npm run typecheck
npm run lint

cd ..\electron
npm run predev
npm run dev
```

Then verify the complete production flow, not only the login request:

1. signed-out startup displays the branded login page;
2. a real Supabase account signs in;
3. `GET /api/v1/profiles/` and `GET /api/v1/platform/me` return `200`;
4. direct navigation to `/` reaches `/pipeline` without a page exception;
5. restarting Electron restores the session and selected profile;
6. Sign out clears account-scoped local state and returns to `/login`;
7. a second `npm run dev` surfaces the existing healthy window;
8. stopping one child service and launching again triggers controlled recovery.

The focused backend regression is:

```powershell
.\venv\Scripts\python.exe -m pytest tests\test_desktop_auth_identity.py -q --tb=short
```

## Diagnostic checklist

Use the evidence in this order:

1. inspect the latest session in
   `%APPDATA%\edit-factory-shell\logs\editfactory.log`;
2. confirm listeners on ports `3947` and `8000`;
3. confirm both health endpoints respond;
4. search the current session log for `[renderer]`, `401`, `500`, `ERROR`, and
   `Traceback`;
5. if production only shows a minified React code, reproduce the exact route
   and auth transition with `next dev --webpack` and capture `pageerror`;
6. rebuild the standalone bundle after every relevant source or build-policy
   change; do not assume the previous bundle is current.

For the July incident, testing `/librarie` alone did not reproduce the crash.
The decisive regression was: sign in, wait for `/librarie`, then directly load
`/`. Always test the actual Electron startup URL.
