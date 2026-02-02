# Domain Pitfalls: Multi-Tenant Isolation & TTS Integration

**Domain:** Video processing platform retrofitting profile/workspace isolation
**Researched:** 2026-02-03
**Confidence:** HIGH (verified with official docs, recent 2026 sources, and codebase analysis)

---

## Critical Pitfalls

Mistakes that cause rewrites, data breaches, or major system failures.

### Pitfall 1: Enabling RLS Without Policies = Production Blackout

**What goes wrong:**
Enabling Row Level Security on existing Supabase tables without simultaneously deploying policies **immediately blocks all API access** for the `anon` key. Your app stops working instantly.

**Why it happens:**
RLS defaults to "deny all" when enabled. Developers assume enabling RLS and creating policies are separate steps, but they must be atomic in production.

**Consequences:**
- All frontend queries return 0 rows (silent data loss from user perspective)
- Background jobs fail to read/write data
- Production outage until policies are deployed
- No error message, just empty results

**Prevention:**
```sql
-- WRONG: Two separate operations
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
-- (gap where production is broken)
CREATE POLICY "users_read_own" ON projects FOR SELECT USING (auth.uid() = user_id);

-- RIGHT: Transaction with both operations
BEGIN;
  ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "users_read_own" ON projects FOR SELECT USING (auth.uid() = user_id);
  CREATE POLICY "users_write_own" ON projects FOR INSERT WITH CHECK (auth.uid() = user_id);
  -- etc. for all policies
COMMIT;
```

**Detection:**
- Staging environment query returns 0 rows when using `anon` key
- Supabase logs show `insufficient_privilege` errors
- Frontend shows empty states despite database having data

**Phase impact:** Phase 1 (Database Migration) - Test the FULL migration (RLS + policies) in staging with real frontend calls before production.

**Sources:**
- [Supabase RLS Documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase RLS Best Practices 2026](https://vibeappscanner.com/supabase-row-level-security)

---

### Pitfall 2: Foreign Key Migration Without Data Backfill = Constraint Violations

**What goes wrong:**
Adding `profile_id` foreign key constraint to tables with existing NULL data causes migration failure. Existing projects/clips/jobs have no profile assigned, violating NOT NULL constraint.

**Why it happens:**
Edit Factory currently has global data (no user_id). Adding `profile_id REFERENCES profiles(id) NOT NULL` to tables with existing rows violates referential integrity.

**Consequences:**
- Migration fails mid-execution, database in inconsistent state
- Rollback required, downtime extended
- Existing data becomes inaccessible (orphaned records)
- Production data corruption if migration partially succeeds

**Prevention:**
Multi-step migration approach:

```sql
-- Step 1: Add nullable column (migration N.M)
ALTER TABLE projects ADD COLUMN profile_id UUID REFERENCES profiles(id);
CREATE INDEX idx_projects_profile_id ON projects(profile_id);

-- Step 2: Backfill existing data (migration N.M or data script)
-- Assign existing projects to default profile
UPDATE projects SET profile_id = 'default-profile-uuid' WHERE profile_id IS NULL;
UPDATE clips SET profile_id = (SELECT profile_id FROM projects WHERE projects.id = clips.project_id);
UPDATE jobs SET profile_id = 'default-profile-uuid' WHERE profile_id IS NULL;
UPDATE api_costs SET profile_id = 'default-profile-uuid' WHERE profile_id IS NULL;

-- Step 3: Add NOT NULL constraint (migration N.M+1)
ALTER TABLE projects ALTER COLUMN profile_id SET NOT NULL;
```

**Detection:**
- Migration dry-run fails with "violates foreign key constraint"
- Constraint validation error: "column contains null values"
- Row count mismatch: `SELECT COUNT(*) WHERE profile_id IS NULL` shows orphans

**Phase impact:** Phase 1 (Database Migration) - CRITICAL. Require staging migration test with production-like data volume.

**Sources:**
- [GitLab Foreign Key Migration Best Practices](https://docs.gitlab.com/development/database/foreign_keys/)
- [Supabase Data Migration Guide 2026](https://copyright-certificate.byu.edu/news/supabase-data-migration-guide)
- [Postgres Foreign Key Migration Risks](https://iifx.dev/en/articles/221306173)

---

### Pitfall 3: Singleton Services Without Tenant Context = Data Leakage Across Profiles

**What goes wrong:**
Edit Factory's singleton service pattern (`get_job_storage()`, `get_cost_tracker()`) stores global state. When adding profiles, singletons share data across tenants, causing Job A (Profile 1) to appear in Job B (Profile 2) queries.

**Why it happens:**
Singletons are created once per process. Without tenant-scoped filtering at the service layer, all queries return global data. Background jobs lose tenant context because it's not propagated to service methods.

**Consequences:**
- Profile 1 sees Profile 2's projects/jobs/costs (data breach)
- Cost tracking leaks: Profile 1's API costs charged to Profile 2
- Job status confusion: Profile 1 sees progress for Profile 2's uploads
- Compliance violation (GDPR, SOC 2)

**Prevention:**

**Option A: Inject profile_id into all service methods**
```python
# WRONG: Global singleton without context
def get_job_storage() -> JobStorage:
    global _job_storage
    if _job_storage is None:
        _job_storage = JobStorage()
    return _job_storage

# RIGHT: Pass profile_id explicitly
class JobStorage:
    def get_job(self, job_id: str, profile_id: str) -> Optional[dict]:
        # Filter by profile_id
        if self._supabase:
            result = self._supabase.table("jobs")\
                .select("*")\
                .eq("id", job_id)\
                .eq("profile_id", profile_id)\  # CRITICAL
                .single().execute()
```

**Option B: Use dependency injection with request-scoped context**
```python
# Store profile_id in request state (FastAPI dependency)
async def get_current_profile(user: User = Depends(get_current_user)) -> str:
    return user.active_profile_id

# Inject into routes
@router.get("/jobs/{job_id}")
async def get_job(
    job_id: str,
    profile_id: str = Depends(get_current_profile),
    storage: JobStorage = Depends(get_job_storage)
):
    return storage.get_job(job_id, profile_id)  # Explicit filtering
```

**Detection:**
- Manual test: Login as Profile 1, create project. Login as Profile 2, see if project appears.
- Check API response: `GET /library/projects` returns projects with different profile_ids
- Inspect singleton state: `_memory_store` contains jobs from multiple profiles

**Phase impact:** Phase 2 (Backend Services) - Audit ALL service methods. Every Supabase query needs `.eq("profile_id", profile_id)`.

**Sources:**
- [Multi-Tenant Singleton Context Loss](https://medium.com/@systemdesignwithsage/isolation-in-multi-tenancy-and-the-lessons-we-learned-the-hard-way-3335801aa754)
- [Python Singleton Multi-Tenant Pitfalls](https://learn.microsoft.com/en-us/ef/core/miscellaneous/multitenancy)
- [FastAPI Multi-Tenant Isolation Strategies 2026](https://medium.com/@Praxen/5-fastapi-multi-tenant-isolation-strategies-that-scale-fd536fef5f88)

---

### Pitfall 4: In-Memory Cache Without Tenant Keys = Cross-Profile Data Bleeding

**What goes wrong:**
Edit Factory's in-memory structures (`_generation_progress`, `_memory_store`, `_project_locks`) don't include profile_id in keys. Profile 1's progress update overwrites Profile 2's progress if projects have same ID.

**Why it happens:**
Cache keys use project_id/job_id only. Without tenant prefix, async operations race to write the same key.

**Consequences:**
- Profile 1 sees Profile 2's generation progress (confused UI state)
- File path collisions: `/tmp/project-123/` used by both profiles simultaneously
- Lock contention: Profile 1's upload blocks Profile 2's unrelated upload
- Data corruption: Profile 1's final video overwrites Profile 2's video at same path

**Prevention:**

```python
# WRONG: Global cache key
_generation_progress: Dict[str, dict] = {}
def update_generation_progress(project_id: str, percentage: int):
    _generation_progress[project_id] = {"percentage": percentage}

# RIGHT: Composite key with profile_id
_generation_progress: Dict[str, dict] = {}
def update_generation_progress(profile_id: str, project_id: str, percentage: int):
    cache_key = f"{profile_id}:{project_id}"
    _generation_progress[cache_key] = {"percentage": percentage}

# OR: Nested dict
_generation_progress: Dict[str, Dict[str, dict]] = {}
def update_generation_progress(profile_id: str, project_id: str, percentage: int):
    if profile_id not in _generation_progress:
        _generation_progress[profile_id] = {}
    _generation_progress[profile_id][project_id] = {"percentage": percentage}
```

**File path isolation:**
```python
# WRONG: Shared temp directory
temp_dir = settings.temp_dir / project_id

# RIGHT: Profile-scoped temp directory
temp_dir = settings.temp_dir / profile_id / project_id
```

**Detection:**
- Concurrent upload test: Two profiles upload simultaneously, check progress API
- Inspect cache: `_generation_progress` contains keys without tenant prefix
- File system check: `/tmp/` contains project folders without profile namespace

**Phase impact:** Phase 2 (Backend Services) - Audit all in-memory dicts and temp file paths.

**Sources:**
- [Multi-Tenant Cache Data Leakage 2026](https://medium.com/@instatunnel/multi-tenant-leakage-when-row-level-security-fails-in-saas-da25f40c788c)
- [Python In-Memory Cache Multi-Tenant](https://jumpi96.github.io/A-multi-tenant-cache/)

---

### Pitfall 5: Background Tasks Lose Tenant Context = Jobs Execute Against Wrong Profile

**What goes wrong:**
FastAPI `BackgroundTasks` evaluate dependencies at task creation time, not execution time. Profile context from request is lost when task runs after response.

**Why it happens:**
Background tasks execute in separate threads without request context. The `profile_id` from the original request is not automatically passed to service methods called inside the task.

**Consequences:**
- Job processes Profile 1's video but saves results to Profile 2's database
- Cost tracking logs Profile 1's ElevenLabs usage to Profile 2's quota
- Postiz publishes Profile 1's video to Profile 2's social accounts (nightmare scenario)

**Prevention:**

```python
# WRONG: Dependency not passed to background task
@router.post("/library/projects/{project_id}/generate-variants")
async def generate_variants(
    project_id: str,
    background_tasks: BackgroundTasks,
    profile_id: str = Depends(get_current_profile)
):
    background_tasks.add_task(process_variants, project_id)
    # profile_id is lost when task runs!

# RIGHT: Explicitly pass profile_id to task
@router.post("/library/projects/{project_id}/generate-variants")
async def generate_variants(
    project_id: str,
    background_tasks: BackgroundTasks,
    profile_id: str = Depends(get_current_profile)
):
    background_tasks.add_task(
        process_variants,
        project_id,
        profile_id  # CRITICAL: Must pass explicitly
    )

# Task function receives profile_id
def process_variants(project_id: str, profile_id: str):
    storage = get_job_storage()
    job = storage.get_job(job_id, profile_id)  # Filter by profile
    # ... rest of processing
```

**Detection:**
- Background task test: Trigger upload for Profile 1, check if results appear in Profile 2
- Log inspection: Background task logs show wrong profile_id or missing profile_id
- Database query: Check if job results have mismatched profile_id vs user_id

**Phase impact:** Phase 2 (Backend Services) - Audit ALL `background_tasks.add_task()` calls.

**Sources:**
- [FastAPI Background Tasks Dependency Injection 2026](https://thelinuxcode.com/dependency-injection-in-fastapi-2026-playbook-for-modular-testable-apis/)
- [FastAPI Background Tasks Multi-Tenant](https://medium.com/techtrends-digest/high-performance-fastapi-dependency-injection-the-power-of-scoped-background-tasks-2025-f15250c53574)
- [FastAPI BackgroundTasks Official Docs](https://fastapi.tiangolo.com/tutorial/background-tasks/)

---

## Moderate Pitfalls

Mistakes that cause delays, technical debt, or user confusion.

### Pitfall 6: RLS Performance Degradation on Large Tables Without Indexes

**What goes wrong:**
RLS policies on `projects`, `clips`, `jobs`, `api_costs` tables add `WHERE profile_id = X` filter to every query. Without index on `profile_id`, queries scan entire table (full table scan).

**Why it happens:**
Supabase RLS works by adding policy conditions to queries. Without index, Postgres evaluates policy for every row.

**Consequences:**
- Query time increases from 50ms to 5000ms on tables with 10K+ rows
- API timeouts under load
- Database CPU spikes
- Poor user experience (slow page loads)

**Prevention:**

```sql
-- CRITICAL: Add indexes BEFORE enabling RLS
CREATE INDEX idx_projects_profile_id ON projects(profile_id);
CREATE INDEX idx_clips_profile_id ON clips(profile_id);
CREATE INDEX idx_jobs_profile_id ON jobs(profile_id);
CREATE INDEX idx_api_costs_profile_id ON api_costs(profile_id);

-- Composite indexes for common query patterns
CREATE INDEX idx_projects_profile_status ON projects(profile_id, status);
CREATE INDEX idx_jobs_profile_created ON jobs(profile_id, created_at DESC);
```

**Detection:**
- Query performance test: Run `EXPLAIN ANALYZE` on queries with RLS enabled
- Monitoring: Database slow query log shows sequential scans
- Symptom: API response time increases proportional to table size

**Phase impact:** Phase 1 (Database Migration) - Add indexes in same migration as RLS policies.

**Sources:**
- [Supabase RLS Performance Best Practices 2026](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)
- [Supabase RLS Performance Guide](https://www.leanware.co/insights/supabase-best-practices)

---

### Pitfall 7: Cost Tracking Per-Profile Without Quota Enforcement = Budget Overruns

**What goes wrong:**
Adding `profile_id` to `api_costs` table tracks costs per profile but doesn't prevent Profile 1 from consuming $100 in ElevenLabs credits when they have $10 quota.

**Why it happens:**
Cost tracking is retroactive (logs after API call). Without pre-call quota check, profile can exceed budget.

**Consequences:**
- Profile 1 uses $500 in ElevenLabs, company eats the cost
- No warning when approaching quota limit
- Billing disputes with customers
- Manual intervention required to block over-quota profiles

**Prevention:**

```python
class CostTracker:
    def check_quota_before_tts(
        self,
        profile_id: str,
        estimated_characters: int
    ) -> tuple[bool, str]:
        """Check if profile has quota for operation."""
        estimated_cost = estimated_characters * ELEVENLABS_COST_PER_CHAR

        # Get profile quota and current usage
        profile = get_profile(profile_id)
        current_usage = self.get_profile_total(profile_id)

        if current_usage + estimated_cost > profile.monthly_quota:
            return False, f"Quota exceeded. Used ${current_usage:.2f} of ${profile.monthly_quota:.2f}"

        return True, "OK"

# In TTS route
@router.post("/tts/generate")
async def generate_tts(
    text: str,
    profile_id: str = Depends(get_current_profile)
):
    # Pre-flight quota check
    allowed, message = cost_tracker.check_quota_before_tts(
        profile_id,
        len(text)
    )
    if not allowed:
        raise HTTPException(status_code=429, detail=message)

    # Proceed with TTS call
    audio = await elevenlabs_tts(text)
    cost_tracker.log_elevenlabs_tts(profile_id, len(text))
```

**Detection:**
- Manual test: Set low quota, trigger TTS that exceeds it, verify rejection
- Monitoring: Alert when profile usage > 80% of quota
- Cost report: Check if any profile has costs > quota without rejection

**Phase impact:** Phase 3 (Cost Management) - Implement quota checks before API calls.

**Sources:**
- [TokenTrail LLM Cost Tracking 2026](https://tokentrailapp.com/)
- [Multi-Tenant Cost Attribution](https://www.moesif.com/blog/monitoring/Monitoring-Cost-and-Consumption-of-AI-APIs-and-Apps/)
- [Per-Tenant Quota Billing SaaS 2026](https://aws.amazon.com/blogs/machine-learning/build-an-internal-saas-service-with-cost-and-usage-tracking-for-foundation-models-on-amazon-bedrock/)

---

### Pitfall 8: TTS Provider Fallback Without State Reset = Silent Failures

**What goes wrong:**
ElevenLabs fails (quota exceeded), system falls back to Edge TTS, but retry logic doesn't reset tokenizer stream and context buffers from first attempt. Second attempt sends empty audio or corrupted data.

**Why it happens:**
ElevenLabs plugin drains input channel on first try. When websocket closes or times out, retry runs with empty channel. Per-attempt state (tokenizer stream, alignment buffers, context id) isn't reset.

**Consequences:**
- User sees "TTS completed" but audio file is empty or truncated
- No error message (fallback succeeded but produced garbage)
- Debugging nightmare: logs show success but output is broken
- User re-uploads video multiple times (wastes quota)

**Prevention:**

```python
class TTSService:
    def generate_with_fallback(self, text: str, profile_id: str) -> Path:
        """Try ElevenLabs, fallback to Edge TTS if failed."""

        # Attempt 1: ElevenLabs
        try:
            return self._generate_elevenlabs(text, profile_id)
        except ElevenLabsQuotaExceeded as e:
            logger.warning(f"ElevenLabs quota exceeded for profile {profile_id}, falling back to Edge TTS")
        except Exception as e:
            logger.error(f"ElevenLabs failed: {e}, falling back to Edge TTS")

        # CRITICAL: Reset state before fallback
        self._reset_tts_state()

        # Attempt 2: Edge TTS (free)
        return self._generate_edge_tts(text, profile_id)

    def _reset_tts_state(self):
        """Reset any cached state from previous TTS attempt."""
        self._tokenizer_stream = None
        self._context_id = None
        self._alignment_buffers = []
        # Re-initialize input channel, etc.
```

**Detection:**
- Test: Force ElevenLabs failure, check Edge TTS output file is valid audio
- Validation: Check audio file size > 0 and duration matches text length
- Symptom: User reports "TTS completed but no sound"

**Phase impact:** Phase 4 (TTS Integration) - Add state reset and output validation.

**Sources:**
- [ElevenLabs TTS Retry Bug 2026](https://github.com/livekit/agents/issues/4135)
- [ElevenLabs Integration Feature Request](https://github.com/BerriAI/litellm/issues/13616)

---

### Pitfall 9: Profile Switching Without Clearing Frontend State = Stale Data Display

**What goes wrong:**
User switches from Profile A to Profile B. Frontend React state still holds Profile A's projects/jobs. User sees Profile A's data in UI but API returns Profile B's data (mismatch).

**Why it happens:**
Frontend uses `useState` for local caching. Profile switch updates `activeProfileId` but doesn't clear cached project list. Next render shows stale state until component re-mounts.

**Consequences:**
- UI shows Profile A's project list when viewing Profile B
- Click on project → 404 (project belongs to Profile A, not accessible)
- User confusion: "Where did my projects go?"
- Data integrity concerns: User thinks data was deleted

**Prevention:**

```typescript
// ProfileContext.tsx
export function ProfileProvider({ children }) {
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  const switchProfile = (newProfileId: string) => {
    // CRITICAL: Broadcast profile switch event
    setActiveProfileId(newProfileId);
    window.dispatchEvent(new CustomEvent('profile-switched', {
      detail: { newProfileId }
    }));
  };

  return (
    <ProfileContext.Provider value={{ activeProfileId, switchProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

// LibraryPage.tsx
export default function LibraryPage() {
  const [projects, setProjects] = useState([]);
  const { activeProfileId } = useProfile();

  useEffect(() => {
    // Listen for profile switch event
    const handleProfileSwitch = () => {
      setProjects([]);  // Clear stale data
      fetchProjects();  // Re-fetch for new profile
    };

    window.addEventListener('profile-switched', handleProfileSwitch);
    return () => window.removeEventListener('profile-switched', handleProfileSwitch);
  }, []);

  useEffect(() => {
    if (activeProfileId) {
      fetchProjects();
    }
  }, [activeProfileId]);
}
```

**Detection:**
- Manual test: Create project in Profile A, switch to Profile B, check UI is empty
- DevTools: Inspect React state, verify it clears on profile switch
- Symptom: User reports seeing other profile's data

**Phase impact:** Phase 5 (Frontend Integration) - Implement profile switch event bus.

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable without major refactoring.

### Pitfall 10: Profile Selection UI Without Default Profile = Blank Screen on Login

**What goes wrong:**
User logs in. No profile is selected by default. All API calls have `profile_id=null`, RLS policies reject all queries, UI shows empty states.

**Why it happens:**
Multi-profile system requires explicit profile selection, but UX doesn't auto-select first/last-used profile.

**Consequences:**
- Confusing first-time experience ("Why is everything empty?")
- Support tickets: "I logged in but can't see my projects"
- Extra click required (poor UX)

**Prevention:**

```typescript
// Auto-select last-used or first profile on login
export function ProfileProvider({ children }) {
  const { user } = useAuth();
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      // Get last-used profile from localStorage
      const lastProfile = localStorage.getItem(`last-profile-${user.id}`);

      if (lastProfile) {
        setActiveProfileId(lastProfile);
      } else {
        // Fallback: fetch user's profiles and select first
        api.getProfiles().then(profiles => {
          if (profiles.length > 0) {
            setActiveProfileId(profiles[0].id);
          }
        });
      }
    }
  }, [user]);

  const switchProfile = (newProfileId: string) => {
    setActiveProfileId(newProfileId);
    localStorage.setItem(`last-profile-${user.id}`, newProfileId);
  };
}
```

**Detection:**
- Test: Login as new user, verify profile is auto-selected
- UX test: Check if UI loads data immediately after login

**Phase impact:** Phase 5 (Frontend Integration) - Implement auto-selection logic.

---

### Pitfall 11: FFmpeg Temp Files Without Profile Namespace = Concurrent Processing Conflicts

**What goes wrong:**
Profile 1 and Profile 2 both upload video named `wedding.mp4`. FFmpeg writes to `/tmp/wedding.mp4` for both. Race condition: first upload gets overwritten by second.

**Why it happens:**
FFmpeg temp paths don't include profile_id or unique job_id. Concurrent processing uses same file path.

**Consequences:**
- Video corruption: Profile 1's output contains Profile 2's footage
- Processing errors: FFmpeg fails "file in use"
- Difficult to debug: appears intermittent, only happens with concurrent uploads

**Prevention:**

```python
# WRONG: Global temp path
temp_path = settings.temp_dir / f"{video_filename}"

# RIGHT: Profile and job scoped temp path
temp_path = settings.temp_dir / profile_id / job_id / video_filename

# OR: UUID-based unique path
temp_path = settings.temp_dir / f"{uuid.uuid4()}_{video_filename}"
```

**Detection:**
- Concurrent test: Two profiles upload same filename simultaneously
- File system inspection: Check for collisions in `/tmp/`

**Phase impact:** Phase 2 (Backend Services) - Update all temp file path generation.

---

### Pitfall 12: ElevenLabs Character Quota Without Frontend Warning = Surprise Failures

**What goes wrong:**
Profile has 10,000 character quota. User queues 15,000 character TTS job. Job succeeds partially then fails at 10K mark. User sees "completed" status but output is truncated.

**Why it happens:**
Frontend doesn't check quota before submit. Backend starts processing, quota runs out mid-job.

**Consequences:**
- User frustration: "Why did it stop working?"
- Wasted processing time (partial job is useless)
- Support burden: User doesn't understand quota system

**Prevention:**

```typescript
// Frontend quota check before submit
async function handleGenerateAudio(text: string) {
  const estimatedCost = text.length * 0.00022;
  const usage = await api.getProfileUsage(profileId);

  if (usage.current + estimatedCost > usage.quota) {
    toast.error(
      `Insufficient quota. This text requires ${text.length} characters, ` +
      `but you only have ${usage.remaining} remaining.`
    );
    return;
  }

  // Proceed with TTS
  await api.generateTTS(text, profileId);
}
```

**Detection:**
- Test: Set low quota, try to exceed it, verify frontend warning
- UX: Check if quota display updates in real-time

**Phase impact:** Phase 5 (Frontend Integration) - Add quota display and pre-submit checks.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1: Database Migration | RLS enabled without policies (Pitfall 1) | Transaction-based migration, staging test with frontend |
| Phase 1: Database Migration | Foreign key constraint violations (Pitfall 2) | Multi-step migration, data backfill before NOT NULL |
| Phase 1: Database Migration | Missing indexes on profile_id (Pitfall 6) | Add indexes before enabling RLS |
| Phase 2: Backend Services | Singleton services without tenant filtering (Pitfall 3) | Audit all service methods, add profile_id parameter |
| Phase 2: Backend Services | In-memory cache without tenant keys (Pitfall 4) | Prefix cache keys with profile_id |
| Phase 2: Backend Services | Background tasks lose context (Pitfall 5) | Explicitly pass profile_id to all background tasks |
| Phase 2: Backend Services | FFmpeg temp file collisions (Pitfall 11) | Profile-scoped temp directories |
| Phase 3: Cost Management | No quota enforcement (Pitfall 7) | Pre-call quota checks, reject over-quota requests |
| Phase 4: TTS Integration | Fallback state not reset (Pitfall 8) | Reset buffers/streams before fallback attempt |
| Phase 4: TTS Integration | Quota exceeded without warning (Pitfall 12) | Frontend quota display, pre-submit validation |
| Phase 5: Frontend Integration | Profile switch doesn't clear state (Pitfall 9) | Event bus for profile switch, clear local state |
| Phase 5: Frontend Integration | No default profile on login (Pitfall 10) | Auto-select last-used profile from localStorage |

---

## Testing Checklist for Multi-Tenant Isolation

Before deploying to production, verify:

- [ ] **RLS lockout test:** Enable RLS in staging, verify all queries still work
- [ ] **Data isolation test:** Login as Profile 1, create project. Login as Profile 2, verify project not visible
- [ ] **Migration dry-run:** Run migration on staging with production data snapshot
- [ ] **Concurrent upload test:** Two profiles upload simultaneously, verify no cross-contamination
- [ ] **Background job context test:** Trigger job for Profile 1, verify results don't appear in Profile 2
- [ ] **Quota enforcement test:** Set low quota, exceed it, verify rejection
- [ ] **Fallback test:** Force ElevenLabs failure, verify Edge TTS produces valid output
- [ ] **Profile switch test:** Switch profiles in UI, verify all data clears and re-fetches
- [ ] **Cost tracking test:** Trigger API calls for Profile 1, verify costs logged to Profile 1 only
- [ ] **Index performance test:** Run EXPLAIN ANALYZE on queries, verify index usage

---

## Critical Architecture Review Questions

Before retrofitting multi-tenancy, answer these:

1. **Is every Supabase query filtered by profile_id?**
   - Check: `grep -r "supabase.table" app/` → every query must have `.eq("profile_id", X)`

2. **Are all in-memory caches tenant-scoped?**
   - Check: `grep -r "_.*store.*Dict" app/` → keys must include profile_id

3. **Do background tasks receive profile_id explicitly?**
   - Check: `grep -r "background_tasks.add_task" app/` → verify profile_id in args

4. **Are temp file paths profile-scoped?**
   - Check: `grep -r "temp_dir" app/` → paths must include profile_id or unique job_id

5. **Does cost tracking prevent over-quota operations?**
   - Check: Before `elevenlabs_tts()` call, is there quota check with rejection?

6. **Is RLS migration tested with real data volume?**
   - Check: Staging has >10K rows, migration succeeds without timeout

7. **Are indexes added before enabling RLS?**
   - Check: Migration has `CREATE INDEX` before `ALTER TABLE ENABLE ROW LEVEL SECURITY`

---

## Sources

### Multi-Tenant Architecture
- [Approaches to Multi-Tenancy in SaaS](https://developers.redhat.com/articles/2022/05/09/approaches-implementing-multi-tenancy-saas-applications)
- [WorkOS Developer's Guide to Multi-Tenant Architecture](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture)
- [Multi-Tenant Architecture Guide 2026](https://www.future-processing.com/blog/multi-tenant-architecture/)
- [Frontegg Multi-Tenant Guide](https://frontegg.com/guides/multi-tenant-architecture)
- [Multi-Tenant Leakage: When RLS Fails](https://medium.com/@instatunnel/multi-tenant-leakage-when-row-level-security-fails-in-saas-da25f40c788c)
- [Six Shades of Multi-Tenant Mayhem](https://borabastab.medium.com/six-shades-of-multi-tenant-mayhem-the-invisible-vulnerabilities-hiding-in-plain-sight-182e9ad538b5)
- [Isolation in Multi-Tenancy: Lessons Learned](https://medium.com/@systemdesignwithsage/isolation-in-multi-tenancy-and-the-lessons-we-learned-the-hard-way-3335801aa754)

### Supabase RLS
- [Supabase RLS Documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase RLS Complete Guide 2026](https://vibeappscanner.com/supabase-row-level-security)
- [Supabase Best Practices](https://www.leanware.co/insights/supabase-best-practices)
- [Supabase RLS Performance Best Practices 2026](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)

### Database Migration
- [GitLab Foreign Keys Guide](https://docs.gitlab.com/development/database/foreign_keys/)
- [Advanced PostgreSQL Migration Techniques](https://iifx.dev/en/articles/221306173)
- [Data Migration Risks and Fixes](https://www.datafold.com/blog/common-data-migration-risks)
- [Supabase Data Migration Guide](https://copyright-certificate.byu.edu/news/supabase-data-migration-guide)

### FastAPI Multi-Tenant
- [FastAPI Multi-Tenant Isolation Strategies 2026](https://medium.com/@Praxen/5-fastapi-multi-tenant-isolation-strategies-that-scale-fd536fef5f88)
- [FastAPI Dependency Injection 2026 Playbook](https://thelinuxcode.com/dependency-injection-in-fastapi-2026-playbook-for-modular-testable-apis/)
- [FastAPI Background Tasks Documentation](https://fastapi.tiangolo.com/tutorial/background-tasks/)
- [High-Performance FastAPI Scoped Background Tasks 2025](https://medium.com/techtrends-digest/high-performance-fastapi-dependency-injection-the-power-of-scoped-background-tasks-2025-f15250c53574)

### Cost Tracking & TTS
- [TokenTrail LLM Cost Tracking](https://tokentrailapp.com/)
- [Multi-Tenant Cost Attribution (Moesif)](https://www.moesif.com/blog/monitoring/Monitoring-Cost-and-Consumption-of-AI-APIs-and-Apps/)
- [AWS Multi-Tenant Cost Tracking](https://aws.amazon.com/blogs/machine-learning/build-an-internal-saas-service-with-cost-and-usage-tracking-for-foundation-models-on-amazon-bedrock/)
- [ElevenLabs Pricing Breakdown 2026](https://flexprice.io/blog/elevenlabs-pricing-breakdown)
- [ElevenLabs TTS Retry Bug](https://github.com/livekit/agents/issues/4135)
- [ElevenLabs Fallback Feature Request](https://github.com/BerriAI/litellm/issues/13616)

### Caching & State Management
- [Multi-Tenant Cache Solution with Python](https://jumpi96.github.io/A-multi-tenant-cache/)
- [Python Singleton Multi-Tenant (EF Core)](https://learn.microsoft.com/en-us/ef/core/miscellaneous/multitenancy)
