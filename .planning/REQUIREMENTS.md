# Requirements: Edit Factory

**Defined:** 2026-03-09
**Core Value:** Automated video production from any input — get social-media-ready videos with AI voiceover, synced subtitles, and matched visuals, ready to publish at scale.

## v12 Requirements

Requirements for Desktop Product MVP. Each maps to roadmap phases.

### Data Layer

- [x] **DATA-01**: User's projects, clips, and settings are stored in a local SQLite database on their PC (not Supabase cloud)
- [x] **DATA-02**: Backend services use a data abstraction layer that can swap between SQLite and Supabase without changing business logic
- [x] **DATA-03**: User can create, edit, and delete projects while completely offline
- [x] **DATA-04**: All video files (input, output, thumbnails) are stored on the user's local filesystem with no cloud dependency
- [x] **DATA-05**: Cost tracking and TTS cache data persist locally in SQLite
- [x] **DATA-06**: Existing Supabase migrations are translated to SQLite schema (all editai_* tables)

### Auth & Licensing

- [x] **AUTH-01**: Frontend sends JWT token to backend via Authorization header on every API call
- [ ] **AUTH-02**: User can log out from the app via a visible logout button in the UI
- [ ] **AUTH-03**: Lemon Squeezy license key is validated at first launch and periodically (with offline grace period)
- [ ] **AUTH-04**: User can reset password via email link from the login page
- [ ] **AUTH-05**: Unauthenticated users cannot access protected routes (Next.js middleware enforces redirect to login)

### UX Simplification

- [ ] **UX-01**: Pipeline has a simplified 3-step mode (Upload → Choose Style → Download) for non-technical users
- [ ] **UX-02**: Advanced parameters (motion threshold, variance scoring, pHash) are hidden under an expandable "Advanced" section
- [ ] **UX-03**: Setup wizard guides new users through API key configuration with presets ("Free TTS" auto-selects Edge TTS, skip ElevenLabs)
- [ ] **UX-04**: User can choose from 5+ caption/subtitle visual presets (font, size, position, color scheme)
- [ ] **UX-05**: User can queue multiple videos for batch clip generation with a visible job queue
- [ ] **UX-06**: Brand name is consistent throughout the entire app (single name, no "EditAI" vs "Edit Factory" mix)
- [ ] **UX-07**: No hardcoded Romanian text remains in the app (all defaults in English)

### Electron Polish

- [ ] **ELEC-01**: electron-updater publish config has real owner/repo values (not PLACEHOLDER)
- [ ] **ELEC-02**: Portable Node.js is included in the build pipeline with documented setup
- [ ] **ELEC-03**: Installer size is under 500 MB (optimized PyTorch/Whisper bundling strategy)
- [ ] **ELEC-04**: Auto-updater downloads and installs updates from GitHub Releases
- [ ] **ELEC-05**: App has a consistent icon, splash screen, and window title matching the product brand
- [ ] **ELEC-06**: macOS build target is configured in electron-builder (in addition to Windows NSIS)

### Direct API Integration

- [ ] **API-01**: ElevenLabs TTS calls go directly from the desktop app (not proxied through FastAPI backend)
- [ ] **API-02**: Gemini AI analysis calls go directly from the desktop app
- [ ] **API-03**: User configures their own API keys in the setup wizard, stored locally (encrypted)
- [ ] **API-04**: App works without any API keys configured (falls back to Edge TTS free + local motion scoring only)

## Future Requirements

Deferred beyond v12. Tracked but not in current roadmap.

### Monetization
- **PAY-01**: Stripe/Lemon Squeezy checkout integration for subscription billing
- **PAY-02**: Subscription tiers with feature gating (free vs paid)
- **PAY-03**: Landing page with pricing, features, and CTA

### Collaboration
- **COLLAB-01**: Multiple users can share access to the same project
- **COLLAB-02**: Team workspace with role-based permissions

### Content Analytics
- **ANAL-01**: Post-publish analytics showing view counts and engagement from Postiz
- **ANAL-02**: A/B testing dashboard comparing clip performance

### Templates
- **TMPL-01**: UI for creating and editing product video templates
- **TMPL-02**: Template marketplace or sharing

### Export
- **EXPORT-01**: Additional export formats (WebM, ProRes)
- **EXPORT-02**: Quality tier selection from library page

## Out of Scope

| Feature | Reason |
|---------|--------|
| Tauri migration | Electron works, migration is optional optimization for later |
| Hardware ID / DRM | Simple license key sufficient, piracy protection not worth the complexity |
| Server-side video processing | Desktop app uses local CPU/GPU — no cloud rendering |
| Real-time collaboration | Single user per desktop install |
| Mobile app | Desktop-first product |
| Cloud sync between devices | Local-first philosophy, sync deferred to future |
| Custom TTS voice training | External service feature, not in scope |
| Social media direct publishing | Postiz integration already exists, direct API auth too complex for MVP |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | 65 | Complete |
| DATA-02 | 64 | Complete |
| DATA-03 | 66 | Complete |
| DATA-04 | 66 | Complete |
| DATA-05 | 65 | Complete |
| DATA-06 | 64 | Complete |
| AUTH-01 | 67 | Complete |
| AUTH-02 | 67 | Pending |
| AUTH-03 | 68 | Pending |
| AUTH-04 | 67 | Pending |
| AUTH-05 | 67 | Pending |
| UX-01 | 70 | Pending |
| UX-02 | 70 | Pending |
| UX-03 | 71 | Pending |
| UX-04 | 71 | Pending |
| UX-05 | 70 | Pending |
| UX-06 | 72 | Pending |
| UX-07 | 72 | Pending |
| ELEC-01 | 73 | Pending |
| ELEC-02 | 73 | Pending |
| ELEC-03 | 73 | Pending |
| ELEC-04 | 73 | Pending |
| ELEC-05 | 73 | Pending |
| ELEC-06 | 73 | Pending |
| API-01 | 69 | Pending |
| API-02 | 69 | Pending |
| API-03 | 69 | Pending |
| API-04 | 69 | Pending |

**Coverage:**
- v12 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-03-09*
*Last updated: 2026-03-09 after v12 roadmap creation*
