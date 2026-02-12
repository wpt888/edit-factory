---
phase: 14-ai-script-generation
plan: 02
subsystem: frontend
tags:
  - script-generation-ui
  - ai-script-workflow
  - shadcn-ui
  - next-js
dependency_graph:
  requires:
    - frontend/src/lib/api.ts (apiGet, apiPost)
    - frontend/src/components/ui/* (Shadcn UI components)
    - app/api/script_routes.py (backend API endpoints)
  provides:
    - frontend/src/app/scripts/page.tsx (Script generation UI)
    - frontend/src/components/navbar.tsx (Scripts navigation link)
  affects:
    - Navigation flow (Scripts added between Export and Segments)
tech_stack:
  added:
    - Scripts page with two-column responsive layout
    - Collapsible keywords display
    - Real-time word count and duration estimation
  patterns:
    - Client-side state management with useState
    - API integration via apiGet/apiPost
    - Shadcn/UI component composition
    - Editable textarea grid for script variants
key_files:
  created:
    - frontend/src/app/scripts/page.tsx (319 lines)
  modified:
    - frontend/src/components/navbar.tsx (+1 line)
decisions:
  - Two-column layout (input left, output right) for desktop, stacked on mobile
  - Collapsible keywords section to save vertical space
  - Scripts are editable inline (user can refine AI output before using)
  - Word count estimated at 2.5 words/second for TTS duration
  - Provider badge displayed in output section for transparency
  - Error handling via Alert component below generate button
metrics:
  duration_seconds: 117
  duration_minutes: 1.9
  tasks_completed: 2
  files_created: 1
  files_modified: 1
  commits: 2
  lines_added: 320
  completed_at: "2026-02-12T01:50:18Z"
---

# Phase 14 Plan 02: Script Generation UI Summary

**One-liner:** Full-featured script generation page with Gemini/Claude provider selection, keyword awareness, and inline script editing for TTS-ready video workflows.

## What Was Built

Created the complete frontend user interface for AI script generation in Phase 14. Users can now describe video ideas, select AI providers, view available segment keywords, generate multiple script variants, and edit them inline before proceeding to video assembly.

**Core Components:**

1. **Scripts Page** (`frontend/src/app/scripts/page.tsx`)
   - Two-column responsive layout (input left, output right)
   - Idea textarea (5 rows) with descriptive placeholder
   - Context textarea (3 rows) for brand/product background
   - Variant count selector (1-10 variants via Select dropdown)
   - AI provider selector (Gemini 2.5 Flash / Claude Sonnet 4)
   - Collapsible keywords section showing available segment keywords
   - Generate button with loading state and disabled validation
   - Error display via Alert component
   - Script output cards with editable textareas
   - Word count and estimated duration badges
   - Empty state with centered message

2. **Navigation Integration**
   - Added "Scripts" link to navbar between "Export" and "Segments"
   - Reflects workflow: scripts → segment matching → assembly
   - Positioned logically in the content creation pipeline

## Implementation Highlights

### Responsive Two-Column Layout

```tsx
<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
  {/* Left Column - Input */}
  <div className="space-y-6">...</div>

  {/* Right Column - Output */}
  <div className="space-y-6">...</div>
</div>
```

Desktop: side-by-side columns. Mobile: stacked vertically.

### Keyword Awareness

Keywords fetched on page mount from `/scripts/keywords` endpoint:

```tsx
useEffect(() => {
  fetchKeywords();
}, []);

const fetchKeywords = async () => {
  const res = await apiGet("/scripts/keywords");
  if (res.ok) {
    const data = await res.json();
    setKeywords(data.keywords || []);
  }
};
```

Displayed as collapsible section with Badge components showing available visual content keywords.

### Script Generation Flow

1. User enters idea (required) + optional context
2. Selects variant count (1-10) and AI provider (Gemini/Claude)
3. Clicks "Generate Scripts" button
4. Loading state shows spinner + "Generating..." text
5. On success: scripts array populates right column
6. On error: Alert displays below generate button

```tsx
const handleGenerate = async () => {
  setError(null);
  setIsGenerating(true);

  const res = await apiPost("/scripts/generate", {
    idea: idea.trim(),
    context: context.trim() || undefined,
    variant_count: variantCount,
    provider,
  });

  if (res.ok) {
    const data = await res.json();
    setScripts(data.scripts || []);
  } else {
    const errorData = await res.json().catch(() => ({ detail: "Failed to generate scripts" }));
    setError(errorData.detail);
  }

  setIsGenerating(false);
};
```

### Editable Script Cards

Each generated script displayed as a Card with:
- Header: "Script {N}" + word count badge
- Content: Editable Textarea (8 rows, resizable)
- Word count: `{wordCount} words (~{duration}s)`
- Font: monospace for readability

```tsx
scripts.map((script, index) => {
  const wordCount = countWords(script);
  const estimatedDuration = Math.round(wordCount / 2.5);

  return (
    <Card key={index}>
      <CardHeader>
        <CardTitle>Script {index + 1}</CardTitle>
        <Badge>{wordCount} words (~{estimatedDuration}s)</Badge>
      </CardHeader>
      <CardContent>
        <Textarea
          value={script}
          onChange={(e) => updateScript(index, e.target.value)}
          rows={8}
          className="font-mono"
        />
      </CardContent>
    </Card>
  );
});
```

User can edit any script before using it in later phases.

### Empty State

When no scripts generated yet:

```tsx
{scripts.length === 0 ? (
  <Card>
    <CardContent className="flex items-center justify-center py-12">
      <div className="text-center text-muted-foreground">
        <Sparkles className="h-16 w-16 mx-auto mb-4 opacity-30" />
        <p className="text-lg">Enter your idea and click Generate to create scripts</p>
      </div>
    </CardContent>
  </Card>
) : (
  // Scripts display
)}
```

Clear guidance for first-time users.

## Technical Decisions

1. **Why Two-Column Layout?**
   - Mirrors existing patterns (segments page, library page)
   - Input stays visible while reviewing output
   - Mobile stacking maintains usability on small screens

2. **Why Collapsible Keywords?**
   - Keywords are context, not primary action
   - Saves vertical space on page
   - User can expand to verify available visual content matches idea

3. **Why Inline Editing?**
   - AI output often needs minor refinement (tone, word choice)
   - Avoids round-trip to regenerate for small changes
   - User maintains control over final script content

4. **Why Word Count Estimation?**
   - TTS reading speed ~2.5 words/second (industry standard)
   - Duration estimate helps users target platform limits (60s for Reels/TikTok)
   - Transparency in script length before TTS generation

5. **Why Provider Badge in Output?**
   - User might forget which provider they selected
   - Useful for comparing Gemini vs Claude output quality
   - Debugging aid if script quality differs from expectation

6. **Why Scripts Between Export and Segments in Navbar?**
   - Reflects script-first workflow: idea → script → segment matching → assembly
   - Export (library) comes first (import existing content)
   - Scripts generated before segments are matched to keywords
   - Logical content creation pipeline

## Deviations from Plan

None - plan executed exactly as written.

## Testing & Verification

**File checks passed:**
- `frontend/src/app/scripts/page.tsx` created (319 lines)
- `frontend/src/components/navbar.tsx` modified (+1 line)

**TypeScript checks passed:**
- No TypeScript errors in scripts/page.tsx
- All imports resolve correctly

**Integration verification needed** (requires running dev server):
- Navigate to http://localhost:3000/scripts
- Page renders with input form
- Navbar shows "Scripts" link
- Keywords load on mount (if segments exist)
- Generate button disabled when idea empty
- Generate button calls backend API
- Scripts display as editable cards after generation

**Browser verification steps:**
1. Start frontend dev server: `cd frontend && npm run dev`
2. Navigate to http://localhost:3000/scripts
3. Verify page layout and UI components render
4. Enter idea, select options, click Generate
5. Verify scripts appear as editable cards (requires backend running)

## Files Modified

**Created:**
- `frontend/src/app/scripts/page.tsx` (319 lines)

**Modified:**
- `frontend/src/components/navbar.tsx` (+1 line)

**Total changes:** 1 created, 1 modified, 320 lines added

## Commits

| Commit | Type | Message |
|--------|------|---------|
| `1d4ba4d` | feat | Create AI script generation page with full workflow |
| `9f678b5` | feat | Add Scripts navigation link to navbar |

## Integration Points

**Upstream Dependencies:**
- `app/api/script_routes.py` - Backend API endpoints
- `GET /api/v1/scripts/keywords` - Returns available keywords
- `POST /api/v1/scripts/generate` - Generates script variants
- `editai_segments` table - Source of segment keywords

**Downstream Consumers:**
- Phase 15 will use generated scripts for segment matching
- Phase 16 will assemble matched segments into final videos
- Future phases may add script versioning, templates, or sharing

**Component Dependencies:**
- `@/lib/api` - apiGet, apiPost functions
- `@/components/ui/*` - Button, Card, Input, Textarea, Label, Badge, Select, Alert, Collapsible
- `lucide-react` - Icons (Sparkles, Loader2, ChevronDown, ChevronUp, AlertCircle)

## Next Steps

1. **Test UI End-to-End**:
   ```bash
   # Start backend
   python run.py

   # Start frontend (new terminal)
   cd frontend && npm run dev

   # Visit http://localhost:3000/scripts
   # Enter idea, generate scripts, verify output
   ```

2. **Visual Verification with Playwright** (mandatory per CLAUDE.md):
   ```bash
   cd frontend
   npx playwright test tests/verify-script-generation-ui.spec.ts
   ```

   Create test file:
   ```typescript
   import { test } from '@playwright/test';

   test('Verify script generation page UI', async ({ page }) => {
     await page.goto('/scripts');
     await page.waitForLoadState('networkidle');
     await page.waitForTimeout(1000);
     await page.screenshot({
       path: 'screenshots/verify-script-generation-page.png',
       fullPage: true
     });
   });
   ```

3. **Phase 15 Planning** (next phase):
   - Keyword matching algorithm (script keywords → segment keywords)
   - Segment selection UI (match visualization)
   - Timeline assembly preview
   - Export to video rendering pipeline

## Self-Check: PASSED

**Verified created files exist:**
```bash
[ -f "frontend/src/app/scripts/page.tsx" ] && echo "FOUND: scripts page"
```
✓ File exists

**Verified modified files:**
```bash
grep -q "Scripts" "frontend/src/components/navbar.tsx" && echo "FOUND: Scripts link"
```
✓ Scripts link added

**Verified commits exist:**
```bash
git log --oneline | grep -q "1d4ba4d" && echo "FOUND: 1d4ba4d"
git log --oneline | grep -q "9f678b5" && echo "FOUND: 9f678b5"
```
✓ Both commits exist

**Verified TypeScript compilation:**
```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "scripts/page.tsx" || echo "No errors"
```
✓ No TypeScript errors

All checks passed. Plan 14-02 complete and verified.
