# Phase 23: Feed Creation UI - Research

**Researched:** 2026-02-21
**Domain:** Frontend dialog component — React/Next.js, Shadcn/UI Dialog, apiPost
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FEED-01 | User can add a Google Shopping XML feed URL and sync product data | Backend POST /api/v1/feeds fully exists (verified in feed_routes.py). Frontend needs: (1) dialog component with name + feed_url inputs, (2) apiPost call, (3) optimistic feed list refresh, (4) first-time CTA replacing the current dead-end "Add a feed in Settings" text. |
</phase_requirements>

---

## Summary

Phase 23 is a small gap closure. The backend is 100% complete — `POST /api/v1/feeds` exists in `app/api/feed_routes.py`, accepts `{"name": str, "feed_url": str}` JSON, enforces profile scoping via `X-Profile-Id` header (already injected by `apiFetch`), and returns the created feed row. No backend work is needed.

The entire phase is a single frontend component: `CreateFeedDialog`. The existing `CreateProfileDialog` component (`frontend/src/components/create-profile-dialog.tsx`) is an almost perfect template — it uses `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter`, `Button`, `Input`, `Label`, `apiPost`, `toast`, and a callback-based refresh pattern. The new dialog follows the exact same structure with different fields and endpoint.

The products page (`frontend/src/app/products/page.tsx`) currently shows a dead-end message "No feeds configured. Add a feed in Settings." when `feeds.length === 0`. This must be replaced with a first-time CTA button that opens the new dialog. Additionally a "New Feed" button must be added to the feed selector bar for returning users.

**Primary recommendation:** Copy the `CreateProfileDialog` pattern verbatim, adapt for feed fields (`name`, `feed_url`), call `POST /feeds`, call `fetchFeeds()` on success, and wire a "New Feed" button in the products page feed bar. Total frontend change is approximately 50-60 lines across two files.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Radix UI Dialog (via Shadcn) | Already installed | Modal overlay | Already used in `create-profile-dialog.tsx` and `dialog.tsx` component |
| React `useState` | Built-in | Local form state (name, feed_url, loading) | Project uses local state only — no global state library |
| `apiPost` from `@/lib/api` | Project utility | POST /feeds with X-Profile-Id header auto-injection | All API calls use this wrapper |
| `toast` from `sonner` | Already installed | Success/error notifications | Used throughout products page and profile dialog |
| Lucide React icons | Already installed | UI icons (PlusCircle or Plus) | All icons in this project come from lucide-react |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Shadcn `Input`, `Label`, `Button` | Already installed | Form fields | Same as CreateProfileDialog — no new installs needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Controlled dialog (open/onOpenChange props) | Uncontrolled DialogTrigger | Controlled is correct here — products page owns open state so it can respond to close events and trigger refresh |
| Inline form in feed bar | Modal dialog | Dialog is consistent with CreateProfileDialog pattern and avoids layout shift in the feed bar |

**Installation:** No new packages needed. All dependencies already installed.

---

## Architecture Patterns

### Recommended Project Structure

The component goes in `frontend/src/components/` (same as `create-profile-dialog.tsx`):

```
frontend/src/components/
├── create-profile-dialog.tsx   (existing — reference pattern)
└── create-feed-dialog.tsx      (NEW — ~50 lines)

frontend/src/app/products/
└── page.tsx                    (MODIFIED — add dialog open state + New Feed button + first-time CTA)
```

### Pattern 1: Controlled Dialog with Callback Refresh

**What:** Dialog receives `open`, `onOpenChange`, and `onCreated` props. Products page owns the open state. On successful creation, `onCreated(newFeed)` is called so the page can optimistically prepend the feed to the list.

**When to use:** When the parent component needs to react to dialog outcomes (refresh list, auto-select new feed). Matches the `CreateProfileDialog` pattern exactly.

**Example (reference — from create-profile-dialog.tsx):**
```typescript
// Source: frontend/src/components/create-profile-dialog.tsx

interface CreateProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProfileDialog({ open, onOpenChange }: CreateProfileDialogProps) {
  const { refreshProfiles } = useProfile();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      toast.error("Feed name must be at least 2 characters");
      return;
    }
    setLoading(true);
    try {
      const response = await apiPost("/profiles/", { name: trimmedName });
      if (response.ok) {
        toast.success("Profile created successfully");
        await refreshProfiles();
        onOpenChange(false);
        setName("");
      } else {
        const error = await response.json();
        toast.error(error.detail || "Failed to create profile");
      }
    } catch {
      toast.error("An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create New Profile</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Profile Name <span className="text-destructive">*</span></Label>
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} disabled={loading} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleCreate} disabled={loading}>{loading ? "Creating..." : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Adaptation for CreateFeedDialog:**

```typescript
// frontend/src/components/create-feed-dialog.tsx (target implementation)

interface CreateFeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (feed: Feed) => void;  // Extra prop — products page uses this to refresh list
}

// Fields: name (required), feed_url (required)
// Endpoint: POST /feeds with { name, feed_url }
// On success: call onCreated(data), close dialog, reset form
// Validation: name >= 2 chars, feed_url must start with http
```

### Pattern 2: First-Time Empty State CTA

**What:** When `feeds.length === 0`, show an empty state with a prominent "Add Your First Feed" button that opens the dialog. Replace the current dead-end text message.

**Current code to replace (products/page.tsx line 408-412):**
```typescript
{feeds.length === 0 && (
  <span className="text-sm text-muted-foreground">
    No feeds configured. Add a feed in Settings.
  </span>
)}
```

**Target pattern:**
```typescript
{feeds.length === 0 && (
  <Button size="sm" onClick={() => setCreateFeedOpen(true)}>
    <PlusCircle className="h-4 w-4 mr-1" />
    Add Your First Feed
  </Button>
)}
```

Additionally, when `feeds.length === 0` and there is no selected feed, the main product grid empty state (currently "Select a feed to browse products") should also show the CTA or at least reference that the user can create one from the bar above.

### Pattern 3: Optimistic Feed List Update

**What:** After successful creation, call `fetchFeeds()` (already exists in products page) to re-fetch the list, then auto-select the new feed.

**Why:** The products page `fetchFeeds` already auto-selects the first feed if none is selected. So after a new feed is created (it will be at the top because feeds are ordered by `created_at desc`), calling `fetchFeeds()` will auto-select it. This means no extra logic is needed beyond calling `fetchFeeds()` and/or using the `onCreated` callback to immediately set the new feed.

**Alternative (more instant feel):** Pass `onCreated(newFeed)` — the dialog returns the created feed object and the page immediately prepends it to `feeds` state and sets it as selected, without waiting for a round-trip fetch. This is the recommended approach for snappy UX.

### Anti-Patterns to Avoid

- **Navigating to Settings for feed creation:** The current "Add a feed in Settings" message is the anti-pattern. Settings page should not be modified — the dialog lives on the products page.
- **Separate /feeds management page:** Overkill for this phase. The dialog on the products page is sufficient.
- **Form submission with `<form onSubmit>`:** Existing dialogs use `<Button onClick={handleCreate}>` pattern — keep consistent.
- **Refreshing entire page after creation:** Use optimistic state update + `fetchFeeds()` call. No page.reload().

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal overlay | Custom div with z-index tricks | Radix UI Dialog (already in `dialog.tsx`) | Focus trap, ESC key, aria-modal, backdrop click handled |
| Toast notifications | Alert div with timeout | `sonner` toast (already used) | Already imported and used in products page |
| Profile header injection | Manual header construction | `apiPost` from `@/lib/api` | Automatically injects `X-Profile-Id` from localStorage |

**Key insight:** Zero new infrastructure needed. This is a UI assembly task using all pre-existing building blocks.

---

## Common Pitfalls

### Pitfall 1: Not Resetting Form State on Close

**What goes wrong:** User opens dialog, types a name, cancels. Reopens — old text still in inputs.
**Why it happens:** `useState` persists across renders; state only resets if component unmounts.
**How to avoid:** Reset `name`, `feedUrl`, `loading` when dialog closes — either in `onOpenChange(false)` handler or via a `useEffect` on `open` changing to `false`.
**Warning signs:** Form shows stale data when opened a second time.

Reference from `CreateProfileDialog`:
```typescript
onOpenChange(false);
setName("");
setDescription("");
```

### Pitfall 2: URL Validation Being Too Strict

**What goes wrong:** Rejecting valid feed URLs because of strict regex; feeds can be HTTPS, HTTP, have query strings, etc.
**Why it happens:** Google Shopping XML feed URLs often have long query strings (e.g., `?country=RO&currency=RON`).
**How to avoid:** Use a simple `feedUrl.startsWith("http")` check rather than a full URL regex. The backend will fail with a meaningful error if the URL is unreachable.
**Warning signs:** Valid Nortia.ro or similar feed URLs getting rejected by the form.

### Pitfall 3: Not Auto-Selecting the New Feed

**What goes wrong:** User creates a feed, dialog closes, feed selector still shows empty/previous selection — user confused.
**Why it happens:** `fetchFeeds()` re-fetches but the auto-select logic only runs when `!selectedFeedId`.
**How to avoid:** Use the `onCreated(newFeed)` callback to immediately set `selectedFeedId` and `selectedFeed` in products page state before or alongside the fetch refresh.
**Warning signs:** After creation, user still sees "Select a feed to browse products" empty state.

### Pitfall 4: Duplicate "New Feed" Button Visibility

**What goes wrong:** Button shows even when `feeds.length > 0` but is hidden behind the feed selector, causing confusion.
**How to avoid:** The "New Feed" button should always be visible in the feed bar (after or before the selector), not conditional on feed count. The first-time CTA inside the bar is a separate message/button that replaces the dead-end text only when `feeds.length === 0`.

---

## Code Examples

Verified patterns from the existing codebase:

### Backend Endpoint Contract (from feed_routes.py)

```python
# Source: app/api/feed_routes.py line 44-48, 138-155

class FeedCreate(BaseModel):
    name: str
    feed_url: str

@router.post("")
async def create_feed(body: FeedCreate, profile: ProfileContext = Depends(get_profile_context)):
    # Profile scoping via X-Profile-Id header (injected by apiFetch automatically)
    result = supabase.table("product_feeds").insert({
        "profile_id": profile.profile_id,
        "name": body.name,
        "feed_url": body.feed_url,
    }).execute()
    return result.data[0]  # Returns the created feed row
```

**API call from frontend:**
```typescript
const response = await apiPost("/feeds", { name: trimmedName, feedUrl: trimmedFeedUrl });
// Note: backend field is "feed_url" (snake_case)
const newFeed = await response.json();  // Returns full feed object with id, sync_status, etc.
```

### Feed Bar Button Placement (in products/page.tsx)

The feed selector bar is at lines 354-413. Current structure:
```
[Tag icon] [Select dropdown] [sync badge] [product count] [Re-sync button]
                                            ↑ only when selectedFeed exists
[dead-end text] ← when feeds.length === 0
```

Target structure:
```
[Tag icon] [Select dropdown] [sync badge] [product count] [Re-sync button] [New Feed button]
[Add Your First Feed button] ← when feeds.length === 0, replaces dead-end text
```

### fetchFeeds Already Available

`fetchFeeds` is already a `useCallback` in products page. The dialog's `onCreated` callback simply calls it:
```typescript
// In products/page.tsx
const handleFeedCreated = async (newFeed: Feed) => {
  // Optimistic: immediately set as selected
  setFeeds((prev) => [newFeed, ...prev]);
  setSelectedFeedId(newFeed.id);
  setSelectedFeed(newFeed);
  // Then refresh from server to get latest state
  await fetchFeeds();
};
```

---

## State of the Art

No framework-level changes needed. All patterns are consistent with the existing v5 codebase.

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| "Add a feed in Settings" dead-end | "Add Your First Feed" button opens dialog inline | First-time users can create feeds without leaving the products page |

---

## Open Questions

1. **Should the dialog also trigger an immediate sync after creation?**
   - What we know: After creating a feed, the user would need to click "Re-sync" to populate products. The sync flow is a separate step in the current UX.
   - What's unclear: Whether offering a "Create and Sync" action vs. just "Create" is needed for this phase.
   - Recommendation: Keep it simple — just create the feed. The "Re-sync" button already exists in the feed bar and will be visible immediately after creation (because the new feed auto-selects). A follow-up sync is one click away.

2. **Should the first-time empty state in the product grid area also change?**
   - Current: When no feed is selected, the grid area shows "Select a feed to browse products" with a Tag icon.
   - This is still accurate when feeds exist but none is selected yet. For the zero-feeds case, the feed bar will show the CTA button — the grid text can stay as-is since it's not misleading.
   - Recommendation: No change needed to the grid empty state text.

---

## Sources

### Primary (HIGH confidence)

- `app/api/feed_routes.py` — Verified: POST /feeds endpoint, request shape `{name, feed_url}`, response is full feed row, profile scoping via X-Profile-Id
- `frontend/src/app/products/page.tsx` — Verified: exact insertion points, current dead-end text at line 408-412, `fetchFeeds` callback, feed selector bar structure, `Feed` interface definition
- `frontend/src/components/create-profile-dialog.tsx` — Verified: exact dialog pattern to replicate (Dialog, useState, apiPost, toast, onOpenChange, form reset)
- `frontend/src/lib/api.ts` — Verified: `apiPost(endpoint, body)` signature, automatic X-Profile-Id injection

### Secondary (MEDIUM confidence)

- `frontend/src/components/ui/dialog.tsx` — Verified: Dialog component exports (Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter) — all needed exports exist

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all libraries already installed and in use
- Architecture: HIGH — CreateProfileDialog is a direct template; products page insertion points clearly identified
- Pitfalls: HIGH — derived from reading the actual code, not assumptions

**Research date:** 2026-02-21
**Valid until:** 2026-04-21 (stable; no external dependencies to become stale)
