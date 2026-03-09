---
phase: 67-auth-flow-fixes
plan: "01"
subsystem: frontend-auth
tags: [auth, jwt, api-client, supabase]
dependency_graph:
  requires: [supabase-auth-provider, supabase-browser-client]
  provides: [jwt-token-injection, auth-provider-mounted]
  affects: [all-api-calls, frontend-layout]
tech_stack:
  added: []
  patterns: [supabase-getSession-in-fetch, singleton-browser-client]
key_files:
  created: []
  modified:
    - frontend/src/lib/api.ts
    - frontend/src/app/layout.tsx
    - frontend/src/components/auth-provider.tsx
decisions:
  - "Use createClient() directly in apiFetch instead of React context -- works outside components via cookie/localStorage storage"
  - "Place AuthProvider inside ProfileProvider since ProfileProvider does not depend on auth state"
  - "skipAuth destructured from options to prevent it leaking into fetch() call via restOptions"
metrics:
  duration: "1min"
  completed: "2026-03-09T04:40:40Z"
---

# Phase 67 Plan 01: JWT Token Injection Summary

**One-liner:** Supabase JWT auto-injection into every apiFetch call via getSession(), with AuthProvider mounted in layout

## What Was Done

### Task 1: Add AuthProvider to layout and inject JWT into apiFetch
- **Commit:** e2c9689
- Modified `apiFetch` in `api.ts` to call `createClient().auth.getSession()` before every request
- If a valid session exists, adds `Authorization: Bearer <token>` header automatically
- `skipAuth` option bypasses token injection for public endpoints
- SSR-safe: skips injection when `window` is undefined (server-side rendering)
- Wrapped app content in `AuthProvider` inside `layout.tsx` (nested inside ProfileProvider)
- Exported `AuthContextType` interface from `auth-provider.tsx`

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- TypeScript compiles cleanly (`tsc --noEmit` -- zero errors)
- `AuthProvider` found in layout.tsx at lines 7, 66, 69
- `Authorization` header injection found in api.ts at line 46
- `skipAuth` bypass logic found in api.ts at lines 16, 31, 39, 41

## Self-Check: PASSED
