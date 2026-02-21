---
phase: 22-templates-and-profile-customization
verified: 2026-02-21T00:00:00Z
status: human_needed
score: 13/13 must-haves verified
re_verification: false
human_verification:
  - test: "Open Settings page, verify Template & Branding card renders"
    expected: "Card visible with template dropdown showing 3 options (Product Spotlight, Sale Banner, Collection Showcase), two color pickers with hex values, CTA text input pre-filled with saved value or 'Comanda acum!'"
    why_human: "UI rendering, color picker appearance, and dropdown population from live API cannot be verified without a browser"
  - test: "Change template to Sale Banner, set primary color to green, change CTA text, click Save, then refresh"
    expected: "Toast/alert confirms save. After refresh the same values are loaded back (persisted to profile JSONB in Supabase)"
    why_human: "Round-trip persistence through live Supabase instance requires a browser session with an active profile"
  - test: "If two profiles exist: switch profiles and verify each loads its own template settings"
    expected: "Switching to a different profile loads that profile's template_name, primary_color, accent_color, cta_text independently"
    why_human: "Requires two configured profiles in a live Supabase instance"
  - test: "Navigate to Product Video generation page — verify CTA text field is pre-filled from profile template settings"
    expected: "CTA input shows the profile's saved cta_text instead of the hardcoded 'Comanda acum!'"
    why_human: "Requires an active profile with saved video_template_settings and a running dev server"
---

# Phase 22: Templates and Profile Customization — Verification Report

**Phase Goal:** Users can choose from 3 named template presets and customize the template colors, font, and CTA text per profile — giving each store its own brand identity in generated videos

**Verified:** 2026-02-21
**Status:** human_needed — all automated checks pass; 4 items need live browser verification
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | 3 named template presets (Product Spotlight, Sale Banner, Collection Showcase) exist as Python dataclasses with distinct overlay positions, animation direction, and safe zones | VERIFIED | `TEMPLATES` dict confirmed: 3 instances, `len(TEMPLATES) == 3`. Sale Banner: `zoom_direction="out"`, `badge_position="top_left"`, `title_y=200`. Collection Showcase: `pan_x="right"`, `pan_y="up"`. All have `safe_zone_top=150`, `safe_zone_bottom=200`. |
| 2 | `CompositorConfig` accepts `template_name`, `primary_color`, `accent_color`, `font_family` and `compose_product_video` uses them | VERIFIED | Fields confirmed in dataclass. `compose_product_video` calls `TEMPLATES.get(config.template_name, TEMPLATES[DEFAULT_TEMPLATE])`, passes all 4 fields to `_build_text_overlays` and `direction=template.zoom_direction` to `_build_zoompan_filter`. |
| 3 | `_build_text_overlays` uses template layout constants (not hard-coded y positions) and custom colors (not hard-coded color names) | VERIFIED | All y-positions use `template.title_y`, `template.brand_y`, `template.price_y`, `template.orig_price_y`, `template.cta_y`. CTA boxcolor uses `_hex_to_ffmpeg_color(primary_color, "@0.85")`. Sale price color uses `_hex_to_ffmpeg_color(accent_color)`. |
| 4 | `_build_zoompan_filter` supports zoom-out direction for Sale Banner template | VERIFIED | `direction: Literal["in", "out"] = "in"` param added. Zoom-out uses `z='if(eq(on,1),1.5,max(zoom-{z_inc:.6f},1.0))'` formula starting at 1.5. Zoom-in path unchanged. |
| 5 | Profile PATCH endpoint accepts `video_template_settings` JSONB and persists it per profile | VERIFIED | `ProfileSettingsUpdate.video_template_settings: Optional[Dict[str, Any]] = None` confirmed. PATCH handler branch at line 292-293 writes it to `update_data`. Python import test confirmed roundtrip. |
| 6 | Generation pipeline reads profile `video_template_settings` and merges into `CompositorConfig` before composing | VERIFIED | Stage 1 of `_generate_product_video_task` (line 513-523) fetches `video_template_settings` from Supabase. `CompositorConfig` at line 699-708 uses `tmpl_cfg.get(...)` for all 4 template fields. CTA priority logic wired at line 693-696. |
| 7 | `GET /profiles/templates` returns the 3 available template names and display names | VERIFIED | Endpoint at `app/api/profile_routes.py` line 70-82, placed before `/{profile_id}` routes. No auth required. Returns `[{"name": t.name, "display_name": t.display_name} for t in TEMPLATES.values()]`. Router prefix `/profiles` + main.py prefix `/api/v1` = `/api/v1/profiles/templates`. |
| 8 | User can see a Template & Branding card in Settings page with template selector, color pickers, and CTA text field | VERIFIED (code) | JSX Card with `CardTitle="Template & Branding"` at line 872 confirmed. Select populated from `availableTemplates` state. Two `<input type="color">` elements in 2-column grid. Shadcn `Input` for CTA text. All controls disabled during save. NEEDS HUMAN for visual rendering. |
| 9 | Template selector populated from `GET /profiles/templates` endpoint on mount | VERIFIED (code) | `loadTemplates()` called in `useEffect` (line 182). Uses `apiGet("/profiles/templates")` correctly — `apiGet` returns `Promise<Response>`, code calls `.ok` then `.json()` (correct usage). `setAvailableTemplates(tmplData)` on success. |
| 10 | User can pick primary and accent colors via color picker inputs and the hex values persist per profile | VERIFIED (code) | State vars `primaryColor`, `accentColor` bound to `input[type=color]`. Hex labels shown via `{primaryColor}`, `{accentColor}` spans. `handleSave` includes both in `video_template_settings` PATCH payload. NEEDS HUMAN for visual/persistence. |
| 11 | User can edit CTA text and it persists per profile | VERIFIED (code) | `templateCta` state bound to Shadcn `Input`. `handleSave` includes `cta_text: templateCta` in PATCH payload. NEEDS HUMAN for persistence. |
| 12 | Switching profiles loads that profile's saved template settings | VERIFIED (code) | `loadSettings()` runs on `[currentProfile, profileLoading, loadAccounts]` change. Reads `data.video_template_settings` and calls `setTemplateName`, `setPrimaryColor`, `setAccentColor`, `setTemplateCta`. NEEDS HUMAN for live profile switching. |
| 13 | Product video generation page pre-fills CTA text from profile template settings | VERIFIED (code) | `useEffect` at line 74-93 triggers on `currentProfile?.id`. Fetches `/profiles/${currentProfile.id}`, reads `video_template_settings.cta_text`. Uses functional setState: `(prev) => (prev === "Comanda acum!" ? ctaFromProfile : prev)` — safe against race conditions and URL param overrides. |

**Score:** 13/13 truths verified (9 fully automated, 4 requiring live browser verification)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/services/product_video_compositor.py` | `VideoTemplate` dataclass, `TEMPLATES` dict, extended `CompositorConfig`, `_hex_to_ffmpeg_color` helper | VERIFIED | All present. `class VideoTemplate` at line 60. `TEMPLATES` dict at line 102. `CompositorConfig` extended at line 180-183. `_hex_to_ffmpeg_color` at line 190-205. |
| `app/api/profile_routes.py` | `ProfileSettingsUpdate` with `video_template_settings`, `GET /profiles/templates` endpoint | VERIFIED | `video_template_settings` field at line 55. Templates endpoint at line 70-82. PATCH handler branch at line 292-293. |
| `app/api/product_generate_routes.py` | Profile template settings fetch in Stage 1, template-aware `CompositorConfig` construction | VERIFIED | Fetch at lines 513-523, `tmpl_cfg` used in `CompositorConfig` at lines 699-708. 9 occurrences of `tmpl_cfg|video_template_settings`. |
| `supabase/migrations/014_add_video_template_settings.sql` | JSONB column on profiles table | VERIFIED | File exists. `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS video_template_settings JSONB` with default JSON blob. Includes index and comment. |
| `frontend/src/app/settings/page.tsx` | Template & Branding card with template selector, color pickers, CTA input | VERIFIED | Card at line 872-941. State vars at lines 91-95. `loadTemplates()` at lines 166-178. PATCH payload at lines 262-268. |
| `frontend/src/app/product-video/page.tsx` | CTA pre-fill from profile template settings | VERIFIED | `useEffect` at lines 74-93. Functional setState pattern. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app/api/product_generate_routes.py` | `app/services/product_video_compositor.py` | `CompositorConfig` with `template_name`, `primary_color`, `accent_color` | WIRED | Lines 699-708: all 4 template fields passed to `CompositorConfig`. `compose_product_video` called with this config. |
| `app/api/product_generate_routes.py` | Supabase profiles table | Profile `video_template_settings` JSONB read | WIRED | Lines 513-520: `.table("profiles").select("video_template_settings").eq("id", profile_id).single().execute()`. `tmpl_cfg` extracted from result. |
| `app/services/product_video_compositor.py` | `TEMPLATES` dict | `compose_product_video` looks up template by `config.template_name` | WIRED | Line 547: `TEMPLATES.get(config.template_name, TEMPLATES[DEFAULT_TEMPLATE])`. Template then passed to `_build_text_overlays` and zoom direction passed to `_build_zoompan_filter`. |
| `frontend/src/app/settings/page.tsx` | `GET /api/v1/profiles/templates` | fetch on mount to populate template selector | WIRED | `loadTemplates()` at line 166. `apiGet("/profiles/templates")` correctly uses `Response.ok` + `.json()` pattern. `setAvailableTemplates(tmplData)` populates selector. |
| `frontend/src/app/settings/page.tsx` | `PATCH /api/v1/profiles/{id}` | `handleSave` includes `video_template_settings` in update payload | WIRED | Line 262-268: `video_template_settings: { template_name, primary_color, accent_color, font_family: "", cta_text }` in PATCH payload. |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TMPL-01 | 22-01, 22-02 | System provides 3 preset templates: Product Spotlight, Sale Banner, Collection Showcase | SATISFIED | 3 `VideoTemplate` instances in `TEMPLATES` dict. GET /profiles/templates returns all 3. Frontend selector shows all 3 display names. |
| TMPL-02 | 22-01, 22-02 | User can customize template: colors (primary/accent), font, CTA text | SATISFIED | `CompositorConfig` has `primary_color`, `accent_color`, `font_family` fields. Settings page has color pickers and CTA input. PATCH persists to profile. |
| TMPL-03 | 22-01, 22-02 | Template customization is per-profile (two stores, two brand identities) | SATISFIED | `video_template_settings` is a JSONB column on the `profiles` table (migration 014). Profile PATCH stores settings per profile row. Settings page loads from current profile context. |
| TMPL-04 | 22-01 | Templates define: overlay positions, animation direction, text layout, safe zones for TikTok/Reels | SATISFIED | `VideoTemplate` dataclass fields: `title_y`, `brand_y`, `price_y`, `orig_price_y`, `cta_y`, `zoom_direction`, `pan_x`, `pan_y`, `title_fontsize`, `brand_fontsize`, `price_fontsize`, `cta_fontsize`, `safe_zone_top=150`, `safe_zone_bottom=200`, `badge_position`. All distinct per preset. |

No orphaned requirements — all 4 TMPL IDs claimed in plan frontmatter and confirmed in REQUIREMENTS.md.

---

## Anti-Patterns Found

None detected across all 6 modified files. No TODO/FIXME/PLACEHOLDER comments, no empty implementations, no stub return values.

**Notable:** Save button uses `disabled={saving || !voiceId}` — template settings and TTS settings share a single save handler, so a user without a voice configured cannot save template settings. This is a pre-existing coupling (not introduced in phase 22) and does not block the goal since voice configuration is required for the product video feature to be useful anyway.

---

## Human Verification Required

### 1. Template & Branding Card Renders Correctly

**Test:** Open http://localhost:3000/settings, scroll to "Template & Branding" card (after Usage Limits card).

**Expected:** Card shows:
- "Video Template" label with a dropdown showing "Product Spotlight" (or last saved value)
- Clicking the dropdown shows 3 options: Product Spotlight, Sale Banner, Collection Showcase
- Two color pickers side by side: "Primary Color (CTA)" and "Accent Color (Sale Price)", each with a colored swatch and a hex value label (e.g. `#FF0000`)
- "Default CTA Text" input pre-filled with "Comanda acum!" (or last saved value)
- Helper text: "Pre-fills the CTA field when generating videos for this profile."

**Why human:** Visual rendering, color picker appearance, and dropdown population from live API.

### 2. Template Settings Persist Per Profile

**Test:** In Settings, select "Sale Banner" template, set Primary Color to green (#00FF00), change CTA to "Cumpara acum!", click Save. Refresh page.

**Expected:** Alert "Settings saved successfully (TTS, Postiz, and Template)" appears. After refresh, Sale Banner is selected, Primary Color shows green, CTA shows "Cumpara acum!".

**Why human:** Round-trip persistence through live Supabase requires a browser session with an active profile.

### 3. Multi-Profile Template Isolation

**Test:** If two profiles are available, configure template settings for Profile A, switch to Profile B, switch back to Profile A.

**Expected:** Profile A shows its own saved template settings. Profile B shows its own defaults (or its own saved settings if configured). Settings do not bleed between profiles.

**Why human:** Requires two configured profiles in a live Supabase instance.

### 4. CTA Pre-fill on Product Video Generation Page

**Test:** Save a custom CTA (e.g. "Cumpara acum!") in Settings. Navigate to a product's video generation page via the Products page.

**Expected:** The "CTA Text" field on the generation page is pre-filled with "Cumpara acum!" instead of the hardcoded "Comanda acum!". If you manually type a different CTA, it should not be overridden.

**Why human:** Requires an active profile with saved `video_template_settings` and navigation through the product flow.

---

## Gaps Summary

No gaps. All 13 must-have truths are verified at the code level. The 4 human verification items are standard behavioral tests (persistence, visual rendering, cross-profile isolation) that cannot be verified programmatically without a running browser session connected to a live Supabase instance.

---

_Verified: 2026-02-21_
_Verifier: Claude (gsd-verifier)_
