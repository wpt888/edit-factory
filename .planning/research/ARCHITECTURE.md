# Architecture Patterns: Profile/Workspace System

**Domain:** Multi-profile isolation for video production platform
**Researched:** 2026-02-03
**Confidence:** HIGH

## Executive Summary

Adding profile/workspace isolation to an existing FastAPI + Next.js + Supabase application requires a tenant-scoped architecture using Supabase Row-Level Security (RLS) with a `profile_id` column pattern. The architecture must maintain backward compatibility while introducing profile context at the database, API, and frontend layers.

**Key Architectural Decision:** Use shared tables with `profile_id` foreign keys and RLS policies rather than schema-per-tenant approach. This matches Supabase best practices for 2-10 tenant scenarios where data models are consistent across tenants.

## Recommended Architecture

### Three-Layer Profile Context Propagation

```
Frontend (Next.js)
  ├─ ProfileProvider Context (selected profile_id)
  │  └─ Wraps all authenticated pages
  └─ API calls include profile_id in request context
      ↓
API Layer (FastAPI)
  ├─ Profile middleware extracts profile_id from request
  ├─ Validates user owns this profile
  └─ Passes profile_id to service layer
      ↓
Database Layer (Supabase)
  ├─ RLS policies filter by profile_id
  └─ Indexes on (user_id, profile_id) for performance
```

### Data Model Changes

#### New Tables

**1. profiles**
```sql
CREATE TABLE profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    name TEXT NOT NULL,
    description TEXT,

    -- TTS Voice Presets (profile-specific)
    default_tts_provider TEXT DEFAULT 'elevenlabs',  -- 'elevenlabs' | 'edge'
    elevenlabs_voice_id TEXT,
    edge_tts_voice TEXT,
    tts_model TEXT,

    -- Postiz Configuration (profile-specific)
    postiz_integration_ids JSONB DEFAULT '[]',  -- Selected platforms for this profile
    default_caption_template TEXT,
    default_schedule_time TIME,

    -- Metadata
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraint: user can only have one default profile
    CONSTRAINT one_default_per_user EXCLUDE (user_id WITH =) WHERE (is_default = true)
);

CREATE INDEX idx_profiles_user_id ON profiles(user_id);
CREATE INDEX idx_profiles_user_default ON profiles(user_id, is_default);
```

**2. profile_postiz_configs** (optional, if more structure needed)
```sql
CREATE TABLE profile_postiz_configs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    integration_id TEXT NOT NULL,  -- Postiz integration ID
    platform_type TEXT NOT NULL,   -- 'instagram', 'tiktok', etc.

    -- Platform-specific settings
    settings JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(profile_id, integration_id)
);

CREATE INDEX idx_postiz_config_profile ON profile_postiz_configs(profile_id);
```

#### Schema Changes to Existing Tables

**projects**
```sql
ALTER TABLE editai_projects
ADD COLUMN profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

-- Backfill for existing data: create default profile for each user
-- Migration script creates one default profile per user_id
-- and assigns all existing projects to that default profile

CREATE INDEX idx_projects_profile_id ON editai_projects(profile_id);
CREATE INDEX idx_projects_user_profile ON editai_projects(user_id, profile_id);
```

**clips** (inherits profile_id from project)
```sql
-- No schema change needed — clips inherit profile context via project_id FK
-- RLS policies will join through projects table
```

**api_costs** (optional: track costs per profile)
```sql
ALTER TABLE api_costs
ADD COLUMN profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_costs_profile ON api_costs(profile_id);
```

### Component Boundaries

| Component | Responsibility | Communicates With | Profile Context |
|-----------|---------------|-------------------|-----------------|
| ProfileProvider (Frontend) | Manage selected profile state, provide context to child components | All authenticated pages, API client | Stores `selectedProfileId` in React Context |
| ProfileSelector (Frontend) | UI for switching profiles | ProfileProvider, Supabase profiles table | Reads user's profiles, updates context |
| Profile Middleware (Backend) | Extract/validate profile_id from requests | All API routes requiring profile isolation | Adds `profile_id` to request state |
| Profile Service (Backend) | CRUD for profiles, validate ownership | Profile routes, other services | Returns profiles for user_id |
| RLS Policies (Database) | Enforce data isolation at DB level | All tables with profile_id | Filters rows by `profile_id` |

### Data Flow

#### Profile Selection Flow (Frontend)

```typescript
User logs in
  → AuthProvider fetches user.id
  → ProfileProvider queries profiles where user_id = auth.uid()
  → If user has profiles:
      → Load last_selected_profile from localStorage
      → Or default to profile where is_default = true
      → Set selectedProfile in context
  → If no profiles exist:
      → Create default profile automatically
      → Set as selected

User switches profile via ProfileSelector
  → ProfileSelector updates ProfileProvider.setSelectedProfile(newProfileId)
  → Context re-renders all consumers
  → Save selectedProfileId to localStorage
  → API calls now include new profile_id
```

#### API Request Flow (Backend)

```python
# Without profile isolation (current)
@router.get("/library/projects")
async def get_projects(user: User = Depends(get_current_user)):
    # RLS filters by user_id only
    projects = supabase.table("editai_projects").select("*").execute()
    return projects

# With profile isolation (new)
@router.get("/library/projects")
async def get_projects(
    profile_id: str = Depends(get_current_profile),
    user: User = Depends(get_current_user)
):
    # RLS filters by both user_id AND profile_id
    projects = supabase.table("editai_projects") \
        .select("*") \
        .eq("profile_id", profile_id) \
        .execute()
    return projects
```

#### Profile Context Dependency

```python
# app/api/dependencies.py (new file)
from fastapi import Depends, Header, HTTPException
from typing import Optional

async def get_current_profile(
    x_profile_id: Optional[str] = Header(None),
    user: User = Depends(get_current_user)
) -> str:
    """
    Extract and validate profile_id from request headers.
    Ensures user owns this profile.
    """
    if not x_profile_id:
        raise HTTPException(
            status_code=400,
            detail="X-Profile-Id header required"
        )

    # Verify user owns this profile
    supabase = get_supabase()
    profile = supabase.table("profiles") \
        .select("id") \
        .eq("id", x_profile_id) \
        .eq("user_id", user.id) \
        .single() \
        .execute()

    if not profile.data:
        raise HTTPException(
            status_code=403,
            detail="Profile not found or access denied"
        )

    return x_profile_id
```

## Patterns to Follow

### Pattern 1: Profile-Aware API Client (Frontend)

**What:** Inject profile_id into all API requests automatically via context.

**When:** All authenticated API calls that touch profile-scoped data.

**Example:**
```typescript
// frontend/src/lib/api.ts
import { useProfile } from '@/contexts/ProfileContext';

export const useApiWithProfile = () => {
  const { selectedProfileId } = useProfile();

  const apiPost = async (endpoint: string, data: any) => {
    return fetch(`/api/v1${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Profile-Id': selectedProfileId,  // Inject profile context
      },
      body: JSON.stringify(data),
    });
  };

  return { apiPost, apiGet: /* similar */ };
};
```

### Pattern 2: RLS with Subquery Caching (Database)

**What:** Use `(SELECT auth.uid())` wrapper for 94% performance improvement.

**When:** All RLS policies on profile-scoped tables.

**Example:**
```sql
-- Projects table RLS
CREATE POLICY "Users can view projects in owned profiles"
ON editai_projects FOR SELECT
USING (
  profile_id IN (
    SELECT id FROM profiles
    WHERE user_id = (SELECT auth.uid())
  )
);

-- Clips table RLS (inherit from project)
CREATE POLICY "Users can view clips in owned profiles"
ON editai_clips FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM editai_projects p
    JOIN profiles pr ON pr.id = p.profile_id
    WHERE p.id = editai_clips.project_id
    AND pr.user_id = (SELECT auth.uid())
  )
);
```

### Pattern 3: Profile Context Provider (Frontend)

**What:** React Context providing profile state to all components.

**When:** Wrap all authenticated pages.

**Example:**
```typescript
// frontend/src/contexts/ProfileContext.tsx
import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Profile {
  id: string;
  name: string;
  is_default: boolean;
}

interface ProfileContextType {
  profiles: Profile[];
  selectedProfileId: string | null;
  selectProfile: (profileId: string) => void;
  loading: boolean;
}

const ProfileContext = createContext<ProfileContextType>(null!);

export const ProfileProvider = ({ children }: { children: React.ReactNode }) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('is_default', { ascending: false });

    if (data && data.length > 0) {
      setProfiles(data);

      // Load last selected or default
      const lastSelected = localStorage.getItem('selectedProfileId');
      const selected = lastSelected || data.find(p => p.is_default)?.id || data[0].id;
      setSelectedProfileId(selected);
    }
    setLoading(false);
  };

  const selectProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    localStorage.setItem('selectedProfileId', profileId);
  };

  return (
    <ProfileContext.Provider value={{ profiles, selectedProfileId, selectProfile, loading }}>
      {children}
    </ProfileContext.Provider>
  );
};

export const useProfile = () => useContext(ProfileContext);
```

### Pattern 4: Graceful Migration (Database)

**What:** Add profile_id as nullable first, backfill, then make non-null.

**When:** Migrating existing multi-user data to profile isolation.

**Example:**
```sql
-- Step 1: Add nullable profile_id column
ALTER TABLE editai_projects
ADD COLUMN profile_id UUID REFERENCES profiles(id);

-- Step 2: Create default profile for each existing user
INSERT INTO profiles (user_id, name, is_default)
SELECT DISTINCT user_id, 'Default Profile', true
FROM editai_projects
WHERE user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Step 3: Backfill projects with default profile
UPDATE editai_projects p
SET profile_id = (
  SELECT pr.id FROM profiles pr
  WHERE pr.user_id = p.user_id
  AND pr.is_default = true
  LIMIT 1
)
WHERE profile_id IS NULL;

-- Step 4: Make profile_id non-null (only after backfill verified)
-- ALTER TABLE editai_projects ALTER COLUMN profile_id SET NOT NULL;
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Profile ID in URL Path

**What:** Putting profile_id in REST URL like `/api/v1/profiles/{profile_id}/projects`.

**Why bad:**
- Verbose routing
- Requires path parameter extraction in every route
- Harder to compose middleware
- No consistency with other context (user_id not in path)

**Instead:** Use request header `X-Profile-Id` which middleware can extract uniformly.

### Anti-Pattern 2: Client-Side Only Filtering

**What:** Fetching all user's data and filtering by profile in frontend.

**Why bad:**
- Security risk: user sees other profiles' data momentarily
- Performance: fetching unnecessary data
- RLS bypassed: defeats database-level security

**Instead:** Always filter by profile_id at database level via RLS + explicit queries.

### Anti-Pattern 3: Global Postiz Config

**What:** Keeping Postiz API credentials in environment variables only.

**Why bad:**
- Can't have different platform accounts per profile
- Can't override settings for specific stores
- Violates profile isolation principle

**Instead:** Store per-profile Postiz integration IDs in profiles table, allowing different platform selections per profile.

### Anti-Pattern 4: Unauthenticated Profile Access

**What:** Allowing RLS policies to evaluate for `anon` role.

**Why bad:**
- Performance: policies run unnecessarily for public endpoints
- Security: exposes policy logic to unauthenticated users

**Instead:** Explicitly scope policies with `TO authenticated` role.

```sql
-- Bad
CREATE POLICY "profile_policy" ON profiles FOR SELECT
USING (user_id = auth.uid());

-- Good
CREATE POLICY "profile_policy" ON profiles FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id);
```

## Scalability Considerations

| Concern | At 2 profiles (current need) | At 10 profiles per user | At 100+ profiles per user |
|---------|------------------------------|------------------------|---------------------------|
| RLS Performance | Negligible overhead with indexes | <10ms query overhead | May need materialized views or denormalization |
| Profile Switching | Instant (React context update) | Instant | Instant |
| Data Migration | Manual backfill acceptable | Automated migration required | Background job with progress tracking |
| Storage | Shared tables optimal | Shared tables optimal | Consider schema-per-tenant if isolation critical |
| API Header Overhead | ~50 bytes per request | ~50 bytes per request | Same (UUID is fixed size) |

## Frontend Routing Implications

### Profile Selector Placement

**Location:** Navbar, visible on all authenticated pages.

**Behavior:**
- Shows current profile name
- Dropdown lists all user's profiles
- Switching immediately updates context
- No page reload needed (SPA behavior)

### URL Structure (No Change Needed)

**Current:** `/library`, `/segments`, `/usage`

**After profiles:** Same URLs, context determines which profile's data loads.

**Why:** Profile is request context, not routing context. Simpler than `/profiles/{id}/library`.

### Page-Level Profile Guards

```typescript
// frontend/src/app/library/page.tsx
'use client';

import { useProfile } from '@/contexts/ProfileContext';

export default function LibraryPage() {
  const { selectedProfileId, loading } = useProfile();

  if (loading) return <LoadingSpinner />;
  if (!selectedProfileId) return <CreateProfilePrompt />;

  // Normal page render with profile context
  return <LibraryView profileId={selectedProfileId} />;
}
```

## Build Order Dependencies

### Phase 1: Database Foundation
1. Create `profiles` table with RLS
2. Add `profile_id` to `editai_projects` (nullable)
3. Create default profiles for existing users
4. Backfill `profile_id` in projects
5. Create RLS policies for profile isolation
6. Add indexes on `(user_id, profile_id)`

**Blocker for:** All other phases. Must complete before API changes.

### Phase 2: Backend API Layer
1. Create `app/api/dependencies.py` with `get_current_profile()`
2. Create `app/api/profile_routes.py` for CRUD
3. Update existing routes to accept profile_id dependency
4. Update Postiz service to use profile-specific configs
5. Update TTS services to use profile voice presets

**Depends on:** Phase 1 (database schema must exist)
**Blocker for:** Phase 3 (frontend needs API endpoints)

### Phase 3: Frontend Context & UI
1. Create `ProfileContext` provider
2. Wrap authenticated pages with `ProfileProvider`
3. Create `ProfileSelector` component in navbar
4. Update API client to inject `X-Profile-Id` header
5. Add profile creation/editing UI

**Depends on:** Phase 2 (API routes must exist)
**Blocker for:** Phase 4 (migration needs UI)

### Phase 4: Data Migration & Cleanup
1. Verify all projects have `profile_id`
2. Make `profile_id` non-null in projects table
3. Add NOT NULL constraint to schema
4. Remove any legacy code bypassing profiles
5. Update documentation

**Depends on:** Phase 3 (users must be able to manage profiles)

## Performance Optimization Checklist

- [x] Index `user_id` on profiles table
- [x] Index `profile_id` on projects table
- [x] Composite index `(user_id, profile_id)` on projects
- [x] Wrap `auth.uid()` in SELECT for RLS
- [x] Add `TO authenticated` to all RLS policies
- [x] Use `.eq('profile_id', id)` in client queries for query planner hints
- [ ] Monitor slow query log for missing indexes
- [ ] Add materialized view for profile stats if needed

## Security Considerations

### RLS Defense-in-Depth

1. **Database Level:** RLS policies prevent cross-profile data access
2. **API Level:** `get_current_profile()` validates ownership
3. **Frontend Level:** ProfileProvider ensures UI consistency

**All three layers must be implemented.** RLS alone is insufficient if API accidentally bypasses it.

### Profile Ownership Validation

```python
# ALWAYS validate user owns profile before operations
async def validate_profile_ownership(profile_id: str, user_id: str) -> bool:
    result = supabase.table("profiles") \
        .select("id") \
        .eq("id", profile_id) \
        .eq("user_id", user_id) \
        .execute()
    return bool(result.data)
```

### Service Role Bypass Caution

The Supabase service role key bypasses RLS. When using service role:
- Only in backend code, never exposed to frontend
- Explicitly filter by `profile_id` in queries
- Log all service role operations for audit

## Sources

### High Confidence (Official Documentation)

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) - RLS patterns and performance best practices
- [Supabase RLS Performance Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv) - Optimization techniques with benchmark data
- [Next.js App Router](https://nextjs.org/docs/app) - App Router architecture and context patterns

### Medium Confidence (Community Best Practices)

- [Multi-tenant Applications with RLS on Supabase](https://www.antstack.com/blog/multi-tenant-applications-with-rls-on-supabase-postgress/) - Multi-tenancy implementation patterns
- [Building Multi-Panel Interfaces in Next.js Using Workspace-Based Architecture](https://medium.com/@ruhi.chandra14/building-multi-panel-interfaces-in-next-js-using-a-workspace-based-architecture-4209aefff972) - Workspace context management
- [FastAPI Best Practices](https://github.com/zhanymkanov/fastapi-best-practices) - FastAPI architecture patterns
- [Supabase Multi-Tenancy Simple and Fast](https://roughlywritten.substack.com/p/supabase-multi-tenancy-simple-and) - Practical implementation guide

### Research Methodology

- WebSearch queries verified with official documentation
- Existing codebase patterns examined (auth.py, library_routes.py)
- Current database schema reviewed (001_add_auth_and_rls.sql)
- Performance benchmarks from Supabase official guides
