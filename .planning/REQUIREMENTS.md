# Requirements: Edit Factory

**Defined:** 2026-03-02
**Core Value:** Automated video production from any input — get social-media-ready videos with AI voiceover, synced subtitles, and matched visuals, ready to publish at scale.

## v11 Requirements

Requirements for Production Polish & Platform Hardening. Each maps to roadmap phases.

### Security

- [x] **SEC-01**: User data is isolated via Supabase RLS on all editai_* tables (re-enable RLS, backend uses service_role key)
- [x] **SEC-02**: Heavy API endpoints have per-route rate limits (uploads: 10/min, renders: 5/min, TTS: 20/min)
- [x] **SEC-03**: File uploads are validated by MIME type server-side (python-magic, not just Content-Type header)
- [x] **SEC-04**: Script and context text is sanitized before reaching FFmpeg subtitle rendering

### Testing

- [ ] **TEST-01**: Backend services have pytest unit tests with >80% coverage on critical paths (video_processor, assembly_service, job_storage, cost_tracker)
- [x] **TEST-02**: API endpoints have integration tests with mock data and response structure assertions
- [ ] **TEST-03**: Playwright E2E tests verify actual user workflows with API assertions (not just screenshots)

### DevOps

- [ ] **DEVOPS-01**: GitHub Actions CI pipeline runs lint, type-check, and tests on every push and PR
- [ ] **DEVOPS-02**: All Python dependencies are pinned to exact versions in requirements.txt
- [ ] **DEVOPS-03**: Application version is auto-derived from git tags (not hardcoded "1.0.0" in main.py)

### Monitoring

- [ ] **MON-01**: Sentry DSN is configured and crash reporting sends real error events in production
- [ ] **MON-02**: /health endpoint checks Supabase database connectivity alongside FFmpeg and Redis
- [ ] **MON-03**: Failed renders automatically clean up partial output files
- [ ] **MON-04**: Output directory has automatic TTL-based cleanup for orphaned intermediate files

### UX

- [ ] **UX-01**: User can preview clips inline via embedded HTML5 video player in library page (no new tab)
- [ ] **UX-02**: Destructive actions (delete, remove-audio, bulk-delete) use Shadcn/UI AlertDialog instead of window.confirm()
- [ ] **UX-03**: User can recover deleted clips via soft-delete with 30-day trash retention
- [ ] **UX-04**: UI text language is consistent — all Romanian or all English with i18n framework
- [ ] **UX-05**: Vestigial marketing pages (statsai, preturi, functionalitati, cum-functioneaza, contact, testimoniale) are removed from routing
- [ ] **UX-06**: User can upload video files via drag-and-drop onto the upload area
- [ ] **UX-07**: User can use keyboard shortcuts for common operations (Delete to remove, Escape to close, Space to play/pause)
- [ ] **UX-08**: User can hover over clip thumbnails to see animated video preview (autoplay on hover)
- [ ] **UX-09**: User can tag clips and organize them into custom categories/folders

### Performance

- [ ] **PERF-01**: Library clips endpoint supports cursor-based pagination (50 clips per page with infinite scroll)
- [ ] **PERF-02**: Job progress updates use Server-Sent Events (SSE) instead of HTTP polling
- [ ] **PERF-03**: Profile context is cached with 60-second TTL to reduce per-request Supabase queries
- [ ] **PERF-04**: TTS cache exposes hit/miss metrics and has configurable maximum size with LRU eviction

### Architecture

- [ ] **ARCH-01**: Background jobs use Redis-backed durable queue with retry logic (replaces BackgroundTasks)
- [ ] **ARCH-02**: Pipeline and assembly state persists to Supabase database (not in-memory dicts)
- [ ] **ARCH-03**: Assembly jobs use the same JobStorage pattern as video processing jobs
- [ ] **ARCH-04**: File storage supports cloud backend (S3 or Supabase Storage) alongside local filesystem

## Future Requirements

Deferred beyond v11. Tracked but not in current roadmap.

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
| Frontend component tests (Jest/Vitest) | Playwright E2E covers UI; unit tests focus on backend logic |
| Docker secrets management | Single-user app, .env is sufficient |
| nginx/TLS reverse proxy | Desktop app serves locally; cloud deploy TBD |
| Database migration runner | Supabase manages migrations via dashboard; manual is acceptable |
| Clip version history | Low usage frequency; soft-delete provides recovery |
| Real-time collaboration | Single user, two profiles |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 55 | Complete |
| SEC-02 | Phase 55 | Complete |
| SEC-03 | Phase 55 | Complete |
| SEC-04 | Phase 55 | Complete |
| TEST-01 | Phase 56 | Pending |
| TEST-02 | Phase 56 | Complete |
| TEST-03 | Phase 56 | Pending |
| DEVOPS-01 | Phase 57 | Pending |
| DEVOPS-02 | Phase 57 | Pending |
| DEVOPS-03 | Phase 57 | Pending |
| MON-01 | Phase 60 | Pending |
| MON-02 | Phase 60 | Pending |
| MON-03 | Phase 60 | Pending |
| MON-04 | Phase 60 | Pending |
| UX-01 | Phase 61 | Pending |
| UX-02 | Phase 61 | Pending |
| UX-03 | Phase 61 | Pending |
| UX-04 | Phase 62 | Pending |
| UX-05 | Phase 62 | Pending |
| UX-06 | Phase 61 | Pending |
| UX-07 | Phase 61 | Pending |
| UX-08 | Phase 61 | Pending |
| UX-09 | Phase 62 | Pending |
| PERF-01 | Phase 59 | Pending |
| PERF-02 | Phase 59 | Pending |
| PERF-03 | Phase 59 | Pending |
| PERF-04 | Phase 59 | Pending |
| ARCH-01 | Phase 58 | Pending |
| ARCH-02 | Phase 58 | Pending |
| ARCH-03 | Phase 58 | Pending |
| ARCH-04 | Phase 58 | Pending |

**Coverage:**
- v11 requirements: 31 total
- Mapped to phases: 31
- Unmapped: 0

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-02 after v11 roadmap creation — all 31 requirements mapped*
