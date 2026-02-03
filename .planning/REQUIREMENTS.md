# Requirements: Edit Factory v2

**Defined:** 2026-02-03
**Core Value:** One-click video production workflow with profile isolation for multiple online stores

## v1 Requirements

### Profiles

- [x] **PROF-01**: User can create a profile with name and description for each store
- [x] **PROF-02**: User can switch between profiles via dropdown in navbar
- [x] **PROF-03**: Active profile indicator always visible in navbar (name + visual distinction)
- [x] **PROF-04**: Each profile has its own isolated library (projects and clips not visible across profiles)
- [ ] **PROF-05**: Each profile has its own Postiz API credentials for social media publishing
- [x] **PROF-06**: Default profile auto-selected on login (last used or marked as default)
- [x] **PROF-07**: Existing projects and clips migrated to a default profile during setup

### TTS

- [ ] **TTS-01**: User can select TTS provider from UI (ElevenLabs, Edge TTS, Coqui XTTS, Kokoro)
- [ ] **TTS-02**: Provider cost displayed inline next to each option (paid amount vs "Free" label)
- [ ] **TTS-03**: Coqui XTTS v2 integrated as local free TTS engine with voice cloning capability
- [ ] **TTS-04**: Kokoro TTS integrated as local free TTS engine with preset voices
- [ ] **TTS-05**: User can save default voice settings per profile (provider, voice ID, model, speed)
- [ ] **TTS-06**: Voice cloning workflow: user uploads 6-second audio sample, system creates cloned voice usable in Coqui XTTS

### Developer Experience

- [ ] **DX-01**: Start script (.bat for Windows, .sh for WSL) launches backend + frontend + opens browser with single execution
- [ ] **DX-02**: Start script handles venv activation, port availability, and graceful shutdown

## v2 Requirements

### TTS Enhancements

- **TTS-07**: Piper TTS integrated as fast preview TTS engine (lower quality, faster generation)
- **TTS-08**: Voice preview button to test voice with sample text before full generation
- **TTS-09**: Automatic TTS failover (ElevenLabs quota exceeded -> fall back to free provider)

### Profile Enhancements

- **PROF-08**: Cross-profile project copying (clone project from Store A to Store B)
- **PROF-09**: Profile activity dashboard (video count, API costs, last activity per profile)
- **PROF-10**: Per-profile cost quota with enforcement (reject TTS if quota exceeded)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Desktop app (Electron/Tauri) | Unnecessary overhead for single-user constant-upgrade workflow |
| Team collaboration / multi-user | Single user manages both stores |
| Profile permissions / RBAC | Meaningless for one person |
| Profile templates / marketplace | Two profiles, manual setup is 2 minutes |
| Mobile app | Web-first, personal use |
| Real-time chat/notifications | Not relevant to video production workflow |
| Per-profile FFmpeg settings | Video output format same for both stores (social media standards) |
| Profile-specific UI themes | Visual customization adds no value, only name/icon differ |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROF-01 | Phase 1, Phase 2, Phase 3 | Complete |
| PROF-02 | Phase 3 | Complete |
| PROF-03 | Phase 3 | Complete |
| PROF-04 | Phase 1 | Complete |
| PROF-05 | Phase 2, Phase 5 | Pending |
| PROF-06 | Phase 3 | Complete |
| PROF-07 | Phase 1 | Complete |
| TTS-01 | Phase 4 | Pending |
| TTS-02 | Phase 4 | Pending |
| TTS-03 | Phase 4 | Pending |
| TTS-04 | Phase 4 | Pending |
| TTS-05 | Phase 4 | Pending |
| TTS-06 | Phase 4 | Pending |
| DX-01 | Phase 6 | Pending |
| DX-02 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0
- Coverage: 100%

---
*Requirements defined: 2026-02-03*
*Last updated: 2026-02-03 after roadmap creation*
