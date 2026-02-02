# Testing Patterns

**Analysis Date:** 2026-02-03

## Test Framework

**Runner:**
- Playwright (E2E testing)
- Version: ^1.57.0 (from `frontend/package.json`)
- Config: `frontend/playwright.config.ts`

**Assertion Library:**
- Playwright built-in: `expect()` from '@playwright/test'

**Run Commands:**
```bash
# Run all tests
npm run test                # from frontend/
npx playwright test

# Watch/interactive mode
npm run test:ui             # UI mode for debugging

# Run with visible browser
npm run test:headed         # See browser actions

# Run specific test file
npx playwright test tests/test-librarie-page.spec.ts

# Run tests matching pattern
npx playwright test -g "librarie"
```

## Test File Organization

**Location:**
- All tests in `frontend/tests/` directory
- Co-located with source code conceptually (in separate tests folder)
- No backend tests (Python) found in repo

**Naming:**
- Pattern: `test-<feature>.spec.ts` or `<action>-<target>.spec.ts`
- Examples:
  - `test-librarie-page.spec.ts`
  - `test-voice-muting.spec.ts`
  - `test-toast-only.spec.ts`
  - `debug-page-structure.spec.ts`
  - `verify-librarie-delete.spec.ts`

**Directory Structure:**
```
frontend/
├── tests/
│   ├── test-librarie-page.spec.ts
│   ├── test-voice-muting.spec.ts
│   ├── test-toast-only.spec.ts
│   ├── debug-*.spec.ts              # Debug/investigation tests
│   ├── verify-*.spec.ts             # Verification tests
│   └── ...                          # 44+ test files
└── screenshots/                      # Generated screenshots from tests
```

## Test Structure

**Suite Organization:**
```typescript
import { test, expect } from '@playwright/test';

test('Test name describing what is being verified', async ({ page }) => {
  // Setup: Navigate and wait
  // Action: Interact with UI
  // Assert: Verify results
  // Screenshot: Capture state for manual review
});
```

**Patterns:**

**1. Navigation and Setup:**
```typescript
test('Test librarie page loads', async ({ page }) => {
  await page.goto('http://localhost:3001/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);  // Additional wait for dynamic content
});
```

**2. Visibility Assertions:**
```typescript
const title = page.locator('h1');
await expect(title).toHaveText('Librărie');
console.log('✓ Page title is "Librărie"');

const searchInput = page.locator('input[placeholder*="Caută"]');
await expect(searchInput).toBeVisible();
```

**3. Element Counting:**
```typescript
const clipCount = await page.locator('img[src*="thumbnail"]').count();
console.log('Clips found:', clipCount);

if (clipCount === 0) {
  console.log('No clips to test with');
  return;
}
```

**4. Interaction Pattern:**
```typescript
// Hover to reveal elements
const firstThumbnail = page.locator('img[src*="thumbnail"]').first();
await firstThumbnail.hover({ force: true });
await page.waitForTimeout(300);

// Click element
const firstCheckbox = page.locator('[role="checkbox"]').first();
await firstCheckbox.click({ force: true });
await page.waitForTimeout(500);
```

**5. Dialog/Alert Handling:**
```typescript
let alertCount = 0;
page.on('dialog', async dialog => {
  console.log('Dialog type:', dialog.type(), '- message:', dialog.message());
  alertCount++;
  await dialog.accept();
});

// Trigger action that shows dialog
const deleteBtn = page.locator('button:has-text("Șterge selectate")');
await deleteBtn.click();
```

**6. Screenshot for Visual Verification:**
```typescript
await page.screenshot({
  path: 'screenshots/librarie-01-initial.png',
  fullPage: true
});

// Or single viewport
await page.screenshot({
  path: 'screenshots/voice-mute-test-1-project-selected.png',
  fullPage: false
});
```

**7. Logging with Console:**
```typescript
console.log('1. Navigating to library...');
console.log('✓ Page title is "Librărie"');
console.log(`Found ${clipCount} clips in library`);
```

## Playwright Configuration

**File:** `frontend/playwright.config.ts`

```typescript
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,              // Run tests sequentially (not in parallel)
  forbidOnly: !!process.env.CI,      // Fail if .only exists in CI
  retries: process.env.CI ? 2 : 0,   // 2 retries in CI, none locally
  workers: 1,                        // Single worker (sequential)
  reporter: 'html',                  // HTML report generation
  timeout: 60000,                    // 60 second per-test timeout
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',         // Trace failed tests
    screenshot: 'only-on-failure',   // Screenshot only on failure
    video: 'retain-on-failure',      // Video recording on failure
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
    reuseExistingServer: true,       // Reuse running Next.js server
    timeout: 120000,
  },
});
```

**Key Settings:**
- Sequential execution (not parallel) due to `fullyParallel: false`
- Single worker due to UI state conflicts
- Chromium only (no Firefox/Safari)
- Screenshots only on failure to reduce disk usage
- HTML report for debugging

## Mocking

**Framework:** Not explicitly mocked in test files

**Approach:**
- Tests hit real API endpoints (`http://localhost:8000/api/v1`)
- No Playwright mock interceptor patterns observed
- No MSW (Mock Service Worker) detected
- Tests are integration tests, not unit tests

**What's NOT Mocked:**
- API responses (real backend calls)
- Database (real Supabase calls via backend)
- External services (Gemini, ElevenLabs, Postiz)

**What COULD Be Mocked (but isn't):**
- Browser dialogs (handled with `page.on('dialog')`)
- Network requests via `page.route()`
- System time

## Fixtures and Factories

**Test Data:**
- No explicit factory pattern
- Tests assume data exists (projects, clips, etc.)
- Hard-coded project names used: `"Armaf Bliss"`, `"Librărie"`

**Example from `test-voice-muting.spec.ts`:**
```typescript
// Assumes project exists
const projectItem = page.locator('text=Armaf Bliss');
await expect(projectItem).toBeVisible({ timeout: 10000 });
await projectItem.click();
```

**Location:**
- No fixtures directory
- Setup happens inline in each test
- Database state assumed to exist (manual setup required)

## Coverage

**Requirements:** None enforced

**View Coverage:**
- No coverage tool configured for frontend
- Backend (Python) has no test suite

## Test Types

**E2E Tests:**
- **Scope:** Full user workflows (navigate, click, verify)
- **Approach:** Browser automation via Playwright
- **Examples:**
  - Library page load and clip display
  - Clip multi-select and deletion
  - Audio removal (mute source voice)
  - Postiz publishing
  - Rename operations

**No Unit Tests:**
- JavaScript/TypeScript: No Jest, Vitest, or similar configured
- Python: No pytest or unittest configured

**No Integration Tests (Isolated):**
- All frontend tests are E2E (full stack)

## Common Patterns

**Async Testing:**
```typescript
test('Test async operation', async ({ page }) => {
  // All operations are async with await
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');

  const res = await apiGet("/library/all-clips");  // Not in tests, but pattern
  const data = await res.json();
});
```

**Waiting Patterns:**
```typescript
// Network wait
await page.waitForLoadState('networkidle');

// Fixed delay
await page.waitForTimeout(2000);

// Element visibility
await expect(element).toBeVisible({ timeout: 10000 });

// Element exists
const element = page.locator('selector');
if (await element.isVisible()) { ... }
```

**Error/Failure Testing:**
Not explicitly tested in current test suite

**Long-Running Operations:**
Tests use extended timeouts for generation/processing:
```typescript
test('Test voice muting in segment generation', async ({ page }) => {
  test.setTimeout(120000); // 2 minutes timeout for generation
  // ... test code ...
});
```

## Test Execution Context

**Base URL:**
- Default: `http://localhost:3000` (from `playwright.config.ts`)
- Can override: `PLAYWRIGHT_BASE_URL` env var

**Server Startup:**
- Playwright auto-starts Next.js dev server via `webServer` config
- Backend must be running separately at `http://localhost:8000`
- Tests require both frontend (3000) and backend (8000) running

**Database:**
- Tests hit real Supabase instance
- Data persists between test runs
- Manual cleanup required or tests need to handle existing data

## Common Test Patterns

**Loading State Check:**
```typescript
const clipCount = await page.locator('img[src*="thumbnail"]').count();
console.log(`Found ${clipCount} clips in library`);

if (clipCount > 0) {
  // Test with existing clips
}
```

**Form Interaction:**
```typescript
// Select dropdown option
const subtitlesSelect = page.locator('[data-slot="trigger"]').nth(0);
await subtitlesSelect.click();
await page.waitForTimeout(500);
const optionWith = page.locator('text=Cu subtitrări');
await optionWith.click();
```

**Text Content Extraction:**
```typescript
const badgeText = await badge.textContent();
console.log(`First clip Postiz status: "${badgeText}"`);
```

**Page Content Inspection:**
```typescript
const pageHTML = await page.content();
const hasToast = pageHTML.includes('data-sonner') || pageHTML.includes('sonner-toast');
console.log('Has sonner toast elements in HTML:', hasToast);
```

## Test Maintenance

**Current State:**
- 44+ test files in `frontend/tests/`
- Mix of:
  - Feature tests: `test-librarie-page.spec.ts`, `test-voice-muting.spec.ts`
  - Debug tests: `debug-page-structure.spec.ts`, `debug-segments.spec.ts`
  - Verification tests: `verify-librarie-delete.spec.ts`, `verify-ui-improvements.spec.ts`

**Test Naming Convention:**
- Tests often prefixed with intent:
  - `test-`: Main functionality tests
  - `verify-`: Verification/assertion focused tests
  - `debug-`: Investigative tests (may be temporary)

**No Cleanup Between Tests:**
- Tests assume independent execution
- Database state may accumulate
- No teardown/beforeEach patterns observed

## Debugging

**Available Tools:**
- `npx playwright test --ui`: Opens Playwright Inspector (step through, inspect DOM)
- `npx playwright test --headed`: Run with visible browser
- Screenshots auto-saved to `screenshots/` on failure
- HTML report available after run

**Debug Information:**
- Test output includes `console.log()` statements
- Playwright trace saved on first retry
- Video recorded on failure

---

*Testing analysis: 2026-02-03*
