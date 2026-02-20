# Phase 22: Templates and Profile Customization - Research

**Researched:** 2026-02-21
**Domain:** FFmpeg overlay composition, Supabase JSONB profile settings, React settings UI
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TMPL-01 | System provides 3 preset templates: Product Spotlight, Sale Banner, Collection Showcase | Pure Python dataclass — no new library needed. Template definitions live in product_video_compositor.py as a new `VideoTemplate` dataclass. CompositorConfig gains a `template` field. |
| TMPL-02 | User can customize template: colors (primary/accent), font, CTA text | JSONB column `video_template_settings` added to `profiles` table (same pattern as `tts_settings`). Backend reads profile settings and merges into CompositorConfig before composing. |
| TMPL-03 | Template customization is per-profile (two stores, two brand identities) | Profile-scoped JSONB field — same persistence pattern already used for `tts_settings`. Settings page gains new "Template" card; PATCH /profiles/{id} already supports arbitrary JSONB fields. |
| TMPL-04 | Templates define: overlay positions, animation direction, text layout, safe zones for TikTok/Reels | `VideoTemplate` dataclass encodes all layout constants. Safe zones already partially exist (y=160 top, y=1820 CTA bottom). Must be formalized as per-template safe_zone_top / safe_zone_bottom constants. |
</phase_requirements>

---

## Summary

Phase 22 adds named template presets and per-profile visual customization to the product video pipeline. The work is entirely additive — it extends the existing `product_video_compositor.py` service and the profiles JSONB settings pattern rather than replacing anything.

The core engine (`compose_product_video`) already hard-codes a single layout in `_build_text_overlays`. Phase 22 extracts those layout constants into three named `VideoTemplate` dataclasses (Product Spotlight, Sale Banner, Collection Showcase), adds color/font customization fields to `CompositorConfig`, and wires the profile's saved template settings into the generation pipeline. On the frontend, a new "Template" settings card on the Settings page lets users choose a preset and customize it; the choice is persisted per-profile via the existing `PATCH /profiles/{id}` endpoint.

**Primary recommendation:** Store template settings in a new `video_template_settings` JSONB column on the `profiles` table (migration 014). Use the same pattern as `tts_settings` — a JSONB dict read by the backend at generation time and merged into `CompositorConfig`. No new router is needed for template CRUD; the existing profile PATCH endpoint handles it. All three templates MUST define `safe_zone_top` and `safe_zone_bottom` constants to prevent overlay collision with TikTok/Reels UI chrome.

---

## Standard Stack

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| Python dataclass | stdlib | `VideoTemplate` preset definitions | Zero deps, type-safe, already used throughout services |
| Supabase JSONB column | existing | Per-profile template settings storage | Already the pattern for `tts_settings` — no new tables |
| FastAPI PATCH endpoint | existing | Save/load template settings | `PATCH /profiles/{id}` with `ProfileSettingsUpdate` already supports arbitrary JSONB |
| React + Shadcn/UI | existing | Template selector + color picker UI | Already the frontend stack; `Select`, `Input`, `Card` components in use |

### Supporting
| Component | Version | Purpose | When to Use |
|-----------|---------|---------|-------------|
| FFmpeg `drawtext fontfile=` | system FFmpeg | Custom font per template | Only if bundling fonts — fall back to FFmpeg default if font file not present |
| HTML `<input type="color">` | browser native | Color picker for primary/accent | No extra dependency; Shadcn/UI does not ship a color picker component |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSONB in profiles | Separate `profile_templates` table | Table adds FK join on every generation call; JSONB is simpler and `tts_settings` proves the pattern |
| Static Python dataclass | DB-driven templates | DB-driven would allow user-created templates (out of scope per REQUIREMENTS.md); dataclass is right size |
| `input type="color"` | react-color library | Library adds 50KB bundle; native color input is sufficient for 2 color fields |

**Installation:** No new npm or pip packages required.

---

## Architecture Patterns

### Recommended Project Structure

```
app/services/
├── product_video_compositor.py    # ADD: VideoTemplate dataclass + 3 preset instances
│                                  # MODIFY: CompositorConfig gains template + customization fields
│                                  # MODIFY: _build_text_overlays accepts template config
└── (no new files needed)

app/api/
└── profile_routes.py              # MODIFY: ProfileSettingsUpdate gains video_template_settings field

supabase/migrations/
└── 014_add_video_template_settings.sql   # ADD: new migration

frontend/src/app/settings/
└── page.tsx                       # MODIFY: add Template Customization card
```

### Pattern 1: VideoTemplate Dataclass (Backend)

**What:** A dataclass that encodes all layout constants for one named template preset.
**When to use:** Exactly 3 instances — one per named preset. No inheritance needed.

```python
# In app/services/product_video_compositor.py
from dataclasses import dataclass, field
from typing import Literal

TemplateName = Literal["product_spotlight", "sale_banner", "collection_showcase"]

@dataclass
class VideoTemplate:
    """Layout and animation constants for a named template preset.

    All y-coordinates are for 1080x1920 portrait video.
    Safe zones prevent overlay collision with TikTok/Reels UI chrome:
      - TikTok UI chrome: top ~80px, bottom ~160px
      - Reels UI chrome: top ~80px, bottom ~200px
      - Recommended safe zones: top 150px, bottom 200px
    """
    name: TemplateName
    display_name: str

    # Animation direction
    zoom_direction: Literal["in", "out"] = "in"  # in=zoom in, out=zoom out
    pan_x: Literal["left", "right", "center"] = "center"
    pan_y: Literal["up", "down", "center"] = "center"

    # Text layout — y positions for 1920px height
    title_y: int = 160
    brand_y: int = 230
    price_y: int = 1650
    orig_price_y: int = 1720
    cta_y: int = 1820

    # Font sizes
    title_fontsize: int = 48
    brand_fontsize: int = 32
    price_fontsize: int = 56
    cta_fontsize: int = 44

    # Safe zones (pixels from edge)
    safe_zone_top: int = 150      # No overlays above this y
    safe_zone_bottom: int = 200   # No overlays within this many px of bottom (1920-200=1720)

    # Badge / accent overlay behavior
    badge_position: Literal["top_right", "top_left", "bottom_right"] = "top_right"


# The 3 preset instances
TEMPLATES: dict[TemplateName, VideoTemplate] = {
    "product_spotlight": VideoTemplate(
        name="product_spotlight",
        display_name="Product Spotlight",
        zoom_direction="in",
        pan_x="center",
        pan_y="center",
        title_y=160,
        brand_y=230,
        price_y=1650,
        orig_price_y=1720,
        cta_y=1820,
        badge_position="top_right",
    ),
    "sale_banner": VideoTemplate(
        name="sale_banner",
        display_name="Sale Banner",
        zoom_direction="out",          # reverse zoom for variety
        pan_x="left",
        pan_y="center",
        title_y=200,                   # pushed down slightly for badge prominence
        brand_y=270,
        price_y=1600,
        orig_price_y=1670,
        cta_y=1820,
        badge_position="top_left",     # badge on left for this template
    ),
    "collection_showcase": VideoTemplate(
        name="collection_showcase",
        display_name="Collection Showcase",
        zoom_direction="in",
        pan_x="right",
        pan_y="up",
        title_y=160,
        brand_y=240,
        price_y=1680,
        orig_price_y=1750,
        cta_y=1820,
        badge_position="top_right",
    ),
}

DEFAULT_TEMPLATE: TemplateName = "product_spotlight"
```

### Pattern 2: Extended CompositorConfig

**What:** Add template-driven fields to the existing `CompositorConfig` dataclass.
**When to use:** All new customization passes through here — keeps the compositor interface clean.

```python
@dataclass
class CompositorConfig:
    """Configuration for product video composition."""
    duration_s: int = 30
    cta_text: str = "Comanda acum!"
    fps: int = 25
    use_zoompan: bool = True
    output_dir: Path = field(default_factory=lambda: Path("output/product_videos"))

    # NEW in Phase 22
    template_name: TemplateName = "product_spotlight"
    primary_color: str = "red"        # FFmpeg color string for CTA box + accents
    accent_color: str = "yellow"      # FFmpeg color string for sale price
    font_family: str = ""             # Path to .ttf file; empty = FFmpeg default
```

### Pattern 3: Profile JSONB settings (video_template_settings)

**What:** Store chosen template + customization in `profiles.video_template_settings` JSONB column. Same shape as `tts_settings`.
**When to use:** Every generation call reads this column to build `CompositorConfig`.

```python
# Shape of video_template_settings JSONB (stored in profiles table):
{
    "template_name": "product_spotlight",   # TemplateName literal
    "primary_color": "red",                 # FFmpeg color string
    "accent_color": "yellow",               # FFmpeg color string
    "font_family": "",                      # font file path or empty for default
    "cta_text": "Comanda acum!"             # CTA override per profile
}
```

```python
# In product_generate_routes.py _generate_product_video_task — Stage 1:
# After fetching product, read profile template settings
profile_result = supabase.table("profiles")\
    .select("video_template_settings")\
    .eq("id", profile_id)\
    .single()\
    .execute()

tmpl_cfg = profile_result.data.get("video_template_settings") or {}

compositor_config = CompositorConfig(
    duration_s=request.duration_s,
    cta_text=tmpl_cfg.get("cta_text") or request.cta_text,
    fps=25,
    use_zoompan=True,
    output_dir=settings.output_dir / "product_videos",
    template_name=tmpl_cfg.get("template_name", "product_spotlight"),
    primary_color=tmpl_cfg.get("primary_color", "red"),
    accent_color=tmpl_cfg.get("accent_color", "yellow"),
    font_family=tmpl_cfg.get("font_family", ""),
)
```

### Pattern 4: Template-aware `_build_text_overlays`

**What:** `_build_text_overlays` currently hard-codes positions and colors. It must accept a `VideoTemplate` + customization colors.
**When to use:** Replace current signature; internal callers already pass through `CompositorConfig`.

```python
def _build_text_overlays(
    product: dict,
    cta_text: str,
    template: VideoTemplate,        # NEW
    primary_color: str = "red",     # NEW: CTA box + sale badge color
    accent_color: str = "yellow",   # NEW: sale price text color
    font_family: str = "",          # NEW: optional font path
) -> tuple[bool, str, list[str]]:
    ...
    # Use template.title_y instead of hard-coded 160
    # Use template.cta_y instead of hard-coded 1820
    # Use primary_color for CTA boxcolor
    # Use accent_color for sale price fontcolor
    # Use template.badge_position to place badge
    # Pass font_family to build_drawtext_filter if non-empty
```

### Pattern 5: Database migration (migration 014)

**What:** Add `video_template_settings` JSONB column to profiles. Same migration pattern as 006.

```sql
-- Migration 014: Add video_template_settings to profiles
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS video_template_settings JSONB DEFAULT '{
  "template_name": "product_spotlight",
  "primary_color": "red",
  "accent_color": "yellow",
  "font_family": "",
  "cta_text": "Comanda acum!"
}'::JSONB;

COMMENT ON COLUMN profiles.video_template_settings IS
  'Per-profile video template preset and customization (template_name, colors, font, CTA)';
```

### Pattern 6: Backend ProfileSettingsUpdate model extension

**What:** `ProfileSettingsUpdate` in `profile_routes.py` needs a new optional field.

```python
class ProfileSettingsUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tts_settings: Optional[Dict[str, Any]] = None
    monthly_quota_usd: Optional[float] = None
    video_template_settings: Optional[Dict[str, Any]] = None  # NEW
```

And the PATCH handler already iterates non-None fields — just add the elif branch:

```python
if updates.video_template_settings is not None:
    update_data["video_template_settings"] = updates.video_template_settings
```

### Pattern 7: New `/profiles/templates` endpoint (READ ONLY)

**What:** Frontend needs to enumerate valid template names and their display metadata.
**When to use:** Lets the UI populate the template selector without hard-coding names in TSX.

```python
@router.get("/templates")
async def list_templates():
    """Return the 3 available video template presets."""
    from app.services.product_video_compositor import TEMPLATES
    return [
        {"name": t.name, "display_name": t.display_name}
        for t in TEMPLATES.values()
    ]
```

This is lightweight enough to be on the profiles router (prefix `/profiles/templates`) — no auth needed since it's read-only public metadata.

### Pattern 8: Frontend Settings page addition

**What:** New "Template & Branding" card below the existing cards in Settings page.
**When to use:** Profile is selected; user can choose template and customize colors/CTA.

```tsx
// State additions to settings/page.tsx
const [templateName, setTemplateName] = useState<string>("product_spotlight")
const [primaryColor, setPrimaryColor] = useState<string>("#FF0000")
const [accentColor, setAccentColor] = useState<string>("#FFFF00")
const [templateCta, setTemplateCta] = useState<string>("Comanda acum!")
const [availableTemplates, setAvailableTemplates] = useState<{name: string, display_name: string}[]>([])

// Load template settings from profile (in existing loadSettings async function):
const videoSettings = data.video_template_settings || {}
setTemplateName(videoSettings.template_name || "product_spotlight")
setPrimaryColor(videoSettings.primary_color || "#FF0000")
setAccentColor(videoSettings.accent_color || "#FFFF00")
setTemplateCta(videoSettings.cta_text || "Comanda acum!")

// In handleSave, add to updates:
updates.video_template_settings = {
  template_name: templateName,
  primary_color: primaryColor,
  accent_color: accentColor,
  font_family: "",  // Phase 22: no font upload UI; keep as empty
  cta_text: templateCta,
}
```

Color picker: use `<input type="color">` styled with Tailwind classes. FFmpeg needs a hex color string — pass the value directly (e.g., `"#FF0000"`). FFmpeg drawtext accepts hex colors in `0xRRGGBB` format, NOT `#RRGGBB`. **Color conversion is required:** strip the `#` prefix and prepend `0x`.

```python
# In product_video_compositor.py
def _hex_to_ffmpeg_color(hex_color: str, opacity: float = 1.0) -> str:
    """Convert '#FF0000' to 'red@0.85' fallback or '0xFF0000@0.85' for FFmpeg."""
    if not hex_color or not hex_color.startswith("#"):
        return hex_color  # already an FFmpeg color name like 'red'
    ffmpeg_hex = "0x" + hex_color.lstrip("#").upper()
    if opacity < 1.0:
        return f"{ffmpeg_hex}@{opacity}"
    return ffmpeg_hex
```

### Anti-Patterns to Avoid

- **Hard-coding template colors inside `_build_text_overlays`**: After Phase 22, all color values must come from `CompositorConfig` fields, never from inline string literals.
- **Adding font files to the repository**: Do not bundle `.ttf` files. Phase 22 uses FFmpeg's default font for `font_family=""`. Font file upload is a v6+ feature.
- **Creating a new `/templates` CRUD router**: The 3 templates are static code, not DB rows. A simple GET endpoint on the profiles router is sufficient.
- **Storing `primary_color` as FFmpeg syntax in the DB**: Store as standard CSS hex (`#FF0000`). Convert to FFmpeg syntax (`0xFF0000`) only at composition time.
- **Changing the `BatchGenerateRequest` model**: Per Phase 21 decision, batch uses uniform settings. Template settings are read from the profile automatically — no batch-level override.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Color picker component | Custom React color wheel | `<input type="color">` native | 2 fields only; native input is sufficient |
| Template storage | New `templates` table with FK | JSONB in `profiles` | The `tts_settings` pattern already works; no extra join |
| Font embedding | Download + bundle font files | FFmpeg default font | Phase 22 scope; font path is blank string |
| Animation config | Dynamic FFmpeg filter builder | Static template constants → existing `_build_zoompan_filter` | Current zoompan is zoom-in only; `zoom_direction="out"` = reverse z_inc sign |

**Key insight:** The hard work (FFmpeg zoompan, drawtext, textfile= pattern) is already done. Phase 22 is parameterization, not new engineering.

---

## Common Pitfalls

### Pitfall 1: FFmpeg hex color format

**What goes wrong:** CSS color `#FF0000` passed directly to FFmpeg drawtext `fontcolor=` or `boxcolor=` — FFmpeg silently ignores it and renders black text.
**Why it happens:** FFmpeg uses `0xRRGGBB` or `0xRRGGBBAA` format, not `#RRGGBB`.
**How to avoid:** Add `_hex_to_ffmpeg_color()` helper (see Code Examples). Call it on `primary_color` and `accent_color` before building any drawtext filter.
**Warning signs:** Overlays render with no visible text or black boxes.

### Pitfall 2: Safe zone violation at CTA position

**What goes wrong:** CTA at y=1820 on a 1920px frame = 100px from bottom. TikTok UI chrome occupies the bottom ~160px. The CTA gets covered by the "like/comment/share" buttons.
**Why it happens:** Current implementation uses y=1820 which is INSIDE TikTok's UI zone.
**How to avoid:** Each template must set `cta_y` to at most `1920 - safe_zone_bottom - cta_fontsize - boxborderw`. For `safe_zone_bottom=200` and `cta_fontsize=44`: max_cta_y = 1920 - 200 - 44 - 12 = 1664. The current y=1820 is wrong per the spec. Phase 22 must fix this as part of the safe zone requirement (TMPL-04).
**Warning signs:** CTA text invisible on phone; check by watching on actual TikTok/Reels.

### Pitfall 3: Zoom-out animation for Sale Banner template

**What goes wrong:** Current `_build_zoompan_filter` only zooms IN (z starts at 1.0, increments toward 1.5). Sale Banner template has `zoom_direction="out"`.
**Why it happens:** The current formula `z='min(zoom+{z_inc},{z_end})'` is directional.
**How to avoid:** For zoom-out, start at z=1.5 and decrement: `z='max(zoom-{z_inc},{1.0})'`. Build a second branch in `_build_zoompan_filter` that accepts `direction: Literal["in", "out"]`.
**Warning signs:** Sale Banner video looks identical to Product Spotlight (both zoom in).

### Pitfall 4: Badge position per template

**What goes wrong:** Sale Banner uses `badge_position="top_left"` but `ensure_sale_badge()` and the `filter_complex` overlay are hard-coded to `x=W-w-20:y=20` (top-right).
**Why it happens:** Badge position is not currently parameterized.
**How to avoid:** Map `badge_position` → FFmpeg overlay expression:
- `"top_right"`: `x=W-w-20:y=20`
- `"top_left"`: `x=20:y=20`
- `"bottom_right"`: `x=W-w-20:y=H-h-20`
Pass the selected expression into `filter_complex`.
**Warning signs:** Badge appears in wrong corner on Sale Banner template.

### Pitfall 5: Batch generation ignores template settings

**What goes wrong:** `BatchGenerateRequest` is constructed directly from request fields in `_batch_generate_task`. If template settings are read from profile in Stage 1 of `_generate_product_video_task`, they will be loaded per-product but the profile_id must be passed correctly.
**Why it happens:** Not a bug — profile_id IS passed to `_generate_product_video_task`. But the profile Supabase query in Stage 1 must be added (currently only product data is fetched in Stage 1).
**How to avoid:** Add the profile template settings fetch in Stage 1 of `_generate_product_video_task`, before building `CompositorConfig`.

### Pitfall 6: `request.cta_text` vs profile `cta_text`

**What goes wrong:** `ProductGenerateRequest` has a `cta_text` field. Profile has `video_template_settings.cta_text`. Which wins?
**Why it happens:** Two sources of CTA text.
**How to avoid:** Define clear priority: profile template setting overrides request default IF profile setting is non-empty. If user explicitly passes a non-default `cta_text` in the request, it should win. But since the product-video page currently shows the request CTA field, keep request as override; profile as default. Logic: `cta_text = request.cta_text if request.cta_text != "Comanda acum!" else (tmpl_cfg.get("cta_text") or request.cta_text)`. Simpler: profile always provides the default that pre-fills the form on load.

---

## Code Examples

### `_build_zoompan_filter` extension for zoom direction

```python
def _build_zoompan_filter(
    duration_s: int,
    fps: int = FPS,
    direction: Literal["in", "out"] = "in",  # NEW param
) -> str:
    params = _calculate_zoompan_params(duration_s, fps)
    z_inc = params["z_inc"]
    n_frames = params["n_frames"]

    if direction == "in":
        z_expr = f"min(zoom+{z_inc:.6f},1.5)"
        z_init = "1"  # FFmpeg zoompan resets z each frame if not specified
    else:  # "out"
        z_expr = f"max(zoom-{z_inc:.6f},1.0)"
        z_init = "1.5"

    # Note: zoompan z expression uses the previous frame's zoom value via the zoom variable
    # For zoom-out, we need to prime the initial zoom at 1.5
    # This is done via: z='if(eq(on,1),1.5,max(zoom-inc,1.0))'
    if direction == "out":
        z_expr = f"if(eq(on,1),1.5,max(zoom-{z_inc:.6f},1.0))"

    return (
        f"zoompan=z='{z_expr}':"
        f"x='iw/2-(iw/zoom/2)':"
        f"y='ih/2-(ih/zoom/2)':"
        f"d={n_frames}:"
        f"s={W_OUT}x{H_OUT}:"
        f"fps={fps}"
    )
```

### Color conversion helper

```python
def _hex_to_ffmpeg_color(hex_color: str, opacity: str = "") -> str:
    """Convert CSS hex color '#FF0000' to FFmpeg '0xFF0000' or '0xFF0000@0.85'.

    Passes through non-hex values (e.g. 'red', 'yellow') unchanged.
    opacity: optional FFmpeg opacity suffix like '@0.85' (empty = no suffix)
    """
    if not hex_color or not hex_color.startswith("#"):
        return hex_color + opacity if opacity else hex_color
    ffmpeg_hex = "0x" + hex_color.lstrip("#").upper()
    return ffmpeg_hex + opacity if opacity else ffmpeg_hex
```

### Migration 014

```sql
-- Migration 014: Add video template settings to profiles
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS video_template_settings JSONB DEFAULT '{
  "template_name": "product_spotlight",
  "primary_color": "#FF0000",
  "accent_color": "#FFFF00",
  "font_family": "",
  "cta_text": "Comanda acum!"
}'::JSONB;

CREATE INDEX IF NOT EXISTS idx_profiles_template_name
ON profiles ((video_template_settings->>'template_name'));

COMMENT ON COLUMN profiles.video_template_settings IS
  'Per-profile video template preset: template_name, primary_color (hex), accent_color (hex), font_family, cta_text';
```

### Frontend template settings card

```tsx
{/* Template & Branding card — new card in settings/page.tsx */}
<Card>
  <CardHeader>
    <CardTitle>Template & Branding</CardTitle>
    <CardDescription>
      Choose a video template and brand colors for {currentProfile.name}
    </CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    {/* Template selector */}
    <div className="space-y-2">
      <label className="text-sm font-medium">Video Template</label>
      <Select value={templateName} onValueChange={setTemplateName} disabled={saving}>
        <SelectTrigger className="w-[280px]">
          <SelectValue placeholder="Select template" />
        </SelectTrigger>
        <SelectContent>
          {availableTemplates.map((t) => (
            <SelectItem key={t.name} value={t.name}>{t.display_name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    {/* Color pickers */}
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Primary Color (CTA)</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            disabled={saving}
            className="h-9 w-16 rounded border border-input cursor-pointer"
          />
          <span className="text-xs text-muted-foreground font-mono">{primaryColor}</span>
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Accent Color (Sale Price)</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            disabled={saving}
            className="h-9 w-16 rounded border border-input cursor-pointer"
          />
          <span className="text-xs text-muted-foreground font-mono">{accentColor}</span>
        </div>
      </div>
    </div>

    {/* CTA text */}
    <div className="space-y-2">
      <label className="text-sm font-medium">Default CTA Text</label>
      <Input
        value={templateCta}
        onChange={(e) => setTemplateCta(e.target.value)}
        disabled={saving}
        className="w-full max-w-sm"
        placeholder="e.g. Comanda acum!"
      />
      <p className="text-xs text-muted-foreground">
        Pre-fills the CTA field when generating videos for this profile.
      </p>
    </div>
  </CardContent>
</Card>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hard-coded layout in `_build_text_overlays` | Parameterized via `VideoTemplate` dataclass | Phase 22 | All 3 templates can have distinct layouts without code duplication |
| Single animation direction (zoom-in only) | `zoom_direction` field on `VideoTemplate` | Phase 22 | Sale Banner uses zoom-out for visual variety |
| No per-profile branding | `video_template_settings` JSONB in profiles | Phase 22 | Each store has its own colors and template |

---

## Open Questions

1. **Font support**
   - What we know: `build_drawtext_filter` already has a `fontfile` parameter. FFmpeg drawtext supports `fontfile=` pointing to a `.ttf` file.
   - What's unclear: Are any fonts bundled in the repo? Do we need a Romanian-diacritic-safe font?
   - Recommendation: Phase 22 leaves `font_family=""` (FFmpeg default) as the only option. The settings UI shows a disabled "Font" field with placeholder "Default (system)". Font upload UI is explicitly v6+. This satisfies TMPL-02 which says "font family" without requiring upload.

2. **CTA text source of truth for the generate page**
   - What we know: `ProductGenerateRequest.cta_text` defaults to "Comanda acum!". Profile has `video_template_settings.cta_text`.
   - What's unclear: Should the generate page pre-fill the CTA field from the profile setting?
   - Recommendation: Yes — when the product-video generate page loads, it should fetch the current profile's `video_template_settings.cta_text` and use it as the default for the CTA input. This makes the per-profile CTA meaningful. However, the user can still override it per-video. The batch form should do the same.

3. **Template display names**
   - What we know: 3 names specified in requirements: "Product Spotlight", "Sale Banner", "Collection Showcase".
   - What's unclear: Should a template description/preview image be shown?
   - Recommendation: Text descriptions only in Phase 22. Static description strings on each `VideoTemplate` instance are sufficient. No preview image generation needed.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis — `app/services/product_video_compositor.py` (full read)
- Direct codebase analysis — `app/api/profile_routes.py` (full read, PATCH endpoint)
- Direct codebase analysis — `app/api/product_generate_routes.py` (full read, Stage 4 compositor call)
- Direct codebase analysis — `supabase/migrations/006_add_tts_settings_to_profiles.sql` (pattern for JSONB column)
- Direct codebase analysis — `supabase/migrations/013_create_product_tables.sql` (migration pattern)
- Direct codebase analysis — `frontend/src/app/settings/page.tsx` (settings page structure, handleSave pattern)
- Live DB schema query — `profiles` table columns confirmed, `video_template_settings` column does NOT yet exist
- REQUIREMENTS.md — TMPL-01 through TMPL-04 requirements verified

### Secondary (MEDIUM confidence)
- FFmpeg drawtext documentation (from training): `fontcolor=0xRRGGBB` format verified through existing compositor code that uses named colors (`red`, `yellow`, `white`, `gray`)
- FFmpeg zoompan `if(eq(on,1),...)` idiom for initial zoom value — standard FFmpeg pattern for stateful filter initialization

### Tertiary (LOW confidence)
- TikTok/Reels safe zone measurements (top 80px, bottom 160-200px): from general knowledge; exact values vary by platform version and device. Phase 22 uses conservative estimates (top 150px, bottom 200px) which match current `_build_text_overlays` top placement (y=160).

---

## Implementation Plan Summary (for Planner)

Phase 22 fits into **2 plans**:

**Plan 22-01 (Backend):**
1. Add `VideoTemplate` dataclass + 3 preset instances to `product_video_compositor.py`
2. Extend `CompositorConfig` with `template_name`, `primary_color`, `accent_color`, `font_family` fields
3. Refactor `_build_text_overlays` to accept template + color params
4. Extend `_build_zoompan_filter` to support `direction="out"`
5. Add `_hex_to_ffmpeg_color` helper
6. Extend `_generate_product_video_task` Stage 1 to read profile `video_template_settings`
7. Update `ProfileSettingsUpdate` model with `video_template_settings` field
8. Update `PATCH /profiles/{id}` handler
9. Add `GET /profiles/templates` endpoint
10. Write migration 014 + apply it

**Plan 22-02 (Frontend):**
1. Add template settings state to `settings/page.tsx`
2. Fetch available templates from `GET /profiles/templates` on settings page load
3. Load `video_template_settings` from profile in `loadSettings`
4. Add "Template & Branding" card with template Select, color pickers, CTA input
5. Include `video_template_settings` in `handleSave`
6. Optionally: pre-fill CTA on product-video generate page from profile settings
7. Playwright screenshot verification

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; extends proven patterns
- Architecture: HIGH — dataclass + JSONB column is the simplest correct solution; validated against existing tts_settings pattern
- Pitfalls: HIGH — FFmpeg color format, safe zones, zoom-out formula all verified against existing compositor code

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (stable domain — FFmpeg compositor + Supabase JSONB)
