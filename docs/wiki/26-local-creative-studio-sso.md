# Local BlipCreative to BlipStudio SSO recovery

Status: resolved and verified locally on 2026-07-17.

## Expected flow

An authenticated user selects BlipStudio from the BlipCreative dashboard at
`http://localhost:3000`. The web `/studio` route verifies the Auth.js session,
creates a short-lived single-use Supabase magic-link token, and redirects to:

```text
http://localhost:3947/auth/callback?next=%2Fpipeline&source=blipcreative&...
```

The Studio callback consumes the token in the browser Supabase client, persists
the resulting session, and opens `/pipeline`. The user must not see a second
password form.

## Symptoms

- The first failure was `Could not reach blipost.com.` from
  `POST /api/v1/platform/session` in the local Studio backend.
- After pointing that bridge at the local web app, manual login reached the web
  endpoint but displayed `Desktop identity provider is unavailable` for valid
  BlipCreative credentials. Invalid credentials correctly produced the normal
  password error.
- Opening Studio from an already authenticated dashboard still ended on the
  Studio login form instead of `/pipeline`.

The manual credential form is a fallback. Debug the `/studio` SSO path first;
asking the user to sign in twice hides the real failure.

## Diagnostic sequence

Use read-only checks before changing identity data:

1. Confirm the local services listen on web `3000`, Studio frontend `3947`, and
   Studio backend `8000`.
2. Set the local Studio backend's uncommitted environment value:

   ```text
   BLIPOST_PLATFORM_BASE_URL=http://localhost:3000
   ```

3. Confirm the web bridge has a Supabase URL, anon key, and service-role
   credential without printing their values.
4. Check Supabase Auth health and read the Auth.js-to-Supabase mapping. In this
   incident, both users existed and the mapped UUIDs matched.
5. Inspect the Supabase user's `last_sign_in_at`. It advanced at the failed UI
   attempt, proving that the single-use token was valid and had been consumed.

That evidence ruled out password validation, Supabase availability, identity
provisioning, and UUID mismatch. The session was being discarded after a
successful callback.

## Root cause

The standalone frontend is a production desktop build even when served
locally. Its root layout contained an unconditional host pin:

```js
if (location.hostname === "localhost") {
  location.replace(location.href.replace("//localhost", "//127.0.0.1"));
}
```

The pin was introduced for native Electron media requests: the backend's
HttpOnly media cookie belongs to `127.0.0.1:8000`, so the Electron renderer
also needs the `127.0.0.1` host.

The same rule was incorrectly applied when a normal browser followed the SSO
redirect. It moved Studio from `localhost:3947` to `127.0.0.1:3947`, while the
originating Auth.js cookie remained on `localhost:3000`. The browser-only
Creative-session binding could no longer validate that cookie, failed closed,
signed out the newly created Studio session, and returned to login.

## Resolution

Gate host pinning on the runtime Electron preload bridge:

```js
if (
  location.hostname === "localhost" &&
  window.editFactory?.isDesktop
) {
  location.replace(location.href.replace("//localhost", "//127.0.0.1"));
}
```

This preserves both contracts:

- normal browser SSO stays on `localhost:3947`, so it can validate the
  Creative Auth.js session on `localhost:3000`;
- the native Electron renderer still moves to `127.0.0.1`, matching the local
  backend cookie host and its existing desktop-only session behavior.

The web-side desktop-auth bridge also now resolves the same server-only Studio
identity configuration used by `/studio`. In development it may read the
sibling `edit_factory` environment files; production still requires explicit
`DESKTOP_SUPABASE_*` values. No secret is exposed to browser code or logs.

## Activation

The Electron shell serves `frontend/.next/standalone/server.js`, not live
frontend source. A source fix is inactive until the standalone bundle is
rebuilt and the shell is relaunched.

1. Save open Studio work and allow in-flight jobs to finish.
2. Back up the current `frontend/.next` directory.
3. Exit the Electron shell and its managed frontend/backend children.
4. Run `npm run build` from `edit_factory/frontend`.
5. Relaunch with `npm run dev` from `edit_factory/electron`.
6. Return to the BlipCreative dashboard and select BlipStudio again. A fresh
   click is required because magic-link tokens are single-use.

## Verification

The resolved build passed:

- `npm run studio-auth:check`;
- focused ESLint for the layout and auth verification script;
- `npm run typecheck`;
- `npm run build`, including standalone post-build asset copying;
- `GET http://localhost:3947/auth/callback` -> `200`;
- `GET http://127.0.0.1:8000/api/v1/health/live` -> `200`, `status=ok`;
- CORS preflight from `http://localhost:3947` to
  `http://localhost:3000/api/studio/session` -> `204`, exact allow-origin, and
  credentials enabled;
- served HTML contains the Electron-gated host pin and no longer contains the
  unconditional localhost-to-127 redirect.

Regression coverage in `frontend/scripts/verify-studio-auth.mts` asserts that
loopback host pinning remains gated by `window.editFactory?.isDesktop`.
