---
phase: 35-pip-overlay-controls
plan: "01"
subsystem: pip-overlay
tags: [backend, frontend, associations, pip, overlay]
dependency_graph:
  requires: [34-01, 34-02]
  provides: [pip-config-endpoint, pip-overlay-panel, pip-config-type]
  affects: [segments-page, pipeline-page]
tech_stack:
  added: []
  patterns: [pydantic-patch-endpoint, button-group-selector, switch-toggle-panel]
key_files:
  created:
    - frontend/src/components/pip-overlay-panel.tsx
  modified:
    - app/api/association_routes.py
    - frontend/src/components/product-picker-dialog.tsx
decisions:
  - PipConfig interface placed in product-picker-dialog.tsx alongside AssociationResponse for single-source convenience (same pattern as Phase 33)
  - Save button disabled when PiP is off AND config is at defaults, enabled as soon as either condition changes
  - Controls visually muted via opacity-40 + pointer-events-none when PiP disabled (no separate disabled prop threading)
metrics:
  duration: "~10 minutes"
  completed: "2026-02-23"
  tasks_completed: 2
  files_changed: 3
---

# Phase 35 Plan 01: PiP Backend Endpoint and PipOverlayPanel Component Summary

**One-liner:** PATCH pip-config endpoint with PipConfigUpdate Pydantic model plus PipOverlayPanel React component providing enable/position/size/animation controls.

## What Was Built

### Backend: PATCH /associations/{id}/pip-config

Added to `app/api/association_routes.py`:
- `PipConfigUpdate` Pydantic model: `enabled`, `position`, `size`, `animation` fields with defaults
- `PATCH /{association_id}/pip-config` endpoint reusing the same ownership validation pattern as the existing `update_association_images` endpoint
- Updates `pip_config` JSONB column via `body.model_dump()`
- Returns enriched association response (consistent with other PATCH endpoints)

### Frontend: PipConfig Type

Added to `frontend/src/components/product-picker-dialog.tsx`:
- `PipConfig` interface with union types for position/size/animation values
- `DEFAULT_PIP_CONFIG` constant exported for use across components
- `AssociationResponse.pip_config` updated from `Record<string, unknown> | null` to `PipConfig | null`

### Frontend: PipOverlayPanel Component

Created `frontend/src/components/pip-overlay-panel.tsx`:
- Enable toggle (Switch + Layers icon, labeled "PiP Overlay")
- Position selector: 4-button group (TL/TR/BL/BR) using `h-6 text-[10px]` sizing
- Size selector: 3-button group (Small/Medium/Large)
- Animation selector: 3-button group (Static/Fade/Ken Burns)
- Save button: disabled when PiP off and config unchanged from defaults; shows "Saving..." when `isSaving=true`
- Visual muting of controls (opacity-40 + pointer-events-none) when PiP is disabled
- Panel wrapped in `rounded-md border p-2 bg-muted/30` for visual grouping

## Verification Results

- TypeScript: zero errors (`npx tsc --noEmit`)
- Backend import: `from app.api.association_routes import router` — OK
- PipConfig exported from product-picker-dialog.tsx — confirmed
- PATCH /associations/{id}/pip-config route registered — confirmed

## Deviations from Plan

None — plan executed exactly as written.

## Commits

- `f262d37` feat(35-01): add PATCH pip-config endpoint and PipConfig TypeScript type
- `8b42e04` feat(35-01): create PipOverlayPanel component with all four control groups

## Self-Check: PASSED

Files exist:
- frontend/src/components/pip-overlay-panel.tsx: FOUND
- app/api/association_routes.py (pip-config endpoint): FOUND
- frontend/src/components/product-picker-dialog.tsx (PipConfig export): FOUND

Commits exist:
- f262d37: FOUND
- 8b42e04: FOUND
