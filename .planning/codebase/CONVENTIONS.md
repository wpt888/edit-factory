# Coding Conventions

**Analysis Date:** 2026-02-03

## Naming Patterns

**Files (Python Backend):**
- Service classes: `snake_case.py` with descriptive names
  - Examples: `video_processor.py`, `gemini_analyzer.py`, `cost_tracker.py`, `job_storage.py`
- Route files: `<domain>_routes.py`
  - Examples: `library_routes.py`, `segments_routes.py`, `postiz_routes.py`
- API entry point: `main.py`, configuration in `config.py`, models in `models.py`

**Files (Frontend/TypeScript):**
- Components: `PascalCase.tsx` or `PascalCase.ts`
  - Examples: `navbar.tsx`, `editor-layout.tsx`, `segment-marker-popup.tsx`
- Pages: `kebab-case/page.tsx` directory-based routing
  - Examples: `/librarie/page.tsx`, `/library/page.tsx`, `/segments/page.tsx`
- Utilities/helpers: `camelCase.ts` in lib or components subdirectories
  - Examples: `api.ts`, `subtitle-editor.tsx`
- UI components (shadcn): kebab-case files in `components/ui/`
  - Examples: `button.tsx`, `dropdown-menu.tsx`, `card.tsx`

**Functions (Python):**
- Functions and methods: `snake_case`
  - Service methods: `process_video()`, `analyze_segment()`, `get_job()`
  - Private methods prefix with underscore: `_init_supabase()`, `_calculate_motion()`
  - Router endpoint handlers: `async def get_costs()`, `async def create_project()`

**Functions (TypeScript/React):**
- Async functions: `camelCase`
  - API functions: `fetchAllClips()`, `apiPost()`, `apiGet()`
  - Component event handlers: `handleKeyDown()`, `updateURL()`, `handleClick()`
- React Components: `PascalCase`
  - Examples: `function LibrarieContent()`, `export function NavBar()`, `export default function RootLayout()`
- Hooks: `useXxx` pattern (from React convention)
  - Examples: `useAuth()`, `useSearchParams()`, `useRouter()`

**Variables & State (TypeScript):**
- State variables: `camelCase` (React useState)
  - Examples: `clips`, `filteredClips`, `loading`, `selectedClipIds`, `removingAudioClipId`
- Boolean flags: `isXxx` or `hasXxx` prefix
  - Examples: `isChecked`, `isSelected`, `hasSubtitles`, `hasVoiceover`
- Type/Interface names: `PascalCase`
  - Examples: `ClipWithProject`, `ProjectResponse`, `JobStatus`, `VideoSegment`

**Variables & State (Python):**
- Regular variables: `snake_case`
  - Examples: `job_id`, `target_duration`, `video_path`, `output_name`
- Module-level constants: `UPPER_SNAKE_CASE`
  - Examples: `ELEVENLABS_COST_PER_CHAR`, `GEMINI_COST_PER_IMAGE`
- Class attributes: `snake_case`
  - Examples: `self.api_key`, `self.model_name`, `self._supabase`

**Types/Enums (Python):**
- Enum class names: `PascalCase`
  - Example: `class JobStatus(str, Enum):`
- Enum values: `UPPER_CASE` (when string value is same as name)
  - Examples: `PENDING = "pending"`, `COMPLETED = "completed"`
- Dataclass names: `PascalCase`
  - Examples: `class VideoSegment:`, `class AnalyzedSegment:`

## Code Style

**Formatting (Frontend):**
- ESLint enabled: see `frontend/eslint.config.mjs`
- Uses Next.js and Next.js TypeScript lint rules
- No explicit Prettier config found - relies on ESLint defaults
- Indentation: 2 spaces (standard JavaScript/TypeScript)
- Line length: No strict limit enforced; follow readability principles

**Formatting (Backend):**
- No explicit linting config found
- Follows PEP 8 conventions implicitly
- Indentation: 4 spaces (Python standard)
- Type hints used throughout: `def function(param: str) -> dict:`
- Docstrings: Module-level and class-level docstrings present

**Linting:**
- Frontend: ESLint with Next.js core-web-vitals and TypeScript rules
  - Config file: `frontend/eslint.config.mjs`
  - Enabled rules: Next.js recommended rules, web vitals
- Backend: No explicit linter configuration (follows PEP 8 implicitly)

## Import Organization

**Frontend (TypeScript/React):**

Order strictly enforced:
1. React/Next.js core imports
2. Other external libraries
3. UI component imports (from `@/components/ui/`)
4. Custom components (from `@/components/`)
5. Utilities and lib files (from `@/lib/`)
6. Types and interfaces

Example from `frontend/src/app/librarie/page.tsx`:
```typescript
"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
// ... UI imports ...
import { Checkbox } from "@/components/ui/checkbox";
import { apiGet, apiPost, apiPatch, apiDelete, API_URL } from "@/lib/api";
import { toast } from "sonner";
```

**Path Aliases:**
- `@/` maps to `frontend/src/`
- Used for all relative imports: `@/components/ui/button`, `@/lib/api`

**Backend (Python):**

Order enforced:
1. Standard library imports
2. Third-party imports (FastAPI, Pydantic, etc.)
3. Internal app imports
4. Optional conditional imports

Example from `app/main.py`:
```python
import os
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api.routes import router as api_router
```

## Error Handling

**Strategy: Exception Propagation with Logging**

**Backend (Python):**
- Try/except blocks log errors then fall back or raise
- Pattern: catch specific exceptions, log with context, decide on fallback
- Examples from `app/services/job_storage.py`:

```python
def _init_supabase(self):
    """Initialize Supabase client."""
    try:
        from app.config import get_settings
        from supabase import create_client
        settings = get_settings()
        if settings.supabase_url and settings.supabase_key:
            self._supabase = create_client(settings.supabase_url, settings.supabase_key)
            logger.info("JobStorage: Supabase initialized")
        else:
            logger.warning("JobStorage: Supabase credentials missing, using in-memory fallback")
    except Exception as e:
        logger.error(f"JobStorage: Failed to initialize Supabase: {e}")
        self._supabase = None
```

**Fallback Pattern:**
- Supabase operations attempt DB write first
- On failure, fall back to in-memory storage
- Log both success and failure states with descriptive messages
- Example from `app/services/job_storage.py`:

```python
if self._supabase:
    try:
        result = self._supabase.table("jobs").insert({...}).execute()
        logger.info(f"JobStorage: Created job {job_id} in Supabase")
        return job_data
    except Exception as e:
        logger.error(f"JobStorage: Failed to create job in Supabase: {e}, using memory")
        self._memory_store[job_id] = job_data
        return job_data
else:
    self._memory_store[job_id] = job_data
    logger.debug(f"JobStorage: Created job {job_id} in memory")
    return job_data
```

**Frontend (TypeScript/React):**
- Try/catch in async functions
- Error logged to console
- User feedback via toast notifications or state updates
- Example from `frontend/src/app/librarie/page.tsx`:

```typescript
const fetchAllClips = async () => {
  try {
    setLoading(true);
    const res = await apiGet("/library/all-clips");
    if (res.ok) {
      const data = await res.json();
      setClips(data.clips || []);
    } else if (res.status === 401) {
      window.location.href = "/login";
    }
  } catch (error) {
    console.error("Failed to fetch clips:", error);
  } finally {
    setLoading(false);
  }
};
```

**HTTP Error Handling:**
- Check response status explicitly
- Handle 401 unauthorized with redirect to login
- Generic errors logged to console

## Logging

**Framework:** Python `logging` module (backend), `console` (frontend)

**Backend Patterns:**
- Logger initialized per module: `logger = logging.getLogger(__name__)`
- Module-level docstrings describe purpose
- Log levels:
  - `logger.info()`: Operation start/success, state changes, initialization
  - `logger.warning()`: Fallback behavior, missing optional config
  - `logger.error()`: Exception details, failed operations
  - `logger.debug()`: In-memory fallback, low-level operations
- Format: Configured globally in `app/main.py`:
  ```python
  logging.basicConfig(
      level=logging.INFO,
      format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
  )
  ```

**Backend Log Patterns (from actual code):**
- Service initialization: `logger.info("JobStorage: Supabase initialized")`
- Fallback paths: `logger.warning("JobStorage: Supabase credentials missing, using in-memory fallback")`
- Error context: `logger.error(f"JobStorage: Failed to create job in Supabase: {e}, using memory")`
- Success with ID: `logger.info(f"JobStorage: Created job {job_id} in Supabase")`

**Frontend Patterns:**
- `console.log()` for navigation and state changes (test-first debugging)
- `console.error()` for API failures
- Example from test file `frontend/tests/test-librarie-page.spec.ts`:
  ```typescript
  console.log('✓ Page title is "Librărie"');
  console.log(`Found ${clipCount} clips in library`);
  ```

## Comments

**When to Comment (Backend):**
- Module docstrings: Always present as triple-quoted strings at file start
  - Example: `"""Edit Factory - Video Processor Service v2.2"""`
- Class docstrings: Document purpose and workflow for complex classes
  - Example from `app/services/gemini_analyzer.py`:
    ```python
    class GeminiVideoAnalyzer:
        """
        Analizează videoclipuri folosind Gemini pentru a găsi cele mai bune momente.
        Workflow:
        1. Extrage frames la interval regulat (default: 1 frame / 2 secunde)
        2. Trimite batch-uri de frames la Gemini
        3. Primește analiza și scoruri pentru fiecare segment
        4. Returnează segmentele sortate după scor
        """
    ```
- Function docstrings: Present for public methods and complex functions
- Inline comments: Used sparingly for non-obvious logic
  - Example: `# Meta-lock for managing project locks`

**When to Comment (Frontend):**
- Component docstrings: Minimal or absent in React components
- JSDoc for complex functions: Not consistently used
- Inline comments: Explanation of non-obvious logic or temporary state
- Example from `frontend/src/components/editor-layout.tsx`:
  ```typescript
  // Ignore if typing in an input
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  ```

**Documentation Style:**
- Romanian and English mixed (project is bilingual)
- Docstrings may be in Romanian for business context
- Code comments in English for technical clarity

## Function Design

**Size Guidelines:**
- Backend: Service methods typically 20-50 lines; smaller for specific tasks
  - Complex operations broken into private helper methods with `_` prefix
  - Example: `_init_supabase()`, `_detect_rotation()`, `_calculate_motion_for_interval()`
- Frontend: React components 150-400 lines; hooks extracted for reuse
  - Large pages split with internal helper functions
  - Example: `LibrariePage` contains internal `LibrarieContent()` function

**Parameters:**
- Backend: 3-5 parameters typical; use dataclasses or Pydantic models for groups
  - Example: `def create_job(self, job_data: dict) -> dict:`
  - Config passed via dependency injection: `get_settings()`
- Frontend: Props via interfaces; destructured in function signature
  - Example: `function EditorLayout({ leftPanel, rightPanel, children, ... }: EditorLayoutProps)`

**Return Values:**
- Backend:
  - Service methods return Pydantic models or dicts
  - Route handlers return FastAPI response objects
  - Example: `def get_job(self, job_id: str) -> Optional[dict]:`
- Frontend:
  - Components return JSX (ReactNode)
  - Async functions return Promises
  - Example: `async function fetchAllClips(): Promise<void>`

## Module Design

**Exports (Backend):**
- Services exported as singletons with `get_xxx()` factory functions
  - Examples: `get_job_storage()`, `get_cost_tracker()`, `get_processor()`
  - Lazy initialization with caching: Uses Python's module-level globals
  - Example from `app/services/cost_tracker.py`:
    ```python
    _cost_tracker_instance = None

    def get_cost_tracker() -> CostTracker:
        global _cost_tracker_instance
        if _cost_tracker_instance is None:
            _cost_tracker_instance = CostTracker(...)
        return _cost_tracker_instance
    ```

**Exports (Frontend):**
- Components exported as named exports or default
  - Naming: `export function NavBar()` or `export default function LibraryPage()`
- API utilities exported from `lib/api.ts`:
  - Named exports: `apiGet`, `apiPost`, `apiPatch`, `apiDelete`
  - Example: `export async function apiPost<T = unknown>(...)`

**Barrel Files:**
- Not heavily used
- UI components in `components/ui/` are individual imports
- No index.ts aggregating exports observed

**Configuration Pattern:**
- Pydantic BaseSettings in `app/config.py`
- Accessed via `get_settings()` singleton with `@lru_cache`
- Example:
  ```python
  @lru_cache
  def get_settings() -> Settings:
      return Settings()
  ```

## Special Patterns

**Dependency Injection (Backend):**
- Services pass dependencies explicitly
- Config accessed via `get_settings()` (cached)
- Example from routes:
  ```python
  def get_processor() -> VideoProcessorService:
      settings = get_settings()
      return VideoProcessorService(
          input_dir=settings.input_dir,
          output_dir=settings.output_dir,
          temp_dir=settings.base_dir / "temp"
      )
  ```

**State Management (Frontend):**
- React hooks (useState, useCallback, useEffect)
- URL query parameters for filter state (URLSearchParams)
- No Redux or Context API observed; state lifted to page level
- Example from `frontend/src/app/librarie/page.tsx`:
  ```typescript
  const [clips, setClips] = useState<ClipWithProject[]>([]);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const updateURL = useCallback((params: Record<string, string>) => {
    const newParams = new URLSearchParams(searchParams.toString());
    // ...
    router.push(`/librarie?${newParams.toString()}`, { scroll: false });
  }, [router, searchParams]);
  ```

**API Client Pattern (Frontend):**
- Wrapper functions in `lib/api.ts`
- Handles headers, base URL, serialization
- Usage: `const res = await apiPost("/library/create", projectData);`

**Database Abstraction (Backend):**
- Direct Supabase client calls (no ORM)
- Try/catch with fallback to in-memory storage
- Example: `self._supabase.table("jobs").insert({...}).execute()`

---

*Convention analysis: 2026-02-03*
