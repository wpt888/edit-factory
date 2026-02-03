# Phase 3: Frontend Profile UI - Research

**Researched:** 2026-02-03
**Domain:** Next.js 16 App Router with React 19, Shadcn/UI components, profile management UI
**Confidence:** HIGH

## Summary

Phase 3 builds the frontend profile management UI to enable users to create, switch, and manage profiles from the navbar. The research examines React/Next.js patterns for the existing stack (Next.js 16, React 19, Radix UI primitives via Shadcn/UI) and identifies standard approaches for profile switching, state persistence, and header injection.

**Key findings:**

1. **Profile state management** — React Context + localStorage hybrid for persistence across sessions while maintaining UI reactivity
2. **Dropdown UI component** — Radix UI DropdownMenu already installed, supports RadioGroup pattern for profile switching
3. **API header injection** — Extend existing api.ts wrapper to inject X-Profile-Id header from profile context
4. **Dialog pattern** — Shadcn/UI Dialog component already available for "Create Profile" modal
5. **State scope** — Next.js 16 App Router prohibits global server-side stores, requires client-side state management

**Primary recommendation:** Use React Context Provider wrapping the app layout, synced with localStorage for persistence, with navbar consuming context via useContext hook. Extend existing api.ts helpers to auto-inject X-Profile-Id from context.

---

## Standard Stack

The existing codebase already includes all required libraries.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.1 | App Router framework | Official React framework, Server Components support |
| React | 19.2.1 | UI library | Latest stable with useEffectEvent, View Transitions |
| @radix-ui/react-dropdown-menu | 2.1.16 | Dropdown primitive | Accessible, keyboard navigation, battle-tested |
| @radix-ui/react-dialog | 1.1.15 | Modal dialogs | Accessible modals with focus management |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | 0.556.0 | Icon library | Already used in navbar (ChevronDown for dropdowns) |
| sonner | 2.0.7 | Toast notifications | Success/error feedback for profile operations |
| class-variance-authority | 0.7.1 | Component variants | Already used in button variants |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| React Context | Zustand/Redux | Overkill for single-domain state (profiles), adds bundle size |
| Radix UI | Headless UI / React Aria | Already installed and used throughout codebase |
| localStorage | sessionStorage | Loses profile selection on browser close (worse UX) |

**Installation:**
No new packages required. All dependencies already installed.

---

## Architecture Patterns

### Recommended Project Structure
```
frontend/src/
├── contexts/
│   └── profile-context.tsx    # ProfileProvider + useProfile hook
├── components/
│   ├── navbar.tsx             # Updated with ProfileSwitcher
│   ├── profile-switcher.tsx   # Dropdown menu component
│   └── create-profile-dialog.tsx  # Modal for creating new profile
└── lib/
    └── api.ts                 # Extended to inject X-Profile-Id header
```

### Pattern 1: React Context + localStorage Hybrid

**What:** Combine React Context for UI reactivity with localStorage for persistence across sessions.

**When to use:** When state needs to (1) be shared across multiple components, (2) persist across browser sessions, and (3) trigger re-renders on change.

**Why this pattern:**
- React Context alone doesn't persist on page reload
- localStorage alone doesn't trigger re-renders
- Combining both solves the profile switcher use case perfectly

**Example:**
```typescript
// Source: Verified pattern from https://dev.to/vikirobles/explaining-localstorage-and-provider-context-with-example-16h
// and https://medium.com/@sujatakulal_27970/usecontext-localstorage-f9bd8f1aec9f

"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface Profile {
  id: string;
  name: string;
  description?: string;
  is_default: boolean;
}

interface ProfileContextType {
  currentProfile: Profile | null;
  profiles: Profile[];
  setCurrentProfile: (profile: Profile) => void;
  setProfiles: (profiles: Profile[]) => void;
  isLoading: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [currentProfile, setCurrentProfileState] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const storedProfileId = localStorage.getItem("editai_current_profile_id");
    const storedProfiles = localStorage.getItem("editai_profiles");

    if (storedProfiles) {
      const parsed = JSON.parse(storedProfiles);
      setProfiles(parsed);

      if (storedProfileId) {
        const profile = parsed.find((p: Profile) => p.id === storedProfileId);
        if (profile) {
          setCurrentProfileState(profile);
        }
      }
    }

    setIsLoading(false);
  }, []);

  // Persist to localStorage on change
  const setCurrentProfile = (profile: Profile) => {
    setCurrentProfileState(profile);
    localStorage.setItem("editai_current_profile_id", profile.id);
  };

  // Update profiles list and sync localStorage
  const setProfilesWrapper = (newProfiles: Profile[]) => {
    setProfiles(newProfiles);
    localStorage.setItem("editai_profiles", JSON.stringify(newProfiles));
  };

  return (
    <ProfileContext.Provider
      value={{
        currentProfile,
        profiles,
        setCurrentProfile,
        setProfiles: setProfilesWrapper,
        isLoading,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error("useProfile must be used within ProfileProvider");
  }
  return context;
}
```

### Pattern 2: Radix UI DropdownMenu with RadioGroup

**What:** Use DropdownMenu.RadioGroup for mutually-exclusive profile selection in navbar dropdown.

**When to use:** When user needs to switch between multiple options (profiles) where only one can be active.

**Example:**
```typescript
// Source: Radix UI docs https://www.radix-ui.com/primitives/docs/components/dropdown-menu
// RadioGroup pattern verified at https://www.radix-ui.com/primitives/docs/components/dropdown-menu#with-radio-items

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown, Plus } from "lucide-react";
import { useProfile } from "@/contexts/profile-context";

export function ProfileSwitcher() {
  const { currentProfile, profiles, setCurrentProfile } = useProfile();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2">
          {currentProfile?.name || "Select Profile"}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Switch Profile</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={currentProfile?.id}
          onValueChange={(profileId) => {
            const profile = profiles.find((p) => p.id === profileId);
            if (profile) setCurrentProfile(profile);
          }}
        >
          {profiles.map((profile) => (
            <DropdownMenuRadioItem key={profile.id} value={profile.id}>
              {profile.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => {/* Open create dialog */}}>
          <Plus className="h-4 w-4 mr-2" />
          Create New Profile
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### Pattern 3: API Client Header Injection

**What:** Extend existing api.ts helpers to automatically inject X-Profile-Id header from profile context.

**When to use:** Every authenticated API call that operates on profile-scoped resources.

**Example:**
```typescript
// Extended from existing api.ts pattern
// Source: Existing codebase frontend/src/lib/api.ts

import { useProfile } from "@/contexts/profile-context";

// Helper to get current profile ID (for use in components)
export function useApiWithProfile() {
  const { currentProfile } = useProfile();

  const apiPostWithProfile = async <T = unknown>(
    endpoint: string,
    body?: T,
    options: FetchOptions = {}
  ): Promise<Response> => {
    const headers = {
      ...options.headers,
      ...(currentProfile?.id && { "X-Profile-Id": currentProfile.id }),
    };

    return apiPost(endpoint, body, { ...options, headers });
  };

  const apiGetWithProfile = async (
    endpoint: string,
    options: FetchOptions = {}
  ): Promise<Response> => {
    const headers = {
      ...options.headers,
      ...(currentProfile?.id && { "X-Profile-Id": currentProfile.id }),
    };

    return apiGet(endpoint, { ...options, headers });
  };

  // Similar for apiPatch, apiPut, apiDelete

  return { apiPostWithProfile, apiGetWithProfile };
}
```

**Alternative pattern (global header injection):**
```typescript
// Modify apiFetch to always inject X-Profile-Id from localStorage
// Simpler but couples API client to profile context

export async function apiFetch(
  endpoint: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { headers: customHeaders, ...restOptions } = options;

  // Read current profile from localStorage
  const profileId = localStorage.getItem("editai_current_profile_id");

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(profileId && { "X-Profile-Id": profileId }), // Auto-inject
    ...customHeaders,
  };

  const url = endpoint.startsWith("http") ? endpoint : `${API_URL}${endpoint}`;

  return fetch(url, {
    ...restOptions,
    headers,
  });
}
```

### Pattern 4: Dialog for Create Profile

**What:** Use existing Shadcn/UI Dialog component for "Create New Profile" modal.

**When to use:** User clicks "Create New Profile" from dropdown menu.

**Example:**
```typescript
// Source: Existing codebase pattern from ui/dialog.tsx

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useProfile } from "@/contexts/profile-context";
import { apiPost } from "@/lib/api";
import { toast } from "sonner";

export function CreateProfileDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const { setProfiles } = useProfile();

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Profile name is required");
      return;
    }

    setLoading(true);
    try {
      const res = await apiPost("/profiles", { name, description });

      if (res.ok) {
        const newProfile = await res.json();
        toast.success("Profile created successfully");

        // Refresh profiles list
        const profilesRes = await apiGet("/profiles");
        if (profilesRes.ok) {
          const profiles = await profilesRes.json();
          setProfiles(profiles);
        }

        onOpenChange(false);
        setName("");
        setDescription("");
      } else {
        const error = await res.json();
        toast.error(error.detail || "Failed to create profile");
      }
    } catch (error) {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Profile Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Personal, Work, Client X"
            />
          </div>
          <div>
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={loading}>
              {loading ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### Pattern 5: Profile Loading on Mount

**What:** Fetch user's profiles from API on app mount and auto-select last-used or default.

**When to use:** App initialization in root layout or ProfileProvider.

**Example:**
```typescript
// In ProfileProvider component

useEffect(() => {
  async function initializeProfiles() {
    setIsLoading(true);

    try {
      // Fetch all profiles for current user
      const res = await apiGet("/profiles");

      if (res.ok) {
        const fetchedProfiles: Profile[] = await res.json();
        setProfiles(fetchedProfiles);
        localStorage.setItem("editai_profiles", JSON.stringify(fetchedProfiles));

        // Auto-select profile
        const storedProfileId = localStorage.getItem("editai_current_profile_id");
        let profileToSelect: Profile | null = null;

        if (storedProfileId) {
          // Try to restore last-used profile
          profileToSelect = fetchedProfiles.find(p => p.id === storedProfileId) || null;
        }

        if (!profileToSelect) {
          // Fall back to default profile
          profileToSelect = fetchedProfiles.find(p => p.is_default) || fetchedProfiles[0] || null;
        }

        if (profileToSelect) {
          setCurrentProfile(profileToSelect);
        }
      }
    } catch (error) {
      console.error("Failed to fetch profiles:", error);
    } finally {
      setIsLoading(false);
    }
  }

  initializeProfiles();
}, []); // Run once on mount
```

### Anti-Patterns to Avoid

- **Server-side profile state**: Next.js 16 App Router can handle multiple requests simultaneously. Global stores on server = data leak between users. Always use client-side state.
- **Fetching profiles on every page navigation**: Fetch once on mount, cache in context + localStorage. Only refetch after CRUD operations.
- **Prop drilling profile context**: Use React Context, not passing currentProfile through 5+ component layers.
- **Not handling loading state**: Profile switcher should show loading state during initial fetch to prevent flash of wrong content.
- **Ignoring backend auto-selection**: Backend auto-selects default profile if X-Profile-Id missing. Frontend should mirror this behavior (not send empty header).

---

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Accessible dropdown menu | Custom div with absolute positioning | Radix UI DropdownMenu (already installed) | Focus management, keyboard nav, ARIA attributes, portal rendering, collision detection |
| Modal dialogs | Custom overlay with z-index hacks | Radix UI Dialog (already installed) | Focus trap, scroll lock, ESC handling, accessibility |
| Toast notifications | Custom div animations | sonner (already installed) | Queuing, auto-dismiss, positioning, animations |
| State persistence | Manual localStorage + useState sync | Custom useLocalStorage hook | Handles SSR hydration, serialization, event listeners for multi-tab sync |
| Profile context propagation | Prop drilling or Redux | React Context API | Built-in, zero dependencies, perfect for single-domain state |

**Key insight:** Shadcn/UI already provides battle-tested, accessible components built on Radix UI primitives. Re-implementing dropdown menus or dialogs introduces accessibility bugs and increases bundle size.

---

## Common Pitfalls

### Pitfall 1: Context Re-render Performance

**What goes wrong:** Every component using `useProfile()` re-renders when ANY profile context value changes (currentProfile, profiles array, isLoading). This can cause unnecessary re-renders of the entire app if ProfileProvider wraps root layout.

**Why it happens:** React Context re-renders all consumers when context value changes, even if they only use one field.

**How to avoid:**
1. Split context into multiple contexts (ProfileStateContext, ProfileActionsContext) or use object reference stability
2. Memoize context value object to prevent re-renders on function recreation
3. Only subscribe to context in components that actually display profile data (navbar, library page)

**Warning signs:**
- Library page re-renders when switching profiles (expected)
- Unrelated pages also re-render (problem)
- DevTools show excessive renders in components not using profile data

**Example fix:**
```typescript
// Memoize context value to prevent unnecessary re-renders
const value = useMemo(
  () => ({
    currentProfile,
    profiles,
    setCurrentProfile,
    setProfiles: setProfilesWrapper,
    isLoading,
  }),
  [currentProfile, profiles, isLoading]
);

return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
```

**Source:** [React re-renders guide](https://www.developerway.com/posts/react-re-renders-guide) and [Avoid Context API mistakes](https://rohitkf.medium.com/avoid-this-common-mistake-with-react-context-api-prevent-unnecessary-re-renders-8ce11b4e1669)

### Pitfall 2: SSR Hydration Mismatch with localStorage

**What goes wrong:** Server renders with no profile data, client hydrates with profile from localStorage, causing React hydration mismatch errors.

**Why it happens:** localStorage is only available in browser (not during SSR). Server Component renders `null`, client renders profile name.

**How to avoid:**
1. Use `"use client"` directive for components reading localStorage
2. Show loading state until hydration complete (`isLoading` state)
3. Don't render profile-dependent content until client-side hydration finishes

**Warning signs:**
- Console errors: "Text content did not match. Server: '' Client: 'Personal Profile'"
- Flash of unstyled content (FOUC)
- Navbar briefly shows "Select Profile" before showing actual profile

**Example fix:**
```typescript
// In ProfileSwitcher component
const { currentProfile, isLoading } = useProfile();

if (isLoading) {
  return <Skeleton className="w-32 h-10" />; // Placeholder during hydration
}

return (
  <Button variant="outline">
    {currentProfile?.name || "Select Profile"}
  </Button>
);
```

### Pitfall 3: Stale Profile Data After CRUD

**What goes wrong:** User creates/deletes a profile, but dropdown still shows old list until page refresh.

**Why it happens:** Profile list cached in context + localStorage, not automatically refreshed after mutations.

**How to avoid:**
1. After CREATE: Refetch profiles list, append new profile to context
2. After DELETE: Remove profile from context, switch to default if deleted was current
3. After UPDATE: Update profile in context array

**Warning signs:**
- Created profile doesn't appear in dropdown
- Deleted profile still visible until refresh
- Profile name changes not reflected immediately

**Example fix:**
```typescript
// After successful profile creation
const newProfile = await res.json();

// Update context immediately
setProfiles((prev) => [...prev, newProfile]);

// Optionally switch to new profile
setCurrentProfile(newProfile);
```

### Pitfall 4: Missing Profile Header on First Load

**What goes wrong:** User loads app, profile context initializes async, first API calls go out without X-Profile-Id header.

**Why it happens:** Profile data fetched on mount (async), but other components may call APIs before context hydrates.

**How to avoid:**
1. Show loading spinner until profiles loaded
2. Defer API calls until `isLoading === false`
3. Backend auto-selects default profile if header missing (already implemented in Phase 2)

**Warning signs:**
- Backend logs show "Auto-selected default profile" on every page load
- First API call returns data from wrong profile
- Race condition between profile fetch and library page data fetch

**Example fix:**
```typescript
// In library page
const { currentProfile, isLoading } = useProfile();

useEffect(() => {
  if (isLoading) return; // Don't fetch until profile loaded

  async function fetchProjects() {
    const res = await apiGetWithProfile("/library/projects");
    // ...
  }

  fetchProjects();
}, [isLoading, currentProfile?.id]);
```

### Pitfall 5: Dropdown Closes on Profile Switch

**What goes wrong:** User clicks a profile in dropdown, dropdown closes before they can click "Create New Profile" or manage settings.

**Why it happens:** RadioItem selection triggers `onValueChange`, which updates state, causing parent component re-render and dropdown to close.

**How to avoid:** This is actually **expected behavior** for RadioGroup in dropdown menus. Separate "switch profile" action from "manage profiles" actions.

**Warning signs:**
- User frustration trying to create profile after switching
- UX feels clunky

**Example fix:**
```typescript
// Separate "quick switch" from "manage profiles"
<DropdownMenu>
  <DropdownMenuContent>
    {/* Quick switch - closes on select (expected) */}
    <DropdownMenuRadioGroup value={currentProfile?.id}>
      {profiles.map((profile) => (
        <DropdownMenuRadioItem key={profile.id} value={profile.id}>
          {profile.name}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>

    <DropdownMenuSeparator />

    {/* Management actions - open separate dialogs */}
    <DropdownMenuItem onClick={() => setCreateDialogOpen(true)}>
      Create New Profile
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => router.push("/settings/profiles")}>
      Manage Profiles
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

---

## Code Examples

Verified patterns from official sources:

### Example 1: Complete ProfileProvider with Persistence

```typescript
// Source: Combined pattern from localStorage + Context guides
// https://felixgerschau.com/react-localstorage/
// https://dev.to/vikirobles/explaining-localstorage-and-provider-context-with-example-16h

"use client";

import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from "react";
import { apiGet } from "@/lib/api";

interface Profile {
  id: string;
  name: string;
  description?: string;
  is_default: boolean;
  created_at: string;
}

interface ProfileContextType {
  currentProfile: Profile | null;
  profiles: Profile[];
  setCurrentProfile: (profile: Profile) => void;
  refreshProfiles: () => Promise<void>;
  isLoading: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

const STORAGE_KEYS = {
  PROFILE_ID: "editai_current_profile_id",
  PROFILES: "editai_profiles",
};

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [currentProfile, setCurrentProfileState] = useState<Profile | null>(null);
  const [profiles, setProfilesState] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch profiles from API
  const refreshProfiles = useCallback(async () => {
    try {
      const res = await apiGet("/profiles");

      if (res.ok) {
        const fetchedProfiles: Profile[] = await res.json();
        setProfilesState(fetchedProfiles);
        localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(fetchedProfiles));

        // Auto-select if no current profile
        if (!currentProfile) {
          const storedId = localStorage.getItem(STORAGE_KEYS.PROFILE_ID);
          const profileToSelect =
            fetchedProfiles.find(p => p.id === storedId) ||
            fetchedProfiles.find(p => p.is_default) ||
            fetchedProfiles[0] ||
            null;

          if (profileToSelect) {
            setCurrentProfileState(profileToSelect);
            localStorage.setItem(STORAGE_KEYS.PROFILE_ID, profileToSelect.id);
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch profiles:", error);
    }
  }, [currentProfile]);

  // Initialize on mount
  useEffect(() => {
    async function initialize() {
      setIsLoading(true);

      // Try to hydrate from localStorage first (instant UI)
      const storedProfiles = localStorage.getItem(STORAGE_KEYS.PROFILES);
      const storedProfileId = localStorage.getItem(STORAGE_KEYS.PROFILE_ID);

      if (storedProfiles) {
        try {
          const parsed: Profile[] = JSON.parse(storedProfiles);
          setProfilesState(parsed);

          if (storedProfileId) {
            const profile = parsed.find(p => p.id === storedProfileId);
            if (profile) setCurrentProfileState(profile);
          }
        } catch (e) {
          console.error("Failed to parse stored profiles:", e);
        }
      }

      // Then fetch fresh data from API
      await refreshProfiles();
      setIsLoading(false);
    }

    initialize();
  }, []); // Only run once on mount

  // Persist profile change to localStorage
  const setCurrentProfile = useCallback((profile: Profile) => {
    setCurrentProfileState(profile);
    localStorage.setItem(STORAGE_KEYS.PROFILE_ID, profile.id);
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo(
    () => ({
      currentProfile,
      profiles,
      setCurrentProfile,
      refreshProfiles,
      isLoading,
    }),
    [currentProfile, profiles, isLoading, setCurrentProfile, refreshProfiles]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error("useProfile must be used within ProfileProvider");
  }
  return context;
}
```

### Example 2: Navbar with Profile Switcher

```typescript
// Source: Existing navbar.tsx pattern + Radix UI docs
// https://www.radix-ui.com/primitives/docs/components/dropdown-menu

"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ProfileSwitcher } from "@/components/profile-switcher";
import { useProfile } from "@/contexts/profile-context";

const navLinks = [
  { label: "Librărie", href: "/librarie" },
  { label: "Export", href: "/library" },
  { label: "Segments", href: "/segments" },
  { label: "Usage", href: "/usage" },
];

export function NavBar() {
  const { currentProfile, isLoading } = useProfile();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/librarie" className="flex items-center">
            <span className="text-xl md:text-2xl font-bold text-primary">
              EditAI
            </span>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right side - Profile Switcher */}
          <div className="flex items-center gap-3">
            {!isLoading && <ProfileSwitcher />}
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {currentProfile?.name || "No Profile"}
            </Badge>
          </div>
        </div>
      </div>
    </header>
  );
}
```

### Example 3: API Helper with Auto Header Injection

```typescript
// Source: Existing api.ts extended with profile header injection

import { useProfile } from "@/contexts/profile-context";

// Option 1: Hook-based approach (for components)
export function useApiWithProfile() {
  const { currentProfile } = useProfile();

  const headers = currentProfile?.id
    ? { "X-Profile-Id": currentProfile.id }
    : {};

  return {
    apiGet: (endpoint: string, options?: FetchOptions) =>
      apiGet(endpoint, { ...options, headers: { ...options?.headers, ...headers } }),

    apiPost: <T = unknown>(endpoint: string, body?: T, options?: FetchOptions) =>
      apiPost(endpoint, body, { ...options, headers: { ...options?.headers, ...headers } }),

    // ... similar for apiPatch, apiPut, apiDelete
  };
}

// Option 2: Global approach (modify existing apiFetch)
export async function apiFetch(
  endpoint: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { headers: customHeaders, ...restOptions } = options;

  // Auto-inject profile ID from localStorage if available
  const profileId = typeof window !== "undefined"
    ? localStorage.getItem("editai_current_profile_id")
    : null;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(profileId && { "X-Profile-Id": profileId }),
    ...customHeaders, // Custom headers can override
  };

  const url = endpoint.startsWith("http") ? endpoint : `${API_URL}${endpoint}`;

  return fetch(url, {
    ...restOptions,
    headers,
  });
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Redux for all state | React Context for domain-specific state | React 16.3 (2018) + App Router | Simpler setup, less boilerplate for profile state |
| Custom dropdown with divs | Radix UI primitives | 2020-2021 | Accessibility, keyboard nav, focus management built-in |
| Pages Router with getServerSideProps | App Router with Server Components | Next.js 13 (2022), stable in 14 | No global server state allowed (multi-request concurrency) |
| Class components for context | Function components + hooks | React 16.8 (2019) | Cleaner code, easier composition |
| Manual localStorage sync | useLocalStorage hooks or hybrid patterns | 2020+ | Handles SSR hydration, multi-tab sync |

**Deprecated/outdated:**
- **Pages Router `getServerSideProps` for user state**: App Router uses Server Components, but client state (like profiles) must be in "use client" components
- **Redux Toolkit for simple state**: Overkill for single-domain state like profile switching, React Context is sufficient
- **Direct DOM manipulation for dropdowns**: Radix UI handles portal rendering, positioning, and accessibility

---

## Open Questions

Things that couldn't be fully resolved:

1. **Should profile creation require email confirmation or admin approval?**
   - What we know: Backend Phase 2 allows unrestricted profile creation
   - What's unclear: Business logic around profile limits per user
   - Recommendation: Start with unlimited profiles, add limits in future phase if needed

2. **How to handle profile deletion when user has only one profile?**
   - What we know: Backend prevents deleting default profile
   - What's unclear: Should UI hide delete button for last profile? Show disabled state?
   - Recommendation: Show delete button as disabled with tooltip "Cannot delete last profile"

3. **Should library page refetch data immediately when profile switches?**
   - What we know: Profile change should show different projects/clips
   - What's unclear: Performance tradeoff of immediate refetch vs manual refresh
   - Recommendation: Immediate refetch for better UX, add loading skeleton during fetch

4. **Multi-tab synchronization of profile changes?**
   - What we know: localStorage doesn't trigger events in same tab
   - What's unclear: Should profile creation in Tab A immediately update Tab B?
   - Recommendation: Use `storage` event listener for multi-tab sync (MEDIUM priority, defer to Phase 4)

---

## Sources

### Primary (HIGH confidence)
- [Radix UI Dropdown Menu Docs](https://www.radix-ui.com/primitives/docs/components/dropdown-menu) - RadioGroup pattern for profile switching
- [Next.js 16 App Router Docs](https://nextjs.org/docs/app) - Server vs client components, state management
- [React Context API Guide](https://blog.logrocket.com/react-context-api-deep-dive-examples/) - Context patterns and best practices
- Existing codebase:
  - `frontend/src/components/navbar.tsx` - Current navbar structure
  - `frontend/src/lib/api.ts` - API client patterns
  - `frontend/src/components/ui/dropdown-menu.tsx` - Radix UI wrapper components
  - `frontend/src/components/ui/dialog.tsx` - Dialog patterns
  - `frontend/package.json` - Installed dependencies (Next.js 16.1.1, React 19.2.1, Radix UI 2.x)

### Secondary (MEDIUM confidence)
- [Next.js State Management Patterns 2026](https://www.pronextjs.dev/tutorials/state-management) - App Router state patterns
- [React + localStorage Guide](https://felixgerschau.com/react-localstorage/) - Persistence patterns
- [localStorage + Context Example](https://dev.to/vikirobles/explaining-localstorage-and-provider-context-with-example-16h) - Combined pattern
- [Next.js 16 Route Handlers](https://strapi.io/blog/nextjs-16-route-handlers-explained-3-advanced-usecases) - Header injection patterns

### Tertiary (LOW confidence)
- [React re-renders guide](https://www.developerway.com/posts/react-re-renders-guide) - Performance optimization (general React, not Next.js 16 specific)
- [Context API re-render mistakes](https://rohitkf.medium.com/avoid-this-common-mistake-with-react-context-api-prevent-unnecessary-re-renders-8ce11b4e1669) - Common pitfalls (2024, still relevant)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All dependencies verified in package.json, versions confirmed
- Architecture patterns: HIGH - Patterns verified against official Radix UI and Next.js docs
- Context + localStorage hybrid: HIGH - Multiple authoritative sources confirm this pattern
- API header injection: HIGH - Straightforward extension of existing api.ts pattern
- Common pitfalls: MEDIUM - Based on community discussions and general React patterns, not specific to Next.js 16

**Research date:** 2026-02-03
**Valid until:** ~30 days (stable stack, unlikely to change rapidly)

**Key assumptions:**
- Backend Phase 2 is complete with working `/api/v1/profiles` CRUD endpoints
- Backend auto-selects default profile if X-Profile-Id header missing
- User already authenticated (Supabase Auth SDK in place)
- No profile-level permissions/RBAC yet (planned for later phases)
