# Coding Conventions

**Analysis Date:** 2026-02-12

## Naming Patterns

**Files:**
- Python: `snake_case` (e.g., `video_processor.py`, `gemini_analyzer.py`)
- TypeScript/React: `kebab-case` for page files (e.g., `page.tsx`) and `camelCase` for components and utilities
- Component files: `PascalCase.tsx` (e.g., `VideoEnhancementControls.tsx`, `AuthProvider.tsx`)
- Test files: `kebab-case-with-spec` (e.g., `test-librarie-page.spec.ts`, `segment-workflow.spec.ts`)

**Functions:**
- Python: `snake_case` for all functions (e.g., `get_processor()`, `build_subtitle_filter()`, `create_job()`)
- TypeScript: `camelCase` for functions and event handlers (e.g., `updateFilters()`, `refreshSession()`, `apiFetch()`)
- React hooks: `useXxx` pattern strictly (e.g., `useAuth()`, `useCallback()`, `useEffect()`)
- Service getters: singleton factory pattern with `get_` prefix (e.g., `get_processor()`, `get_cost_tracker()`, `get_supabase()`)

**Variables:**
- Python: `snake_case` (e.g., `project_id`, `_supabase_client`, `_memory_store`)
- TypeScript: `camelCase` for state and regular variables (e.g., `profileId`, `isLoading`, `currentStep`)
- Constants: `UPPER_SNAKE_CASE` for Python, `UPPER_CASE` for TypeScript constants/consts (e.g., `API_URL`, `CONFIG_KEY`)
- Private/internal: prefix with `_` (e.g., `_project_locks`, `_generation_progress`, `_supabase`)

**Types:**
- Python: PascalCase for Pydantic models (e.g., `ProjectCreate`, `JobResponse`, `VideoSegment`)
- TypeScript: PascalCase for interfaces (e.g., `AuthContextType`, `VideoFilters`, `FetchOptions`)
- Props interfaces: suffix with `Props` (e.g., `AuthProviderProps`, `VideoEnhancementControlsProps`)

**Environment Variables:**
- Format: `UPPER_SNAKE_CASE`
- Prefixes by function:
  - API keys: `*_API_KEY` (e.g., `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `SUPABASE_KEY`)
  - URLs/hosts: `*_URL` (e.g., `SUPABASE_URL`, `POSTIZ_API_URL`)
  - Booleans: `AUTH_DISABLED`, `DEBUG_MODE`
  - Feature flags: `*_AVAILABLE` (derived in code, not env)

## Code Style

**Formatting:**
- No explicit formatter configuration found (Prettier not explicitly configured)
- ESLint config uses Next.js core-web-vitals + TypeScript rules in `frontend/eslint.config.mjs`
- Python uses conventional PEP 8 style (implicit)

**Linting:**
- Frontend: ESLint v9 with next/core-web-vitals and next/typescript
- Backend: No explicit linting setup (relies on PEP 8 conventions)
- Run with: `npm run lint` in frontend directory

**Indentation & Spacing:**
- TypeScript/JavaScript: 2 spaces (observed in component files)
- Python: 4 spaces (PEP 8 standard)

## Import Organization

**Order:**
1. Standard library imports (Python: `import os`, `from pathlib import Path`)
2. Third-party packages (FastAPI, React, Pydantic, etc.)
3. Local application imports (relative to project root with `@/` alias in TS or `from app.` in Python)
4. Type imports in TypeScript (using `import type`)

**Path Aliases:**
- TypeScript: `@/` resolves to `frontend/src/`
  - `@/components/...` for UI components
  - `@/lib/...` for utilities and API clients
  - `@/types/...` for TypeScript interfaces
  - `@/app/...` for Next.js pages
- Python: Relative imports using `from app.` prefix (e.g., `from app.config import get_settings`, `from app.services.job_storage import get_job_storage`)

**Module structure in imports:**
- Grouped by concern (all UI imports together, all service imports together)
- Destructured imports for multiple exports from same module
- Example from `frontend/src/app/library/page.tsx`:
  ```typescript
  import { Button } from "@/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  ```

## Error Handling

**Python Pattern:**
- Try-except with specific exception types
- Log errors with logger before raising HTTPException
- Graceful degradation through fallback mechanisms
- Example from `app/services/job_storage.py`:
  ```python
  if self._supabase:
      try:
          result = self._supabase.table("jobs").insert({...}).execute()
      except Exception as e:
          logger.error(f"JobStorage: Failed to create job in Supabase: {e}, using memory")
          self._memory_store[job_id] = job_data  # Fallback
  ```
- FastAPI: Raise `HTTPException(status_code=xxx, detail="message")`
- Example from `app/api/profile_routes.py`:
  ```python
  except Exception as e:
      logger.error(f"Failed to list profiles for user {current_user.id}: {e}")
      raise HTTPException(status_code=500, detail="Failed to fetch profiles")
  ```

**TypeScript Pattern:**
- Console.error for errors in async contexts
- Try-catch in useCallback/async functions
- Example from `frontend/src/components/auth-provider.tsx`:
  ```typescript
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error("Error refreshing session:", error);
      setUser(null);
      setSession(null);
    }
  } catch (error) {
    console.error("Error in refreshSession:", error);
  }
  ```
- Silent catch blocks for non-critical operations (observed in `loadConfig()` in library page)
- Context errors thrown with descriptive messages:
  ```typescript
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  ```

**Multi-tenant Error Pattern:**
- Include profile ID/user ID in error logs for debugging
- Example: `logger.error(f"[Profile {profile_id}] Failed to create job: {e}")`

## Logging

**Framework:** Python `logging` module, TypeScript `console` object

**Patterns:**
- Python: `logger.info()`, `logger.warning()`, `logger.error()`, `logger.debug()`
- Context-aware logging includes profile ID or user ID when available
- Examples:
  ```python
  logger.info(f"[Profile {profile_id}] Created job {job_id} in Supabase")
  logger.error(f"JobStorage: Failed to create job in Supabase: {e}")
  logger.debug(f"JobStorage: Created job {job_id} in memory (no profile)")
  ```
- TypeScript: `console.error()` with descriptive context
  ```typescript
  console.error("Error refreshing session:", error);
  console.error("Error signing out:", error);
  ```

**When to log:**
- Errors: Always log before handling or raising
- Info: Major operations (initialization, CRUD operations)
- Debug: State transitions, optional operations
- Avoid logging sensitive data (secrets, passwords)

## Comments

**When to Comment:**
- Complex algorithms (e.g., scoring formulas, hash computations)
- Non-obvious design decisions (why a fallback exists, why dual persistence)
- Section headers for major logical divisions
- Business logic that isn't self-explanatory

**JSDoc/TSDoc:**
- Python: Docstrings for functions and classes using triple quotes
  ```python
  def get_job(self, job_id: str) -> Optional[dict]:
      """
      Get job by ID.

      Args:
          job_id: Job identifier

      Returns:
          Job data or None if not found
      """
  ```
- TypeScript: JSDoc comments for exported functions (not consistently used)
  ```typescript
  /**
   * Make an API request.
   * Automatically injects X-Profile-Id header from localStorage if available.
   */
  export async function apiFetch(...)
  ```

**Comment style:**
- Section headers: `# ============== DESCRIPTION ==============` (Python)
- Inline explanations: `# Why this matters:` before complex code
- TODO/FIXME: `# TODO: description` (searchable with grep)

## Function Design

**Size:** Prefer small, focused functions (typical Python routes 20-50 lines, service methods similar)

**Parameters:**
- Use type hints in both Python and TypeScript
- Python: `def func(param: Type) -> ReturnType`
- TypeScript: `function func(param: Type): ReturnType`
- Pydantic models for request validation in FastAPI
- Optional parameters with defaults toward end of parameter list

**Return Values:**
- Python: Explicit return type hints (Optional[dict], List[str], etc.)
- TypeScript: Return type hints on all functions
- Async functions return Promises in TypeScript
- FastAPI endpoints return Pydantic models or dict

## Module Design

**Exports:**
- Python: All public classes/functions defined at module level, no `__all__` observed
- TypeScript: Named exports preferred, default exports for pages/components
- React components exported as named exports

**Barrel Files:**
- Not heavily used in this codebase
- Component imports typically direct (e.g., `from @/components/video-segment-player`)

**Service Pattern:**
- Singleton factories with `get_` prefix for external services
- Private initialization and fallback logic
- Example: `get_supabase()`, `get_cost_tracker()`, `get_job_storage()`
- Services manage their own state and persistence

**API Routes:**
- FastAPI APIRouter with prefix grouping
- Example: `router = APIRouter(prefix="/library", tags=["library"])`
- All endpoints prefixed with `/api/v1`
- Profile context injected via `Depends(get_profile_context)`

## Form Data Type Coercion

HTML forms send all values as strings, so boolean parameters use explicit parsing:

```python
generate_audio: str = Form(default="true")
generate_audio_bool = generate_audio.lower() in ("true", "1", "yes", "on")
```

This pattern appears in rendering endpoints to handle form submissions from frontend.

## React Patterns

**State Management:**
- No global state library (Redux, Zustand not used)
- Local component state with `useState`
- Data fetched on mount with `useEffect`
- Client-side filtering and sorting
- Optimistic updates pattern:
  ```typescript
  setClips(prev => prev.map(c => c.id === clipId ? {...c, updated} : c))
  ```

**Component Structure:**
- Functional components only
- Props with TypeScript interfaces ending in `Props`
- Checkbox-shows-sliders pattern for conditional rendering:
  ```typescript
  {filters.enableDenoise && (
    <div className="ml-6 space-y-1">
      {/* Slider shows only when checkbox is checked */}
    </div>
  )}
  ```

**Conditional Rendering:**
- Ternary operators for simple conditions
- && operator for showing elements
- Logical short-circuit for null-safe rendering

## Multi-tenant Architecture

**Profile Context Pattern:**
- `ProfileContext` Pydantic model tracks current profile
- Injected via `Depends(get_profile_context)` in routes
- X-Profile-Id header passed from frontend
- Profile ID included in logs for debugging
- Project-level locks via `get_project_lock(project_id: str)`

**Thread Safety:**
- Project locks prevent race conditions in multi-variant processing:
  ```python
  _project_locks: Dict[str, threading.Lock] = {}
  ```
- Meta-lock protects lock dictionary itself

---

*Convention analysis: 2026-02-12*
