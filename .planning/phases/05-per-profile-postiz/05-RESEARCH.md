# Phase 5: Per-Profile Postiz - Research

**Researched:** 2026-02-04
**Domain:** Multi-tenant service configuration, API credential management, cost tracking
**Confidence:** HIGH

## Summary

Phase 5 enables each profile to have its own Postiz API credentials for social media publishing, allowing multiple stores/brands to publish to different social media accounts without cross-posting. This research examines the current Postiz singleton architecture and recommends patterns for per-profile configuration.

**Key findings:**

1. **Current Postiz service is singleton** — Uses global env vars (POSTIZ_API_URL, POSTIZ_API_KEY) shared across all profiles
2. **Phase 2 already added profile_id logging** — Postiz service methods accept `profile_id` parameter for logging context
3. **TTS provider pattern exists** — Phase 4 implemented per-profile TTS credentials using profile.tts_settings JSONB column
4. **Cost tracking already profile-aware** — api_costs table has profile_id column, cost_tracker filters by profile
5. **Dashboard data already available** — Supabase queries can aggregate video counts and costs per profile

**Primary recommendation:** Extend profiles.tts_settings JSONB to include postiz_settings, use factory pattern to create profile-specific Postiz instances (similar to TTS provider selection), add quota enforcement before TTS calls.

---

## Standard Stack

### Core Dependencies (Already Present)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| httpx | Current | Async HTTP client for Postiz API | Used throughout backend for API calls |
| pydantic | Current | Settings validation | Used for request/response models |
| Supabase Python | Current | Database client | Used for all data persistence |

### Configuration Pattern

| Technology | Purpose | Implementation |
|------------|---------|----------------|
| JSONB column | Per-profile settings storage | `profiles.tts_settings` (extend for postiz) |
| Factory pattern | Profile-aware service instantiation | `get_postiz_publisher(profile_id)` |
| Environment fallback | Global default credentials | `.env` POSTIZ_API_URL/KEY as fallback |

**No new dependencies required.** Phase 5 uses existing architecture patterns.

---

## Architecture Patterns

### Current Architecture (Singleton)

```python
# app/services/postiz_service.py (current)
_postiz_publisher: Optional[PostizPublisher] = None

def get_postiz_publisher() -> PostizPublisher:
    """Factory function to get PostizPublisher instance."""
    global _postiz_publisher
    if _postiz_publisher is None:
        _postiz_publisher = PostizPublisher()  # ← Uses global env vars
    return _postiz_publisher

class PostizPublisher:
    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None
    ):
        self.api_url = (api_url or os.getenv("POSTIZ_API_URL", "")).rstrip("/")
        self.api_key = api_key or os.getenv("POSTIZ_API_KEY", "")
```

**Problem:** All profiles share the same Postiz account. Profile A's clips could accidentally publish to Profile B's social accounts.

### Recommended Architecture (Profile-Aware Factory)

**Pattern 1: Factory with Profile ID** (RECOMMENDED)

```python
# app/services/postiz_service.py (refactored)
_postiz_instances: Dict[str, PostizPublisher] = {}

def get_postiz_publisher(profile_id: str) -> PostizPublisher:
    """
    Get Postiz publisher instance for specific profile.

    Args:
        profile_id: Profile UUID to load credentials for

    Returns:
        PostizPublisher configured with profile's Postiz credentials

    Raises:
        ValueError: If profile has no Postiz credentials configured
    """
    # Return cached instance if exists
    if profile_id in _postiz_instances:
        return _postiz_instances[profile_id]

    # Load profile's Postiz settings from database
    supabase = get_supabase()
    result = supabase.table("profiles")\
        .select("tts_settings")\
        .eq("id", profile_id)\
        .single()\
        .execute()

    if not result.data:
        raise ValueError(f"Profile {profile_id} not found")

    tts_settings = result.data.get("tts_settings", {})
    postiz_config = tts_settings.get("postiz", {})

    # Fallback to global env vars if profile doesn't have Postiz configured
    api_url = postiz_config.get("api_url") or os.getenv("POSTIZ_API_URL")
    api_key = postiz_config.get("api_key") or os.getenv("POSTIZ_API_KEY")

    if not api_url or not api_key:
        raise ValueError(
            f"Profile {profile_id} has no Postiz credentials. "
            "Configure in Settings page."
        )

    # Create and cache instance
    publisher = PostizPublisher(api_url=api_url, api_key=api_key)
    _postiz_instances[profile_id] = publisher

    return publisher

def reset_postiz_publisher(profile_id: Optional[str] = None):
    """
    Reset cached publisher instance.
    Call this when profile's Postiz credentials change.

    Args:
        profile_id: Reset specific profile's instance, or None to reset all
    """
    global _postiz_instances
    if profile_id:
        _postiz_instances.pop(profile_id, None)
    else:
        _postiz_instances = {}
```

**Usage in routes:**

```python
# app/api/postiz_routes.py (updated)
@router.post("/publish")
async def publish_clip(
    request: PublishRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    # Get profile-specific Postiz publisher
    try:
        publisher = get_postiz_publisher(profile.profile_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Rest of publishing logic uses profile's Postiz account
    integrations = await publisher.get_integrations(profile_id=profile.profile_id)
    media = await publisher.upload_video(video_path, profile_id=profile.profile_id)
    result = await publisher.create_post(...)
```

**Benefits:**
- **Instance caching** — Profile's publisher reused across requests (performance)
- **Profile isolation** — Each profile gets its own Postiz API credentials
- **Graceful fallback** — Falls back to global env vars if profile has no Postiz config
- **Cache invalidation** — Reset when credentials change

**Confidence:** HIGH — This pattern matches Phase 4's TTS provider selection architecture.

---

### Pattern 2: Database Schema

**Extend `profiles.tts_settings` JSONB column:**

```sql
-- profiles.tts_settings structure (after Phase 5)
{
  "provider": "elevenlabs",  -- From Phase 4
  "elevenlabs": {...},        -- From Phase 4
  "edge": {...},              -- From Phase 4
  "coqui": {...},             -- From Phase 4
  "kokoro": {...},            -- From Phase 4
  "postiz": {                 -- NEW in Phase 5
    "api_url": "https://api.postiz.com",
    "api_key": "pk_live_abc123...",
    "enabled": true
  }
}
```

**Alternative: New column `postiz_settings` JSONB:**

```sql
ALTER TABLE profiles
ADD COLUMN postiz_settings JSONB DEFAULT '{
  "api_url": null,
  "api_key": null,
  "enabled": false
}'::JSONB;
```

**Recommendation:** **Extend tts_settings** (Option 1)

**Rationale:**
- **Consolidation** — All per-profile API configs in one place
- **Consistency** — Matches Phase 4's TTS settings structure
- **Frontend simplicity** — Settings page already loads/saves tts_settings
- **Migration ease** — No new column, just add postiz key

**Confidence:** HIGH — tts_settings already proven to work for TTS provider configs.

---

### Pattern 3: Settings Page Integration

**Frontend component structure:**

```typescript
// frontend/src/app/settings/page.tsx (extend existing)
interface TTSSettings {
  provider: string
  voice_id: string
  voice_name?: string
  postiz?: {              // NEW
    api_url: string
    api_key: string
    enabled: boolean
  }
}

export default function SettingsPage() {
  const [postizUrl, setPostizUrl] = useState("")
  const [postizKey, setPostizKey] = useState("")
  const [postizEnabled, setPostizEnabled] = useState(false)

  // Load from profile on mount
  useEffect(() => {
    const loadSettings = async () => {
      const response = await apiGet(`/profiles/${currentProfile.id}`)
      const data = await response.json()
      const postizSettings = data.tts_settings?.postiz || {}

      setPostizUrl(postizSettings.api_url || "")
      setPostizKey(postizSettings.api_key || "")
      setPostizEnabled(postizSettings.enabled || false)
    }
    loadSettings()
  }, [currentProfile])

  // Save to profile
  const handleSave = async () => {
    const ttsSettings: TTSSettings = {
      ...existingTtsSettings,
      postiz: {
        api_url: postizUrl,
        api_key: postizKey,
        enabled: postizEnabled
      }
    }

    await apiPatch(`/profiles/${currentProfile.id}`, {
      tts_settings: ttsSettings
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Postiz Publishing</CardTitle>
        <CardDescription>
          Configure social media publishing for {currentProfile.name}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <label>Postiz API URL</label>
            <Input
              value={postizUrl}
              onChange={(e) => setPostizUrl(e.target.value)}
              placeholder="https://api.postiz.com"
            />
          </div>

          <div>
            <label>Postiz API Key</label>
            <Input
              type="password"
              value={postizKey}
              onChange={(e) => setPostizKey(e.target.value)}
              placeholder="pk_live_..."
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={postizEnabled}
              onCheckedChange={setPostizEnabled}
            />
            <label>Enable Postiz for this profile</label>
          </div>

          <Button onClick={handleSave}>Save Postiz Settings</Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

**UI Placement:** Add as new section in existing Settings page (after TTS settings)

**Validation:**
- Test API connectivity before saving (call `/postiz/status` with temp credentials)
- Show success/error toast after save
- Mask API key in UI (show only last 4 characters)

**Confidence:** HIGH — Follows existing Settings page patterns.

---

## Don't Hand-Roll

### Problems with Existing Solutions

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-profile credential management | Custom encryption system | Store in JSONB, rely on Supabase security | Supabase handles encryption at rest, RLS prevents cross-profile access |
| Postiz API client instance pooling | Custom connection pool | Simple dict cache with profile_id key | Dict caching is sufficient, Postiz calls are infrequent |
| Quota enforcement logic | Complex quota tracking system | Simple check before TTS call | Phase 5 only needs basic quota check, defer advanced features |
| Activity dashboard aggregation | Custom analytics system | Direct Supabase queries | `api_costs` table already has profile_id, just GROUP BY |

**Key insight:** Phase 5 builds on existing infrastructure (profiles, api_costs, job_storage). No need for new abstractions.

**Confidence:** HIGH — Existing database schema supports all Phase 5 requirements.

---

## Common Pitfalls

### Pitfall 1: Shared Postiz Instance Across Profiles

**What goes wrong:** Using singleton Postiz publisher for all profiles causes cross-posting (Profile A's video goes to Profile B's social accounts).

**Why it happens:** Global `_postiz_publisher` doesn't distinguish between profiles.

**Prevention:**
- **Factory pattern with profile_id parameter** — `get_postiz_publisher(profile_id)`
- **Instance caching by profile** — `Dict[str, PostizPublisher]` keyed by profile_id
- **Validate credentials on fetch** — Fail fast if profile has no Postiz config

**Warning signs:**
- Publishing logs show wrong profile_id
- Social media posts appear on wrong accounts
- Users report cross-posting between stores

**Confidence:** HIGH — This is the core problem Phase 5 solves.

---

### Pitfall 2: Stale Cached Credentials

**What goes wrong:** User updates Postiz API key in Settings, but cached instance still uses old credentials. Publishing fails with 401 Unauthorized.

**Why it happens:** `_postiz_instances` dict not cleared when credentials change.

**Prevention:**
```python
# In profiles routes (PATCH endpoint)
@router.patch("/profiles/{profile_id}")
async def update_profile(profile_id: str, updates: ProfileUpdate):
    supabase = get_supabase()

    # Check if Postiz settings changed
    old_profile = supabase.table("profiles").select("tts_settings").eq("id", profile_id).single().execute()

    # Update profile
    result = supabase.table("profiles").update(updates.dict()).eq("id", profile_id).execute()

    # If Postiz credentials changed, reset cached instance
    if "tts_settings" in updates.dict():
        new_postiz = updates.dict()["tts_settings"].get("postiz", {})
        old_postiz = old_profile.data.get("tts_settings", {}).get("postiz", {})

        if new_postiz != old_postiz:
            from app.services.postiz_service import reset_postiz_publisher
            reset_postiz_publisher(profile_id)
            logger.info(f"Reset Postiz publisher cache for profile {profile_id}")

    return result.data
```

**Detection:** Test by updating Postiz credentials and immediately trying to publish.

**Confidence:** MEDIUM — Cache invalidation timing depends on implementation. Recommend proactive reset on any tts_settings change.

---

### Pitfall 3: Missing Quota Enforcement

**What goes wrong:** Profile exceeds monthly TTS budget but system continues making ElevenLabs API calls, racking up costs.

**Why it happens:** No quota check before TTS generation.

**Prevention:**
```python
# In TTS generation route
@router.post("/tts/generate")
async def generate_tts(
    request: TTSRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    # Check if profile has exceeded quota
    tracker = get_cost_tracker()
    profile_costs = tracker.get_summary(profile_id=profile.profile_id)

    # Load profile's quota from database
    supabase = get_supabase()
    profile_data = supabase.table("profiles").select("monthly_quota_usd").eq("id", profile.profile_id).single().execute()
    monthly_quota = profile_data.data.get("monthly_quota_usd", 0)

    if monthly_quota > 0 and profile_costs["total_all"] >= monthly_quota:
        raise HTTPException(
            status_code=402,  # Payment Required
            detail=f"Profile has exceeded monthly quota of ${monthly_quota}. "
                   f"Current costs: ${profile_costs['total_all']}"
        )

    # Proceed with TTS generation
    ...
```

**Detection:** Set low quota (e.g., $0.50) and trigger multiple TTS generations to test enforcement.

**Database schema addition:**
```sql
ALTER TABLE profiles
ADD COLUMN monthly_quota_usd DECIMAL(10, 2) DEFAULT 0;

COMMENT ON COLUMN profiles.monthly_quota_usd IS 'Monthly API cost quota in USD. 0 = unlimited.';
```

**Confidence:** HIGH — Quota enforcement is critical for cost control.

---

### Pitfall 4: Activity Dashboard Query Performance

**What goes wrong:** Dashboard becomes slow when profiles have thousands of projects/clips.

**Why it happens:** No database indexes on profile_id columns.

**Prevention:**
```sql
-- Add indexes for dashboard queries (if not already present)
CREATE INDEX IF NOT EXISTS idx_editai_projects_profile_id
ON editai_projects(profile_id);

CREATE INDEX IF NOT EXISTS idx_editai_clips_profile_id_created_at
ON editai_clips(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_costs_profile_id_created_at
ON api_costs(profile_id, created_at DESC);
```

**Dashboard query pattern:**
```python
# Efficient profile activity summary
@router.get("/profiles/{profile_id}/activity")
async def get_profile_activity(
    profile_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    supabase = get_supabase()

    # Video counts (uses idx_editai_projects_profile_id)
    projects_count = supabase.table("editai_projects")\
        .select("id", count="exact")\
        .eq("profile_id", profile_id)\
        .execute()

    clips_count = supabase.table("editai_clips")\
        .select("id", count="exact")\
        .eq("profile_id", profile_id)\
        .execute()

    # Cost summary (uses idx_api_costs_profile_id_created_at)
    tracker = get_cost_tracker()
    costs = tracker.get_summary(profile_id=profile_id)

    return {
        "profile_id": profile_id,
        "projects_count": projects_count.count,
        "clips_count": clips_count.count,
        "costs": costs
    }
```

**Warning signs:**
- Dashboard loads slowly (>2 seconds)
- Postgres query logs show sequential scans
- Database CPU usage spikes on dashboard access

**Confidence:** HIGH — Indexes are standard practice for multi-tenant apps.

---

## Code Examples

### Example 1: Per-Profile Postiz Publishing

```python
# app/api/postiz_routes.py
@router.post("/publish")
async def publish_clip(
    background_tasks: BackgroundTasks,
    request: PublishRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Publish a clip to profile's Postiz account.
    Each profile uses its own Postiz API credentials.
    """
    logger.info(f"[Profile {profile.profile_id}] Publishing clip {request.clip_id}")

    supabase = get_supabase()

    # Verify clip ownership
    clip = supabase.table("editai_clips")\
        .select("*, editai_projects!inner(profile_id)")\
        .eq("id", request.clip_id)\
        .single()\
        .execute()

    if not clip.data or clip.data["editai_projects"]["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=404, detail="Clip not found")

    # Get profile-specific Postiz publisher
    try:
        publisher = get_postiz_publisher(profile.profile_id)
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Postiz not configured for this profile. {e}"
        )

    # Verify Postiz connectivity
    try:
        await publisher.get_integrations(profile_id=profile.profile_id)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to connect to Postiz: {e}"
        )

    # Queue background task
    job_id = uuid.uuid4().hex[:12]
    background_tasks.add_task(
        _publish_clip_task,
        job_id=job_id,
        clip_id=request.clip_id,
        profile_id=profile.profile_id,
        video_path=clip.data["final_video_path"],
        caption=request.caption,
        integration_ids=request.integration_ids
    )

    return {"status": "processing", "job_id": job_id}

async def _publish_clip_task(
    job_id: str,
    clip_id: str,
    profile_id: str,
    video_path: str,
    caption: str,
    integration_ids: List[str]
):
    """Background task uses profile-specific Postiz instance."""
    logger.info(f"[Profile {profile_id}] Publishing clip {clip_id} (job {job_id})")

    try:
        # Get profile's Postiz publisher
        publisher = get_postiz_publisher(profile_id)

        # Upload and publish using profile's Postiz account
        media = await publisher.upload_video(Path(video_path), profile_id=profile_id)
        result = await publisher.create_post(
            media_id=media.id,
            media_path=media.path,
            caption=caption,
            integration_ids=integration_ids,
            profile_id=profile_id
        )

        if result.success:
            logger.info(f"[Profile {profile_id}] Published successfully: {result.post_id}")
        else:
            logger.error(f"[Profile {profile_id}] Publishing failed: {result.error}")

    except Exception as e:
        logger.error(f"[Profile {profile_id}] Publishing failed: {e}")
```

**Source:** Based on existing `postiz_routes.py` patterns with profile-aware publisher.

**Confidence:** HIGH — Aligns with existing route/background task structure.

---

### Example 2: Quota Enforcement Before TTS

```python
# app/api/routes.py (TTS generation endpoint)
@router.post("/tts/generate")
async def generate_tts_audio(
    background_tasks: BackgroundTasks,
    request: TTSGenerationRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Generate TTS audio with quota enforcement.
    """
    logger.info(f"[Profile {profile.profile_id}] TTS generation requested")

    # Load profile quota
    supabase = get_supabase()
    profile_data = supabase.table("profiles")\
        .select("monthly_quota_usd, tts_settings")\
        .eq("id", profile.profile_id)\
        .single()\
        .execute()

    if not profile_data.data:
        raise HTTPException(status_code=404, detail="Profile not found")

    monthly_quota = profile_data.data.get("monthly_quota_usd", 0)

    # Check quota if set (0 = unlimited)
    if monthly_quota > 0:
        tracker = get_cost_tracker()
        costs = tracker.get_summary(profile_id=profile.profile_id)
        current_total = costs.get("total_all", 0)

        if current_total >= monthly_quota:
            raise HTTPException(
                status_code=402,  # Payment Required
                detail={
                    "error": "quota_exceeded",
                    "message": f"Profile has exceeded monthly quota of ${monthly_quota:.2f}",
                    "current_costs": current_total,
                    "quota": monthly_quota
                }
            )

        # Warn if close to quota (90%)
        if current_total >= monthly_quota * 0.9:
            logger.warning(
                f"[Profile {profile.profile_id}] Close to quota: "
                f"${current_total:.2f} / ${monthly_quota:.2f}"
            )

    # Proceed with TTS generation
    job_id = uuid.uuid4().hex[:12]
    background_tasks.add_task(
        _generate_tts_task,
        job_id=job_id,
        profile_id=profile.profile_id,
        text=request.text,
        provider=profile_data.data["tts_settings"]["provider"]
    )

    return {"status": "processing", "job_id": job_id}
```

**Source:** Custom logic for quota enforcement.

**Confidence:** HIGH — Standard quota check pattern.

---

### Example 3: Profile Activity Dashboard

```python
# app/api/profiles_routes.py (new endpoint)
@router.get("/profiles/{profile_id}/dashboard")
async def get_profile_dashboard(
    profile_id: str,
    profile: ProfileContext = Depends(get_profile_context),
    time_range: str = Query("30d", regex="^(7d|30d|90d|all)$")
):
    """
    Get profile activity dashboard data.
    Shows video counts, API costs, recent activity.
    """
    # Verify ownership
    if profile.profile_id != profile_id:
        raise HTTPException(status_code=403, detail="Access denied")

    supabase = get_supabase()

    # Calculate date filter
    from datetime import datetime, timedelta
    now = datetime.now()
    if time_range == "7d":
        start_date = now - timedelta(days=7)
    elif time_range == "30d":
        start_date = now - timedelta(days=30)
    elif time_range == "90d":
        start_date = now - timedelta(days=90)
    else:
        start_date = None  # All time

    # Video counts
    projects = supabase.table("editai_projects")\
        .select("id", count="exact")\
        .eq("profile_id", profile_id)

    if start_date:
        projects = projects.gte("created_at", start_date.isoformat())

    projects_result = projects.execute()

    clips = supabase.table("editai_clips")\
        .select("id, final_status", count="exact")\
        .eq("profile_id", profile_id)

    if start_date:
        clips = clips.gte("created_at", start_date.isoformat())

    clips_result = clips.execute()

    # Count rendered clips
    rendered_count = len([c for c in clips_result.data if c.get("final_status") == "completed"])

    # API costs
    tracker = get_cost_tracker()
    costs = tracker.get_summary(profile_id=profile_id)

    # Recent activity (last 10 clips)
    recent_clips = supabase.table("editai_clips")\
        .select("id, created_at, final_status, thumbnail_path")\
        .eq("profile_id", profile_id)\
        .order("created_at", desc=True)\
        .limit(10)\
        .execute()

    return {
        "profile_id": profile_id,
        "time_range": time_range,
        "stats": {
            "projects_count": projects_result.count,
            "clips_count": clips_result.count,
            "rendered_count": rendered_count
        },
        "costs": {
            "elevenlabs": costs.get("totals", {}).get("elevenlabs", 0),
            "gemini": costs.get("totals", {}).get("gemini", 0),
            "total": costs.get("total_all", 0)
        },
        "recent_clips": recent_clips.data
    }
```

**Source:** Custom dashboard aggregation logic.

**Confidence:** HIGH — Uses existing database schema and cost tracking.

---

## State of the Art

### Current Approach vs Modern Best Practices

| Aspect | Current (Pre-Phase 5) | Phase 5 Target | Industry Standard |
|--------|----------------------|----------------|-------------------|
| Credential storage | Global env vars | Per-profile JSONB | AWS Secrets Manager / HashiCorp Vault |
| Service instantiation | Singleton | Profile-aware factory | Multi-tenant service architecture |
| Quota enforcement | None | Pre-call check | Usage-based billing with hard limits |
| Activity tracking | Global | Per-profile | Multi-tenant analytics dashboards |

**Deprecated/outdated:**
- **Global singleton services** — Modern SaaS apps use tenant-scoped service instances
- **Environment-only credentials** — Best practice is database-stored, encrypted credentials with key rotation
- **No quota enforcement** — Industry standard is proactive quota checks with grace period warnings

**Phase 5 modernization:**
- Moves from global singleton to profile-aware factory (mid-tier modernization)
- Stores credentials in database (JSONB) rather than env-only (better, but not encrypted)
- Adds basic quota enforcement (good enough for MVP, can enhance later)

**Future enhancements (post-Phase 5):**
- Credential encryption at application level (beyond Supabase at-rest encryption)
- API key rotation support (revoke old keys, issue new ones)
- Advanced quota features (soft limits, email warnings, auto-suspend)
- Per-profile rate limiting (prevent profile from overwhelming Postiz API)

**Confidence:** MEDIUM — Phase 5 implements "good enough" patterns. Full enterprise-grade credential management deferred.

---

## Open Questions

### 1. Postiz API Rate Limits Per Account

**What we know:** Postiz API has rate limits, but limits per API key are undocumented in search results.

**What's unclear:** If Profile A and Profile B use different Postiz API keys, do they get separate rate limit buckets?

**Recommendation:**
- **Assume separate rate limits per API key** (standard for multi-tenant APIs)
- **Add rate limit handling** in PostizPublisher (catch 429 errors, retry with backoff)
- **Log rate limit hits** to identify if profiles need higher-tier Postiz plans

**Impact:** Low — If rate limits are shared across keys (unlikely), would need request queuing.

**Confidence:** MEDIUM — Search results mention rate limits exist but don't specify per-key isolation.

---

### 2. Credential Validation on Save

**What we know:** Frontend should validate Postiz credentials before saving to database.

**What's unclear:** Best UX pattern — validate on blur, on submit, or separate "Test Connection" button?

**Recommendation:**
- **Separate "Test Connection" button** (explicit action)
- **Call backend `/postiz/test-credentials` endpoint** with temp credentials
- **Show success/error toast** with specific error message

**Alternative:** Validate on submit (simpler, but less clear feedback)

**Impact:** Medium — Affects user experience when configuring Postiz.

**Confidence:** LOW — UX pattern choice requires user testing.

---

### 3. Quota Reset Logic

**What we know:** Phase 5 success criteria mentions "cost quota enforcement" but doesn't specify reset frequency.

**What's unclear:**
- Monthly quota = calendar month or rolling 30 days?
- Reset automatically or require manual intervention?
- Carry over unused quota or reset to zero?

**Recommendation:**
- **Calendar month reset** (1st of each month at 00:00 UTC)
- **Automatic reset** via daily cron job or database trigger
- **Zero carryover** (unused quota doesn't roll over)

**Implementation:**
```sql
-- Option 1: Add reset tracking to profiles table
ALTER TABLE profiles ADD COLUMN quota_reset_at TIMESTAMP DEFAULT NOW();

-- Option 2: Add monthly costs cache for fast quota checks
CREATE TABLE profile_monthly_costs (
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  month DATE NOT NULL,  -- First day of month
  total_cost_usd DECIMAL(10, 4) DEFAULT 0,
  PRIMARY KEY (profile_id, month)
);
```

**Impact:** High — Affects billing/quota enforcement accuracy.

**Confidence:** LOW — Requires product decision (calendar vs rolling, carryover vs reset).

---

## Sources

### Primary (HIGH confidence)
- **Codebase analysis**: Direct examination of `app/services/postiz_service.py`, `app/api/postiz_routes.py`, `app/services/cost_tracker.py`, Phase 2 research patterns
- **Phase 4 TTS patterns**: Successfully implemented per-profile TTS provider selection in `profiles.tts_settings` JSONB column

### Secondary (MEDIUM confidence)
- [Postiz API Documentation](https://docs.postiz.com/public-api) - Public API reference
- [Multi-Tenant Token Management Issue](https://github.com/gitroomhq/postiz-app/issues/975) - Postiz multi-tenant feature requests
- [Support Multiple Twitter/X API Credentials](https://github.com/gitroomhq/postiz-app/issues/1016) - Platform-specific multi-account limitations
- [Building Multi-Tenant SaaS in Django 2026](https://medium.com/@yogeshkrishnanseeniraj/building-a-multi-tenant-saas-in-django-complete-2026-architecture-e956e9f5086a) - Modern multi-tenant architecture patterns
- [Designing Secure Tenant Isolation in Python](https://www.jit.io/blog/designing-secure-tenant-isolation-in-python-for-serverless-apps) - Python multi-tenant credential patterns

### Tertiary (LOW confidence)
- WebSearch results on Postiz authentication (limited specific documentation on per-key rate limits)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new dependencies, uses existing patterns)
- Architecture patterns: HIGH (factory pattern proven in Phase 4)
- Database schema: HIGH (extends existing tts_settings JSONB)
- Pitfalls: HIGH (based on common multi-tenant issues)
- Quota logic: MEDIUM (requires product decisions on reset frequency)

**Research date:** 2026-02-04
**Valid until:** 60 days (stable patterns, minimal API changes expected)

**Key dependencies:**
- Phase 2 completion (profile context injection)
- Phase 3 completion (Settings page exists)
- Phase 4 completion (TTS provider pattern established)

**Phase 5 ready for planning.**
