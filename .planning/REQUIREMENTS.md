# Requirements: Edit Factory

**Defined:** 2026-02-22
**Core Value:** Automated video production from any input — get social-media-ready videos at scale.

## v6 Requirements

Requirements for production hardening milestone. Each maps to roadmap phases.

### Backend Stability

- [x] **STAB-01**: Server persists generation progress to database (survives restart)
- [x] **STAB-02**: Project render locks are cleaned up after completion (no memory leak)
- [x] **STAB-03**: Lock timeout returns 409 Conflict to client instead of continuing
- [x] **STAB-04**: Invalid JSON in form params returns 400 error (not silent ignore)
- [x] **STAB-05**: File uploads are validated for max size (413 Payload Too Large)
- [x] **STAB-06**: External API calls retry with exponential backoff (tenacity)

### Rate Limiting & Security

- [x] **SEC-01**: Rate limiting middleware enforces per-user request limits
- [x] **SEC-02**: SRT subtitle preview escapes user content (XSS prevention)
- [x] **SEC-03**: Stream endpoints include Cache-Control headers
- [x] **SEC-04**: TTS text length validated at endpoint level (not just background job)

### Frontend Resilience

- [x] **FE-01**: Global React error boundary catches unhandled errors with fallback UI
- [x] **FE-02**: Consistent error handling utility replaces toast/alert/silence mix
- [x] **FE-03**: API client has timeout, retry logic, and centralized error handling
- [x] **FE-04**: All pages show empty states when no data exists
- [x] **FE-05**: Common polling logic extracted into shared reusable hook

### Frontend Refactoring

- [x] **REF-01**: library/page.tsx split into 5-6 focused components
- [x] **REF-02**: Polling duplication eliminated (useJobPolling, useBatchPolling, inline)

### Code Quality

- [x] **QUAL-01**: Single get_supabase() in db.py used everywhere (remove duplicates)
- [x] **QUAL-02**: ElevenLabs TTS uses async HTTP client (httpx.AsyncClient)
- [x] **QUAL-03**: Debug logs cleaned up ([MUTE DEBUG] removed)
- [x] **QUAL-04**: Unused cleanup_project_lock integrated into render flow

### Testing & Observability

- [x] **TEST-01**: pytest setup with conftest.py and fixtures for backend
- [x] **TEST-02**: Unit tests for critical services (job_storage, cost_tracker, srt_validator)
- [x] **TEST-03**: Structured JSON logging replaces plain text logs
- [x] **TEST-04**: Data retention policy cleans up temp files and old failed jobs

## Future Requirements

### CI/CD Pipeline
- **CICD-01**: GitHub Actions workflow for lint + test on push
- **CICD-02**: Automated Playwright E2E tests in CI
- **CICD-03**: Docker build validation in CI

### Advanced Monitoring
- **MON-01**: Prometheus metrics endpoint (/metrics)
- **MON-02**: Alert notifications on job failures
- **MON-03**: Request tracing with correlation IDs

### Scalability
- **SCALE-01**: Celery/Redis job queue replaces BackgroundTasks
- **SCALE-02**: Distributed locks via PostgreSQL advisory locks
- **SCALE-03**: S3/GCS file storage with local fallback

## Out of Scope

| Feature | Reason |
|---------|--------|
| Celery migration | Over-engineered for single-user; BackgroundTasks sufficient |
| Distributed locks | Single-instance deployment, threading locks adequate |
| S3 file storage | Local filesystem sufficient for personal use |
| Mobile responsive redesign | Desktop-first, personal use only |
| i18n/localization | Single user, Romanian hardcoded is fine |
| Dark mode toggle | Already dark-only, no need for toggle |
| Kubernetes readiness probes | Not deploying to K8s |
| Full dependency pinning | Version ranges acceptable for personal project |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| STAB-01 | Phase 24 | Complete |
| STAB-02 | Phase 24 | Complete |
| STAB-03 | Phase 24 | Complete |
| STAB-04 | Phase 24 | Complete |
| STAB-05 | Phase 24 | Complete |
| STAB-06 | Phase 25 | Complete |
| SEC-01 | Phase 25 | Complete |
| SEC-02 | Phase 25 | Complete |
| SEC-03 | Phase 25 | Complete |
| SEC-04 | Phase 25 | Complete |
| FE-01 | Phase 26 | Complete |
| FE-02 | Phase 30 | Complete |
| FE-03 | Phase 26 | Complete |
| FE-04 | Phase 26 | Complete |
| FE-05 | Phase 26 | Complete |
| REF-01 | Phase 27 | Complete |
| REF-02 | Phase 27 | Complete |
| QUAL-01 | Phase 28 | Complete |
| QUAL-02 | Phase 24 | Complete |
| QUAL-03 | Phase 28 | Complete |
| QUAL-04 | Phase 24 | Complete |
| TEST-01 | Phase 29 | Complete |
| TEST-02 | Phase 29 | Complete |
| TEST-03 | Phase 29 | Complete |
| TEST-04 | Phase 29 | Complete |

**Coverage:**
- v6 requirements: 25 total
- Satisfied: 24
- Pending (gap closure): 1 (FE-02 → Phase 30)
- Unmapped: 0

---
*Requirements defined: 2026-02-22*
*Last updated: 2026-02-22 after milestone audit — FE-02 reassigned to Phase 30 gap closure*
