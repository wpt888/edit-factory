# Repository Guidelines

## Project Structure & Module Organization
`app/` contains the FastAPI backend, with HTTP entrypoints in `app/api/` and business logic in `app/services/`. Backend tests live in `tests/` and focus on API routes plus service modules such as job storage and cost tracking. The web UI lives in `frontend/`, with route files under `frontend/src/app/`, shared UI in `frontend/src/components/`, and browser tests in `frontend/tests/`. Desktop packaging lives in `electron/`. Runtime folders such as `input/`, `output/`, `logs/`, `temp/`, and `media/` hold generated or working files and should not be treated as source.

## Build, Test, and Development Commands
Backend setup: `pip install -r requirements.txt`
Backend run: `python run.py`
Backend tests: `pytest tests/ -x -q --tb=short`
Backend lint/type-check: `ruff check app/ --select=E,F,W --ignore=E501,E402,W291,W292,W293` and `mypy app/ --ignore-missing-imports --no-strict-optional --allow-untyped-defs`

Frontend setup: `cd frontend && npm ci`
Frontend dev server: `cd frontend && npm run dev`
Frontend production build: `cd frontend && npm run build`
Frontend checks: `cd frontend && npm run lint && npm run typecheck`
Frontend E2E: `cd frontend && npm test`

## Coding Style & Naming Conventions
Follow existing style in each area rather than reformatting unrelated files. Python uses 4-space indentation, snake_case filenames, and typed service methods where practical. TypeScript/React uses the repo’s ESLint config, PascalCase for components, camelCase for hooks/utilities, and `.spec.ts` for Playwright tests. Keep route-specific UI in `frontend/src/app/...`; move reusable pieces into `frontend/src/components/` or `frontend/src/lib/`.

## Testing Guidelines
Add backend tests in `tests/test_<feature>.py`. Pytest is configured through `pyproject.toml` and currently tracks coverage for `app.services.job_storage` and `app.services.cost_tracker`; keep or improve that coverage when touching those modules. Add frontend flows as Playwright specs in `frontend/tests/`, using descriptive names like `e2e-pipeline.spec.ts` or `verify-voice-selector.spec.ts`.

## Commit & Pull Request Guidelines
Recent history uses Conventional Commit prefixes, especially `fix:` and `feat:`. Keep subjects imperative and specific, for example `fix: persist empty captions when user clears text field`. Pull requests should include a short problem statement, the implementation scope, test evidence (`pytest`, `npm run lint`, `npm test` when relevant), and screenshots or recordings for UI changes.

## Configuration & Security
Start from `.env.example`; keep secrets only in `.env`. Do not commit generated media, logs, local databases, or credentials. If a change depends on Supabase, FFmpeg, or external APIs, document the required environment variables in the PR.
