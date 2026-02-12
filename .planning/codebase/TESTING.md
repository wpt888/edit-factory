# Testing Patterns

**Analysis Date:** 2026-02-12

## Test Framework

**Runner:**
- Playwright v1.57.0 for frontend E2E testing
- Config: `frontend/playwright.config.ts`
- No unit testing framework detected (Jest/Vitest not in package.json)
- Backend: No automated tests detected (no pytest/unittest setup)

**Configuration Details:**
```typescript
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 60000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
```

**Assertion Library:**
- Playwright built-in assertions (`expect()`)

**Run Commands:**
```bash
cd frontend
npm run test              # Run all Playwright tests
npm run test:ui          # Interactive UI mode
npm run test:headed      # Run with visible browser
npx playwright test tests/test-librarie-page.spec.ts  # Single test file
npx playwright test -g "library page"  # Tests matching pattern
```

**Test Execution:**
- Runs sequentially (workers: 1)
- Retries 2 times in CI, 0 times locally
- CI environment detected via `process.env.CI`
- Base URL configurable via `PLAYWRIGHT_BASE_URL` env var (defaults to `http://localhost:3000`)
- HTML report generated in `playwright-report/` directory

## Test File Organization

**Location:**
- `frontend/tests/` directory
- Page/feature specific subdirectories not used; all tests in root of tests/

**Naming:**
- Pattern: `kebab-case-description.spec.ts`
- Examples: `test-librarie-page.spec.ts`, `segment-workflow.spec.ts`, `test-delete-click.spec.ts`
- Debug/exploratory tests: `debug-*.spec.ts` (e.g., `debug-page-structure.spec.ts`)
- Feature verification: `verify-*.spec.ts` (e.g., `verify-assembly-page.spec.ts`)

**File Structure:**
```
frontend/tests/
├── test-librarie-page.spec.ts         # Main feature tests
├── segment-workflow.spec.ts
├── debug-page-structure.spec.ts       # Diagnostic tests
├── verify-subtitle-enhancement.spec.ts
└── ... (30+ test files)
```

## Test Structure

**Suite Organization:**

Tests use Playwright's `test.describe()` for grouping and `test.beforeEach()` for setup:

```typescript
test.describe('Segment-Based Video Creation Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/library');
    await page.waitForLoadState('networkidle');
  });

  test('1. Library page loads correctly', async ({ page }) => {
    await expect(page.locator('text=Proiecte')).toBeVisible({ timeout: 10000 });
  });

  test('2. Can create a new project', async ({ page }) => {
    // Test steps
  });
});
```

**Patterns:**

**Setup Pattern:**
- Use `test.beforeEach()` for common setup (navigation, data state)
- Manual setup within tests for specific test data
- Timeouts set per-operation, not globally

**Teardown Pattern:**
- No explicit teardown observed (Playwright handles cleanup)
- Screenshots and videos retained on failure

**Assertion Pattern:**
```typescript
// Element visibility
await expect(page.locator('text=Proiecte')).toBeVisible({ timeout: 10000 });

// Content/text checks
await expect(title).toHaveText('Librărie');

// URL verification
await expect(page).toHaveURL(/\/library/);
expect(url).toContain('subtitles=');
```

## Test Patterns

**Visual Testing:**
```typescript
await page.screenshot({
  path: 'screenshots/librarie-01-initial.png',
  fullPage: true
});
```

Screenshots automatically taken and stored in `frontend/screenshots/` with descriptive names for manual verification.

**Interaction Pattern:**
```typescript
const plusButton = page.locator('button:has(svg.lucide-plus)').first();
await plusButton.click();
await page.waitForTimeout(500);
```

Sequential actions with explicit waits for UI state changes.

**Waiting Patterns:**
- `page.waitForLoadState('networkidle')` - Wait for all network activity
- `page.waitForTimeout(500)` - Fixed delays for animation/debouncing
- `{ timeout: 10000 }` - Per-assertion timeout
- `toBeVisible({ timeout: 10000 })` - Explicit assertion timeout

**Data Setup:**
```typescript
const projectName = `Test Project ${Date.now()}`;
const nameInput = page.locator('input').first();
await nameInput.fill(projectName);
```

Dynamic test data using timestamps to ensure uniqueness.

**Locator Strategies:**
- Text matching: `page.locator('text=...')` or `page.locator('text=Librărie')`
- CSS selectors: `page.locator('.aspect-\\[9\\/16\\]')`
- Role-based: `page.getByRole('heading', { name: 'Proiect Nou' })`
- Attribute selectors: `page.locator('input[type="number"]')`
- Composite: `page.locator('button:has(svg.lucide-plus)')`

## Mocking

**Framework:** Playwright has no built-in mocking; uses real network calls

**Approach:**
- Tests use live backend (http://localhost:8000/api/v1)
- No API mocking or stubbing observed
- Real database operations occur during test execution
- State between tests managed via unique data (e.g., timestamps in project names)

**Network Handling:**
- `page.waitForLoadState('networkidle')` waits for actual API responses
- Specific timeout handling for slow operations:
  ```typescript
  await expect(page.locator(`text=${projectName}`)).toBeVisible({ timeout: 10000 });
  ```

## Test Data & Fixtures

**Test Data Generation:**
- Inline data creation using timestamps:
  ```typescript
  const projectName = `Test Project ${Date.now()}`;
  ```
- No dedicated fixture files or factories

**Setup Data:**
- Tests that need existing projects use `test.beforeEach()` navigation
- Page setup: `await page.goto('/library'); await page.waitForLoadState('networkidle');`

## Coverage

**Requirements:** No coverage configuration detected (no coverage targets enforced)

**View Coverage:** No coverage tooling integrated

**Coverage Approach:**
- Manual/ad-hoc testing via Playwright tests
- Tests focus on critical paths (CRUD, rendering, filtering)
- No measurement of code coverage
- Tests serve more as integration/E2E validation than unit coverage

## Test Types

**Unit Tests:**
- Not used - no Jest/Vitest configuration
- All testing is integration/E2E via Playwright

**Integration Tests:**
- Playwright tests function as integration tests
- Test full flow: UI → API → Backend → Database
- Example: Create project → Upload video → Render clips → Verify UI update

**E2E Tests:**
- Full application workflows tested end-to-end
- Real browser execution with Chromium
- Real backend and database interactions
- Examples:
  - `segment-workflow.spec.ts`: Full project creation to rendering workflow
  - `test-librarie-page.spec.ts`: Library page features (filtering, Postiz modal)
  - `test-multi-select.spec.ts`: UI state management

**Visual Regression Testing:**
- No automated visual regression framework
- Manual screenshot verification via Playwright `screenshot()` calls
- Screenshots stored for manual review at `frontend/screenshots/`

## Common Patterns

**Async Testing:**
All tests are async by default with Playwright:

```typescript
test('Description', async ({ page }) => {
  // All operations are async/await
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  const element = await page.locator('selector');
});
```

**Navigation & State:**
```typescript
test('Can navigate to library', async ({ page }) => {
  await page.goto('http://localhost:3000/library');
  await page.waitForLoadState('networkidle');

  // Verify page loaded
  await expect(page.locator('h1')).toHaveText('Librărie');
});
```

**Error Verification:**
No explicit error testing observed. Tests focus on happy-path verification.

**Logging in Tests:**
```typescript
console.log('✓ Page title is "Librărie"');
console.log(`Found ${clipCount} clips in library`);
console.log('URL after filter:', url);
```

Inline console.log() for test output and debugging.

## Test Environment

**Browser:** Chromium only (no Firefox/Safari variants)

**Base URL Configuration:**
- Default: `http://localhost:3000`
- Configurable: `process.env.PLAYWRIGHT_BASE_URL`
- Frontend dev server must be running (starts automatically if not present)

**Backend URL:**
- Hardcoded in test files when needed: `http://localhost:8001/api/v1` (some tests) or `http://localhost:8000/api/v1` (others)
- Mismatch indicates some tests use old server port (potential issue)

## Test Execution Notes

**Critical Requirements:**
1. Frontend dev server must be running: `npm run dev` (port 3000)
2. Backend server must be running: `python run.py` (port 8000)
3. Database (Supabase) must be accessible
4. Tests use `reuseExistingServer: true`, so old server processes may need cleanup

**Debugging:**
- Traces generated on first retry: `trace: 'on-first-retry'`
- Screenshots on failure: `screenshot: 'only-on-failure'`
- Video recording: `video: 'retain-on-failure'`
- HTML report: `npm run test` generates `playwright-report/index.html`

**Run Single Test File:**
```bash
npx playwright test tests/test-librarie-page.spec.ts --reporter=list
```

**Run with UI:**
```bash
npm run test:ui
```
Opens interactive UI for running, filtering, and debugging tests.

---

*Testing analysis: 2026-02-12*
