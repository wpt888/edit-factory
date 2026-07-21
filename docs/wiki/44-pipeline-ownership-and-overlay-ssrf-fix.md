# Route ownership model + overlay-downloader SSRF fix (EF-1)

Closes the cross-tenant (IDOR) and SSRF holes documented in
`goals/audit-2026-07-21-findings.md` §1, §2, §8. Goal spec:
`goals/01-security-idor.md`.

## The bug

`Depends(get_profile_context)` only proves *who is calling* — it does not
prove the caller *owns the resource in the URL*. Several routes accepted a
`pipeline_id` / `job_id` from the path or body and used it directly against
`_pipelines` / job stores without ever comparing it to the caller's
`profile_id`. Anyone who learned a UUID (visible in the pipeline URL,
`frontend/src/app/pipeline/page.tsx`) could read or mutate another profile's
pipeline, watch another profile's render/publish progress, or steer another
profile's local render runner. Separately, the PiP/interstitial/attention
overlay downloader in `overlay_renderer.py` accepted **any** URL or local
path handed to it, including `file://`, followed redirects, and buffered
without a size limit — a classic SSRF + arbitrary local file read, with
failures swallowed silently so the render still reported success.

## The fix: ownership, not just authentication

### Pipeline routes (`app/api/pipeline_routes.py`)

Every route that references a `pipeline_id` now goes through:

```python
def _require_owned_pipeline(pipeline_id: str, profile_id: str) -> dict:
    pipeline = ...  # in-memory _pipelines, falling back to the DB
    if pipeline is None:
        raise HTTPException(404)
    if pipeline.get("profile_id") != profile_id:
        raise HTTPException(403)
    return pipeline
```

`test_pipeline_routes_that_reference_pipeline_ids_require_profile_auth`
(in `tests/test_pipeline_idor.py`) asserts, by introspecting
`pipeline_routes.router.routes`, that **no** route with `pipeline_id` in its
path is missing a dependency — so a new route added without
`Depends(get_profile_context)` fails CI instead of shipping unauthenticated.
The DELETE route's in-memory fallback (when the repository is unavailable)
is guarded the same way, so it can't be used to bypass ownership.

### Progress stores (Assembly, Buffer, Postiz, Blipost Platform, image-gen)

Job progress dicts and the DB/JobStorage fallback now carry `profile_id`
alongside the job. Readers (`GET .../progress`, `GET /assembly/status/{id}`)
compare the caller's profile to the stored owner and return `404`/`not_found`
— not `403` — so the response doesn't even confirm the job exists for
another tenant. Assembly's status response no longer includes
`final_video_path` for a caller who isn't the owner.

### Local render runner (`blipost_runner.py`, `blipost_render_routes.py`)

The runner is a process-wide singleton, so ownership is enforced at the API
boundary instead of per-instance:

```python
def _require_runner_owner(profile_id: str):
    runner = get_render_runner()
    if runner.profile_id is not None and runner.profile_id != profile_id:
        raise HTTPException(403, "Render runner belongs to another profile")
    return runner
```

`pair` / `unpair` / `start` / `stop` / `status` all resolve the runner
through this guard. A legitimate profile switch (previous owner unpaired,
new profile starts the runner) resets `processed` / `current_job` /
`last_error` so the new owner never sees the previous tenant's job history.

### Overlay downloader (`app/services/video_effects/overlay_renderer.py`)

`_download_image()` now classifies every source before touching the network
or filesystem:

- `file://` and any scheme other than `http`/`https` (except a bare local
  path) → rejected.
- Local paths must resolve (after `expanduser().resolve()`) inside one of
  the application-managed directories (`assets/`, `uploads/`, `input/`,
  `media/`, `output/`, `temp/`, plus configured `input_dir` / `media_dir` /
  `output_dir` / `temp_dir`) — no arbitrary filesystem read.
- Remote URLs must be `http`/`https`, carry no embedded credentials, and
  have a hostname on the allowlist — currently just the configured Supabase
  storage host (`_allowed_remote_hosts()`). A different CDN/storage host
  needs an explicit allowlist addition, by design.
- Redirects are disabled (`follow_redirects=False`).
- The streamed download is capped at `MAX_OVERLAY_DOWNLOAD_BYTES` (25 MiB),
  checked against both `Content-Length` and the running byte count.
- Every rejection raises `OverlaySourceError` instead of returning `None`,
  so the failure is visible to the caller instead of the effect being
  silently dropped while the render reports success.

Known gap (not part of this goal): the PiP overlay call site in
`assembly_service.py` (`apply_pip_overlay`, around line 2593) still wraps
the call in a broad `try/except Exception: logger.warning(...)` and
continues the render — so a rejected PiP source is *visible in logs* but
not surfaced to the user-facing render status the way §2 of the audit
implies. `apply_attention_timeline` (the front-cue image/video overlay
path actually used by the pipeline) has no such catch, so its
`OverlaySourceError` propagates up through `assemble_and_render` into the
job's normal failure handling.

## Auth-disabled dev mode

`AUTH_DISABLED=true` still returns the hardcoded dev profile from
`get_profile_context` — but every route downstream still calls
`_require_owned_pipeline` / the runner guard with that profile's id, so
ownership checks are exercised in dev too, not bypassed.

## Tests

- `tests/test_pipeline_idor.py` — profile B 403/404 on every pipeline_id
  route (status, scripts, preview-status, rename, selected-captions,
  delete), the router-wide "every pipeline_id route has a dependency"
  assertion, and the in-memory delete-fallback guard.
- `tests/test_progress_route_ownership.py` — buffer/postiz/platform
  progress return `not_found` for a non-owner, assembly status 404s and
  hides `final_video_path`, and the runner guard 403s a cross-profile
  control call.
- `tests/test_overlay_renderer_security.py` — `file://` rejection, path
  traversal outside allowed roots, accepting an in-root file, non-allowlisted
  host rejection, oversized-response rejection, and that `apply_pip_overlay`
  propagates `OverlaySourceError` instead of swallowing it.

Full relevant suite (`test_attention_routes`, the three new files, plus the
pipeline/render/runner suites already touching these code paths):
**74 passed, 2 skipped, 1 xfailed**. Full `tests/` run: **803 passed, 12
skipped, 18 xfailed, 1 failed** — the one failure
(`test_source_media_session.py::test_hosted_media_cookie_is_secure_and_authenticates_remote_request`)
is pre-existing on `main`, unrelated to this change (neither the test nor
`segments_routes.py` is touched by this goal), and was left as-is.
