# Coding Conventions

**Analysis Date:** 2026-02-12

## Naming Patterns

**Files:**
- Python files: `snake_case` (e.g., `job_storage.py`, `video_processor.py`, `elevenlabs_tts.py`)
- TypeScript/React files: `kebab-case` for components/pages (e.g., `video-processing`, `subtitle-editor`, `use-job-polling.ts`)
- Component files: `PascalCase` for React components when exported, stored in `kebab-case` filenames

**Functions:**
- Python: `snake_case` (e.g., `get_processor()`, `verify_jwt_token()`, `_init_supabase()`)
- TypeScript: `camelCase` for functions and hooks (e.g., `startPolling()`, `calculateETA()`, `apiGet()`)
- Private/internal functions in Python: prefix with `_` (e.g., `_init_supabase()`, `_memory_store`)

**Variables:**
- Python: `snake_case` (e.g., `job_id`, `profile_id`, `start_time_ref`)
- TypeScript/React: `camelCase` (e.g., `isPolling`, `currentJob`, `estimatedRemaining`, `apiBaseUrl`)
- Constants: `UPPER_SNAKE_CASE` in Python, `UPPER_SNAKE_CASE` or `UPPER_CAMEL_CASE` in TypeScript
- Storage keys: `snake_case_with_prefix` (e.g., `editai_current_profile_id`, `editai_library_config`)

**Types:**
- Python: `PascalCase` for classes and enums (e.g., `JobStatus`, `AuthUser`, `ProfileContext`)
- TypeScript: `PascalCase` for interfaces and types (e.g., `SubtitleSettings`, `Variant`, `VideoInfo`)
- Enum values: `UPPER_SNAKE_CASE` in Python (e.g., `PENDING`, `PROCESSING`, `COMPLETED`)

## Code Style

**Formatting:**
- Frontend: ESLint enforces style via `eslint-config-next` (ESLint v9)
- Python: No explicit formatter configured (PEP 8 style apparent from codebase)
- Indentation: 2 spaces in TypeScript/React, 4 spaces in Python
- Line length: No hard limit enforced, but code stays readable (typical 80-120 chars)

**Linting:**
- Frontend: ESLint v9 with Next.js TypeScript config (`eslint-config-next`, `eslint-config-next/typescript`)
- Python: No automated linter detected in config
- Run frontend linting: `npm run lint` (from `/frontend/package.json`)

## Import Organization

**Order (Python):**
1. Standard library imports (`logging`, `os`, `pathlib`, `typing`, etc.)
2. Third-party imports (`fastapi`, `pydantic`, `supabase`, `jwt`, etc.)
3. Local imports (`from app.config`, `from app.services`, `from app.api`)

Example from `app/api/auth.py`:
```python
import logging
from typing import Optional
from dataclasses import dataclass
from fastapi import Depends, HTTPException, Header, status
import jwt

from app.config import get_settings
```

**Order (TypeScript/React):**
1. React/Next.js imports (`react`, `next/navigation`, etc.)
2. Shadcn/UI component imports (`@/components/ui/*`)
3. Local components (`@/components/*`)
4. Icons (lucide-react)
5. Types and utilities (`@/types/*`, `@/lib/*`)

Example from `frontend/src/app/page.tsx`:
```typescript
import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useJobPolling } from "@/hooks/use-job-polling";
import type { SubtitleSettings } from "@/types/video-processing";
```

**Path Aliases:**
- Frontend only: `@/` points to `frontend/src/` (configured in TypeScript/Next.js)
- Used for all relative imports: `@/components`, `@/hooks`, `@/types`, `@/lib`

## Error Handling

**Patterns (Python):**
- Use FastAPI `HTTPException` for HTTP errors with appropriate status codes
- Catch broad exceptions in service methods, log with context, raise HTTPException
- Always include profile context in logs when available (e.g., `f"[Profile {profile_id}] Operation failed"`)

Example from `app/api/auth.py`:
```python
try:
    payload = jwt.decode(...)
    return payload
except jwt.ExpiredSignatureError:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token has expired",
        headers={"WWW-Authenticate": "Bearer"}
    )
except PyJWTError as e:
    logger.warning(f"JWT verification failed: {e}")
    raise HTTPException(...)
```

**Patterns (TypeScript/React):**
- Use `.catch()` or try-catch in async functions
- Log errors to console: `console.error()`
- Callbacks receive error parameter: `onError?: (error: string) => void`
- No uncaught errors - all promises have error handlers

Example from `frontend/src/hooks/use-job-polling.ts`:
```typescript
try {
  const response = await fetch(`${apiBaseUrl}/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
} catch (error) {
  console.error("Polling error:", error);
  onError?.(error instanceof Error ? error.message : "Unknown error");
}
```

## Logging

**Framework:** Python uses `logging` module (standard library)

**Patterns (Python):**
- Create logger at module level: `logger = logging.getLogger(__name__)`
- Use appropriate levels: `logger.debug()`, `logger.info()`, `logger.warning()`, `logger.error()`
- Always include profile context in logs: `logger.info(f"[Profile {profile_id}] {message}")`
- When no profile context available: `logger.info(f"[User {user_id}] {message}")`
- Use lazy formatting (f-strings) for better performance

Example from `app/api/library_routes.py`:
```python
logger = logging.getLogger(__name__)

# With profile context
logger.info(f"[Profile {profile_id}] JobStorage: Created job {job_id} in Supabase")

# With user context
logger.info(f"[User {current_user.id}] Listed {len(profiles)} profiles")

# General info
logger.info("Edit Factory started")
```

**Patterns (TypeScript/React):**
- Use `console` directly (no logging library)
- Log errors: `console.error("context:", error)`
- Minimal logging in components (only errors)

## Comments

**When to Comment:**
- Explain "why" not "what" - code should be self-documenting
- Complex algorithms, non-obvious logic, workarounds
- Domain-specific calculations or business rules
- Security-related decisions

Example from `app/api/auth.py`:
```python
# Development mode bypass - WARNING: Only use for local development!
if settings.auth_disabled:
    logger.warning("⚠️ Authentication is DISABLED - development mode only!")
    return AuthUser(...)
```

**DocStrings:**
- Use triple-quoted docstrings for all functions and classes
- Include Args, Returns, Raises sections
- Follow Google-style docstring format

Example from `app/api/auth.py`:
```python
def verify_jwt_token(token: str) -> dict:
    """
    Verify a Supabase JWT token and return the payload.

    Args:
        token: JWT token string

    Returns:
        Decoded token payload

    Raises:
        HTTPException: If token is invalid or expired
    """
```

**JSDoc/TSDoc (TypeScript):**
- Use `/** */` for public functions and components
- Include parameter descriptions
- Include return type

Example from `frontend/src/hooks/use-job-polling.ts`:
```typescript
/**
 * Hook for polling job status with ETA calculation
 */
export function useJobPolling(options: UseJobPollingOptions): UseJobPollingReturn {
  // ...
}

/**
 * Format elapsed time as mm:ss
 */
export function formatElapsedTime(seconds: number): string {
  // ...
}
```

## Function Design

**Size:** Functions kept concise, typically 20-80 lines
- Larger operations broken into helper functions
- Service layer methods typically 30-60 lines

**Parameters:**
- Python functions use named parameters
- TypeScript functions use typed parameters with interfaces where multiple params
- Optional parameters use `Optional[Type] = None` in Python, `?: Type` in TypeScript

Example from `app/services/job_storage.py`:
```python
def create_job(self, job_data: dict, profile_id: Optional[str] = None) -> dict:
```

Example from `frontend/src/hooks/use-job-polling.ts`:
```typescript
interface UseJobPollingOptions {
  apiBaseUrl: string;
  interval?: number;
  onProgress?: (progress: number, status: string, job: Job) => void;
}
```

**Return Values:**
- Functions return typed data: `-> dict`, `-> Optional[dict]` in Python
- TypeScript returns explicit types: `Promise<Response>`, `UseJobPollingReturn`
- Async functions consistently return Promises

## Module Design

**Exports (Python):**
- Services use factory/singleton functions for initialization: `get_processor()`, `get_cost_tracker()`, `get_job_storage()`
- Services have single responsibility

**Exports (TypeScript/React):**
- Components export as default or named export
- Hooks export as named exports with `use` prefix
- Types exported from `types/*.ts` files
- Utilities exported from `lib/*.ts` files

**Barrel Files:**
- Python: minimal use (services import directly)
- TypeScript: Some barrel exports in `components/ui/` (Shadcn components), most direct imports preferred

Example of barrel pattern in `app/services/tts/`:
```python
# app/services/tts/__init__.py - imports available but direct imports preferred
from app.services.tts.factory import get_tts_service
```

## Type Annotations

**Python:**
- Use type hints for all function signatures
- Use `Optional[Type]` for nullable values
- Use `Dict[str, Any]` for untyped dictionaries, `dict` for typed ones
- Pydantic `BaseModel` for request/response schemas

Example from `app/models.py`:
```python
class JobCreate(BaseModel):
    output_name: Optional[str] = Field(default=None, description="Nume pentru fisierul output")
    target_duration: float = Field(default=20.0, description="Durata tinta in secunde")
```

**TypeScript:**
- All functions have explicit return types
- Interfaces used for complex types
- Generic types for reusable components
- No `any` type unless unavoidable

Example from `frontend/src/types/video-processing.ts`:
```typescript
export interface SubtitleSettings {
  fontSize: number;
  fontFamily: string;
  enableGlow?: boolean;
}

export interface Job {
  job_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  result?: {...};
}
```

## Form Data Handling

**Python Pattern:**
- HTML forms send strings, boolean parameters parsed explicitly
- Use `.lower() in ("true", "1", "yes", "on")` pattern for boolean coercion

Example from codebase:
```python
generate_audio: str = Form(default="true")
generate_audio_bool = generate_audio.lower() in ("true", "1", "yes", "on")
```

---

*Convention analysis: 2026-02-12*
