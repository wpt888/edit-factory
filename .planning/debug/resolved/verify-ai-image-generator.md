---
status: resolved
trigger: "verify-ai-image-generator — completeness/correctness audit of AI Image Generator feature"
created: 2026-03-02T00:00:00Z
updated: 2026-03-02T00:10:00Z
symptoms_prefilled: true
---

## Current Focus

hypothesis: All 4 bugs fixed
test: Code review of changed files
expecting: Confirmed fixes applied correctly
next_action: Human verification that backend starts without errors and frontend renders

## Symptoms

expected: All planned files exist, all endpoints implemented, patterns match existing codebase, imports work, no missing pieces
actual: Implementation was just completed — need to verify everything is correct
errors: Console showed CORS errors for /image-gen/templates (expected since backend wasn't running)
reproduction: Check each file against the plan requirements
started: Just implemented in the current session

## Eliminated

(none — all hypotheses confirmed as bugs, all fixed)

## Evidence

- timestamp: 2026-03-02T00:01:00Z
  checked: All 6 files exist (fal_image_service.py, logo_overlay_service.py, telegram_service.py, image_generate_routes.py, create-image/page.tsx, logo-drag-overlay.tsx)
  found: All files present
  implication: File creation checklist PASS

- timestamp: 2026-03-02T00:01:00Z
  checked: app/main.py imports and router registration
  found: image_generate_router imported and registered at /api/v1 with correct tags
  implication: Router registration PASS

- timestamp: 2026-03-02T00:01:00Z
  checked: requirements.txt for Pillow
  found: Pillow>=10.0.0 present
  implication: Dependency PASS

- timestamp: 2026-03-02T00:01:00Z
  checked: All 13 endpoints in image_generate_routes.py
  found: All 13 present + new GET /logo/file = 14 total
  implication: Endpoint count PASS

- timestamp: 2026-03-02T00:01:00Z
  checked: ProfileContext usage in routes
  found: All endpoints use Depends(get_profile_context)
  implication: Auth pattern PASS

- timestamp: 2026-03-02T00:01:00Z
  checked: fal_image_service.py, logo_overlay_service.py, telegram_service.py
  found: All correct
  implication: Backend services PASS

- timestamp: 2026-03-02T00:01:00Z
  checked: NavBar, LogoDragOverlay component logic, apiDelete/apiPut exports
  found: All correct
  implication: Frontend PASS (component logic)

- timestamp: 2026-03-02T00:02:00Z
  checked: postiz_service.py method names
  found: BUG — publisher.upload_media() does not exist; methods are upload_video() and create_post()
  implication: Fixed — rewrote send_to_postiz with proper 3-step workflow (upload_video → get_integrations → create_post)

- timestamp: 2026-03-02T00:02:00Z
  checked: catalog_products table name
  found: BUG — table "catalog_products" doesn't exist; actual view is "v_catalog_products_grouped"
  implication: Fixed — changed to "v_catalog_products_grouped" at line 182

- timestamp: 2026-03-02T00:02:00Z
  checked: LogoDragOverlay logoUrl prop
  found: BUG — /image-gen/logo returns JSON, not image bytes; no static serving for output/logos/
  implication: Fixed — added GET /logo/file endpoint (FileResponse); updated logoUrl to /image-gen/logo/file

- timestamp: 2026-03-02T00:02:00Z
  checked: SelectItem value="none" for product and template
  found: BUG — "none" string is truthy, passed to backend as product_id="none" instead of undefined
  implication: Fixed — added explicit !== "none" guard in handleGenerate

## Resolution

root_cause: |
  4 bugs found in newly implemented AI Image Generator:
  1. publisher.upload_media() does not exist on PostizPublisher class (AttributeError at runtime)
  2. Table name "catalog_products" wrong; view is "v_catalog_products_grouped"
  3. logoUrl in LogoDragOverlay pointed to JSON endpoint, not image binary — no logo image could render
  4. SelectItem value="none" passed as product_id/template_id string instead of undefined

fix: |
  1. Rewrote send_to_postiz to use proper 3-step Postiz workflow (upload_video → get_integrations → create_post)
  2. Changed table name to "v_catalog_products_grouped"
  3. Added GET /logo/file endpoint (FileResponse); updated logoUrl prop to /image-gen/logo/file
  4. Added !== "none" guard: (selectedProductId && selectedProductId !== "none") ? selectedProductId : undefined

verification: Self-verified via code review. Backend syntax verified by tracing imports. Pattern matches existing routes (postiz_routes.py uses same await publisher.* pattern).

files_changed:
  - app/api/image_generate_routes.py
  - frontend/src/app/create-image/page.tsx
