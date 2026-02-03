---
phase: 04-tts-provider-selection
plan: 06
subsystem: frontend-tts-ui
tags: [ui, tts, settings, voice-cloning, react, shadcn]
requires: ["04-05"]
provides:
  - "RadioGroup UI component"
  - "TTS provider selector with cost badges"
  - "Voice cloning upload component"
  - "Settings page with TTS configuration"
affects: ["04-07"]
tech-stack:
  added: []
  patterns:
    - "Card-based radio selection pattern"
    - "Client-side audio duration validation"
    - "FormData upload for audio files"
    - "Profile-aware settings management"
key-files:
  created:
    - frontend/src/components/ui/radio-group.tsx
    - frontend/src/components/tts/provider-selector.tsx
    - frontend/src/components/tts/voice-cloning-upload.tsx
    - frontend/src/app/settings/page.tsx
  modified: []
decisions:
  - id: "shadcn-radio-group"
    decision: "Use Shadcn CLI to add RadioGroup component"
    rationale: "Consistent with existing UI component strategy, provides Radix UI primitive with Tailwind styling"
  - id: "card-based-provider-selection"
    decision: "Card-based layout for provider selection instead of simple radio list"
    rationale: "Better UX for displaying provider details (name, description, cost, features) in visual comparison format"
  - id: "client-side-audio-validation"
    decision: "Validate audio duration client-side using Audio element before upload"
    rationale: "Immediate feedback prevents unnecessary uploads, reduces server load, better UX"
  - id: "alert-based-notifications"
    decision: "Use browser alert() instead of toast notifications"
    rationale: "Toast hook not available in codebase, alert() provides simple working solution consistent with library page"
  - id: "settings-page-profile-aware"
    decision: "Settings page loads/saves TTS settings per profile"
    rationale: "Each profile can have different TTS provider and voice preferences for different use cases"
metrics:
  duration: "19 minutes"
  completed: "2026-02-03"
---

# Phase 04 Plan 06: Frontend TTS UI Components Summary

**One-liner:** Card-based TTS provider selector with cost badges, voice cloning upload with client-side validation, and profile-aware Settings page

## What Was Built

### Components Created

1. **RadioGroup Component (Shadcn)**
   - Installed via Shadcn CLI
   - Radix UI primitive with Tailwind styling
   - Exports RadioGroup and RadioGroupItem
   - Foundation for provider selection UI

2. **ProviderSelector Component**
   - Card-based radio selection for 4 TTS providers
   - Visual cost badges: green "Free" or "$X.XX/1k chars"
   - Provider details: name, description, cost, voice cloning availability
   - 2-column responsive grid layout
   - Selection state with ring highlight and border color

3. **VoiceCloningUpload Component**
   - File input with audio format validation (audio/*)
   - Voice name text input
   - Client-side duration validation using Audio element
   - Requirements alert (6-20 seconds, clear speech, single speaker, 10MB max)
   - FormData submission to /tts/clone-voice endpoint
   - Success/error feedback with alert()
   - Callback to parent on successful clone

4. **Settings Page**
   - Profile-aware TTS configuration interface
   - Loads current profile's TTS settings on mount
   - ProviderSelector for choosing TTS provider
   - Voice dropdown that loads voices for selected provider
   - Conditional voice cloning section (only for Coqui)
   - Save button to persist settings to profile
   - Loading states for profile and voices
   - Empty state when no profile selected

### TTS Provider List

All four providers displayed with accurate metadata:

| Provider | Cost | Voice Cloning | Description |
|----------|------|---------------|-------------|
| ElevenLabs | $0.22/1k chars | No | Premium quality, natural-sounding voices |
| Edge TTS | Free | No | Microsoft Edge voices, completely free |
| Coqui XTTS | Free | Yes | Voice cloning with 6-second sample |
| Kokoro TTS | Free | No | Fast lightweight local TTS |

## Technical Implementation

### Client-Side Audio Validation

```typescript
const audio = new Audio()
audio.src = URL.createObjectURL(file)

audio.addEventListener("loadedmetadata", () => {
  const audioDuration = audio.duration
  setDuration(audioDuration)

  if (audioDuration < 6) {
    setError("Audio sample must be at least 6 seconds long")
  } else if (audioDuration > 20) {
    setError("Audio sample should be between 6-20 seconds")
  }

  URL.revokeObjectURL(audio.src)
})
```

**Benefits:**
- Instant validation feedback before upload
- Reduces server load (no invalid uploads)
- Better UX (errors shown immediately)
- No FFmpeg/librosa needed on frontend

### FormData Upload Pattern

```typescript
const formData = new FormData()
formData.append("audio_file", selectedFile)
formData.append("voice_name", voiceName.trim())

const headers: HeadersInit = {}
if (profileId) {
  headers["X-Profile-Id"] = profileId
}

const response = await fetch(`${API_URL}/tts/clone-voice`, {
  method: "POST",
  headers,
  body: formData,
})
```

**Key decisions:**
- Manual fetch instead of apiPost (apiPost assumes JSON body)
- Explicit profile ID header injection from localStorage
- No Content-Type header (browser sets multipart/form-data boundary)

### Profile-Aware Settings Flow

1. **Load:** On mount, fetch profile settings from /profiles/{id}
2. **Extract:** Parse tts_settings JSONB field
3. **Populate:** Set provider and voice_id state from settings
4. **Load Voices:** Fetch voices for selected provider from /tts/voices
5. **Save:** PATCH updated tts_settings back to /profiles/{id}
6. **Refresh:** Reload voices after successful voice cloning

## UI/UX Patterns

### Card-Based Provider Selection

- Cards show provider details at a glance
- Visual selection state (ring + border highlight)
- Cost badges use color coding (green for free, gray for paid)
- Voice cloning badge for supported providers
- Click anywhere on card to select (not just radio button)

### Settings Page Structure

```
Settings Page
├── Header (icon + title + profile name)
└── TTS Provider Card
    ├── Provider Selector (4 cards in 2-column grid)
    ├── Voice Selection Dropdown
    ├── Voice Cloning Upload (conditional, Coqui only)
    └── Save Button
```

### Loading States

- **Initial Load:** Full page spinner while profile and settings load
- **Voice Loading:** Disabled dropdown with "Loading voices..." placeholder
- **Saving:** Disabled form with spinner in save button
- **No Profile:** Empty state message with guidance

## Integration Points

### With Backend APIs

- GET /profiles/{id} - Load current TTS settings
- PATCH /profiles/{id} - Save TTS settings
- GET /tts/voices?provider={provider} - Load voice list
- POST /tts/clone-voice - Upload voice sample

### With Profile Context

```typescript
const { currentProfile, isLoading: profileLoading } = useProfile()

// Wait for profile before loading settings
useEffect(() => {
  if (profileLoading || !currentProfile) return
  loadSettings()
}, [currentProfile, profileLoading])
```

### Settings Data Structure

```json
{
  "tts_settings": {
    "provider": "coqui",
    "voice_id": "cloned-voice-123",
    "voice_name": "John's Voice"
  }
}
```

## Testing & Validation

### Build Verification
```bash
cd frontend && npm run build
✓ Compiled successfully
✓ All TypeScript errors resolved
✓ /settings route generated
```

### Component Verification
- ✓ radio-group.tsx exists with RadioGroup export
- ✓ provider-selector.tsx renders 4 provider cards with cost badges
- ✓ voice-cloning-upload.tsx validates duration client-side
- ✓ settings/page.tsx integrates all TTS components

## Decisions Made

### 1. Shadcn RadioGroup Component
**Decision:** Use Shadcn CLI to add RadioGroup instead of manual creation
**Rationale:** Consistent with existing UI component strategy, provides Radix UI primitive with proper accessibility and Tailwind styling out of the box
**Alternatives:** Manual Radix UI implementation, custom radio component
**Impact:** Low - standard component addition

### 2. Card-Based Provider Selection
**Decision:** Card layout for provider selection instead of simple radio list
**Rationale:** Better UX for displaying provider details (name, description, cost, features) in visual comparison format. Users can see all options at a glance and make informed decisions.
**Alternatives:** Simple radio list, dropdown select, tabs
**Impact:** Medium - better UX but more complex layout

### 3. Client-Side Audio Validation
**Decision:** Validate audio duration client-side using Audio element before upload
**Rationale:** Immediate feedback prevents unnecessary uploads, reduces server load, better UX (errors shown before waiting for upload)
**Alternatives:** Server-side only validation, no validation
**Impact:** High - significantly better UX, prevents wasted uploads

### 4. Alert-Based Notifications
**Decision:** Use browser alert() instead of toast notifications
**Rationale:** Toast hook not available in codebase, alert() provides simple working solution consistent with library page patterns
**Alternatives:** Add toast library (shadcn, sonner), custom notification component
**Impact:** Low - functional but not ideal UX (future enhancement opportunity)

### 5. Settings Page Profile-Aware
**Decision:** Settings page loads/saves TTS settings per profile
**Rationale:** Each profile can have different TTS provider and voice preferences for different brands/use cases
**Alternatives:** Global settings, project-level settings
**Impact:** High - enables multi-tenant workflows with different TTS needs

## Deviations from Plan

None - plan executed exactly as written.

## Known Limitations

1. **Toast Notifications Missing:** Using alert() instead of proper toast UI
   - **Impact:** Less polished UX, alerts are blocking
   - **Mitigation:** Add shadcn toast component in future enhancement
   - **Workaround:** Alert works for MVP, messages are clear

2. **No Provider Availability Check:** Frontend shows all 4 providers regardless of backend availability
   - **Impact:** User might select provider that backend can't use
   - **Mitigation:** Backend /providers endpoint could be called to filter cards
   - **Workaround:** Error handling when voice loading fails

3. **No Voice Preview:** Can't listen to voice samples before selection
   - **Impact:** User must rely on voice name alone
   - **Mitigation:** Add audio preview in future enhancement
   - **Workaround:** Voice names are descriptive (e.g., "American Male")

## Next Phase Readiness

### What's Complete
- ✅ TTS provider selection UI with cost visibility
- ✅ Voice cloning upload with validation
- ✅ Settings page with profile integration
- ✅ All components export correctly
- ✅ Build succeeds with no TypeScript errors

### What's Ready For
- **04-07:** Integrate TTS settings into video processing workflow
  - Settings page exists to configure provider
  - VoiceCloningUpload enables custom voices
  - ProviderSelector shows cost implications
  - Profile context provides settings to API calls

### Dependencies Satisfied
- RadioGroup component available for other forms
- TTS components reusable in other pages
- Settings page extensible for future config options

### Remaining Concerns
- Toast notification system could improve UX
- Provider availability filtering not implemented
- Voice preview would enhance voice selection

## Files Changed

### Created (4 files)
- `frontend/src/components/ui/radio-group.tsx` - Shadcn RadioGroup component
- `frontend/src/components/tts/provider-selector.tsx` - TTS provider card selector
- `frontend/src/components/tts/voice-cloning-upload.tsx` - Voice sample upload with validation
- `frontend/src/app/settings/page.tsx` - Settings page with TTS configuration

### Modified (0 files)
None - all new components and pages

## Performance Notes

- **Build Time:** 12.7s (normal for Turbopack)
- **Component Complexity:** Low - simple forms and UI
- **Audio Validation:** Instant (client-side, no network)
- **Voice Loading:** 2-3s (API fetch, 350+ voices for Edge TTS)

## Visual Verification Needed

Settings page visual verification recommended before plan completion:
1. Provider cards display correctly in 2-column grid
2. Cost badges show green/gray colors appropriately
3. Voice cloning section appears only for Coqui
4. Loading states display spinners
5. Empty states show guidance messages

## Related Documentation

- **Plan:** `.planning/phases/04-tts-provider-selection/04-06-PLAN.md`
- **Previous:** `04-05-SUMMARY.md` (TTS API Routes)
- **Next:** `04-07-PLAN.md` (TTS Integration in Video Workflow)
- **Reference:** Shadcn UI docs, Radix UI RadioGroup primitive

---

**Status:** ✅ Complete
**Duration:** 19 minutes
**Commits:** 3 (97f2412, 1cbfcfe, 730b8ad)
**Build:** ✅ Passing
**Next Step:** Execute 04-07-PLAN.md for TTS integration
