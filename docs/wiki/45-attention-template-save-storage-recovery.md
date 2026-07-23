# Attention Templates Save: storage migration, RLS auth, and PostgREST cache

## Symptom

Saving a newly authored Attention Template failed even when the template
contained only normal image slots and no default content. The editor first
showed the browser-level message `Failed to fetch`. After the API started
returning controlled storage errors, the visible message became:

> Attention template storage is unavailable. Ask an administrator to apply
> the latest database migrations.

The slot payload was valid. The failure was entirely in persistence and had
three separate causes that appeared one after another.

## Root cause 1: migration 051 referenced the wrong profile table

`supabase/migrations/051_attention_hooks_v1.sql` attempted to create the
foreign key and RLS policy against `editai_profiles`. Supabase uses
`public.profiles`; `editai_profiles` is only a logical repository name mapped
to `profiles` by the SQLite backend.

Consequently, the Supabase migration could not create
`public.editai_attention_templates`, while the list endpoint hid that schema
failure by serving the deterministic system-template library. Save was the
first operation that required the missing table and raised an unhandled
repository exception.

The repair has two layers:

- migration 051 now references `public.profiles` for fresh installations;
- additive migration `057_repair_attention_templates.sql` creates the table,
  index, foreign key, RLS policy, and missing `attention_timeline` column with
  `IF NOT EXISTS` guards for already-running installations.

Migration 057 is intentionally non-destructive: it does not truncate, delete,
or overwrite existing template or pipeline data.

## Root cause 2: backend used the anon Supabase session for writes

The desktop/local backend may intentionally have only `SUPABASE_KEY` (public
anon key), not `SUPABASE_SERVICE_ROLE_KEY`. A process-wide repository created
with the anon key cannot safely write through a profile-scoped RLS policy.
Disabling RLS or granting unrestricted public access was rejected because the
anon key is public.

`SupabaseRepository` now supports an injected client and exposes a short-lived
`authenticated(access_token)` context. Attention Template list/create/update/
delete operations use the caller token already verified and supplied in the
API request whenever no service-role key is configured. Each request gets its
own PostgREST client; the global singleton is never mutated, avoiding token
leakage between concurrent users.

If a service-role key is present on a trusted backend, the existing global
repository path is retained. SQLite continues to use its normal repository.

## Root cause 3: stale PostgREST mutation metadata

After the table existed, direct reads returned `200 []`, but POST returned
`404 {}`. PostgreSQL grants, foreign key, index, and RLS policy were all
correct. A transaction executed as an authenticated role could insert and
roll back successfully, proving the table and policy were writable.

The distinguishing signal was that PostgREST still treated the mutation as an
unknown route. The table had been created after PostgREST built its schema
cache. A SQL `NOTIFY pgrst, 'reload schema'` was added to migrations 051 and
057 for future deployment runs. On the already-running self-hosted instance,
the notification listener did not refresh the cache, so PostgREST received
the supported `SIGUSR1` schema-reload signal:

```bash
docker kill --signal=SIGUSR1 <postgrest-container>
```

This signal reloads metadata without terminating the container or dropping
connections. Afterward, the same deliberately invalid diagnostic POST changed
from `404` to the expected database-level `409` foreign-key response. The
diagnostic ID was checked afterward and had zero persisted rows.

Do not rely only on the OpenAPI document to validate this recovery: on this
self-hosted PostgREST version the table could remain absent from the generated
OpenAPI paths even though the POST route was active. A non-persisting invalid
POST or the real API flow is the stronger verification.

## API failure behavior

Create, update, and delete repository errors are caught in
`app/api/attention_routes.py`, logged with profile/action context, and returned
as a stable 503 detail. This preserves CORS headers and prevents a backend
exception from becoming the misleading browser message `Failed to fetch`.
The list response retains system templates and reports
`personal_templates_available: false` when personal storage cannot be read.

## Verification

- `tests/test_attention_routes.py` covers storage-unavailable fallback,
  personal-template listing, slots-only Save, readable 503 responses, and
  forwarding the caller token when the backend has only the anon key.
- Related Attention suite: 21 passed.
- Focused route suite after the PostgREST recovery: 7 passed.
- Ruff passed for the changed backend and test files.
- CodeGraph was synchronized after the changes.

## Operational checklist

When Attention Template Save reports storage unavailable:

1. Confirm `public.editai_attention_templates` exists and its foreign key
   targets `public.profiles(id)`.
2. Confirm the profile index, table grants, and RLS policy exist.
3. Inspect the backend exception. A PostgREST `404` with an empty `{}` body on
   POST, while GET succeeds, strongly suggests stale mutation metadata.
4. Run the normal additive migration and emit `NOTIFY pgrst, 'reload schema'`.
5. If the self-hosted listener does not reload, send `SIGUSR1` to the PostgREST
   container. Do not disable RLS and do not expose a service-role key in the
   desktop bundle.
6. Verify Save with a real authenticated profile and confirm the resulting row
   remains profile-scoped.
