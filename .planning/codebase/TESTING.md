# Testing Patterns

**Analysis Date:** 2026-02-12

## Test Framework

**Runner:**
- Playwright v1.57.0
- Config: `frontend/playwright.config.ts`

**Assertion Library:**
- Playwright built-in assertions (`expect()`, `.toBeVisible()`, `.toContainText()`, etc.)

**Run Commands:**
```bash
cd frontend
npm run test              # Run all Playwright tests
npm run test:ui          # Open Playwright UI for interactive testing
npm run test:headed      # Run tests with visible browser (non-headless)
npx playwright test tests/library.spec.ts              # Run single test file
npx playwright test -g "library page"                  # Run tests matching pattern
```

## Test File Organization

**Location:**
- All tests co-located in `frontend/tests/` directory (separate from source)
- Not integrated with source tree

**Naming:**
- Pattern: `{feature}.spec.ts` or `debug-{task}.spec.ts`
- Examples: `debug-page-structure.spec.ts`, `verify-librarie-delete.spec.ts`, `test-multi-select.spec.ts`

**Directory Structure:**
```
frontend/
├── tests/
│   ├── debug-page-structure.spec.ts
│   ├── debug-all-logs.spec.ts
│   ├── debug-segments-v2.spec.ts
│   ├── test-delete-click.spec.ts
│   ├── verify-librarie-delete.spec.ts
│   ├── verify-subtitle-enhancement.spec.ts
│   └── ... (12+ test files)
└── screenshots/
    └── (test artifacts)
```

## Test Structure

**Suite Organization:**
```typescript
import { test } from '@playwright/test';

test('descriptive test name', async ({ page }) => {
  // 1. Navigate to page
  // 2. Wait for content to load
  // 3. Perform interactions
  // 4. Verify expectations
  // 5. Screenshot if needed
});
```

**Patterns:**
- Single `test()` call per file (monolithic test files)
- Navigation: `await page.goto('/librarie')`
- Wait for load: `await page.waitForLoadState('networkidle')`
- Locator queries: `await page.locator(selector)`
- Take screenshots: `await page.screenshot({ path: '...', fullPage: true })`

**Setup/Teardown:**
- Minimal setup - tests access application state directly
- Teardown: browser closes automatically after each test
- No fixtures or test data factories observed

## Test Type Classification

**Playwright Tests (Frontend E2E):**
- Location: `frontend/tests/*.spec.ts`
- Scope: End-to-end UI testing - navigates real app, interacts with components
- Approach: Browser-driven, waits for DOM elements, captures visual state

Example from `frontend/tests/debug-page-structure.spec.ts`:
```typescript
test('debug page structure', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Query and count elements
  const clipCardsCount = await page.locator('[class*="Card"]').count();
  console.log('Cards with "Card" class:', clipCardsCount);

  // Test selectors
  const selectors = [
    '.aspect-video',
    '[class*="aspect-video"]',
    'button:has(.lucide-trash)',
  ];

  for (const sel of selectors) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      console.log(`Selector "${sel}": ${count} elements`);
    }
  }

  // Take screenshot
  await page.screenshot({
    path: 'screenshots/debug-structure.png',
    fullPage: true
  });

  // Interactive testing
  const firstImg = page.locator('img[src*="thumbnail"]').first();
  if (await firstImg.count() > 0) {
    await firstImg.hover();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/debug-after-hover.png', fullPage: true });
  }
});
```

**Python Backend Tests:**
- No automated test framework detected (no pytest.ini, no test files in `app/`)
- Backend testing done manually or in GSD phases

## Playwright Configuration

**Config File:** `frontend/playwright.config.ts`

**Key Settings:**
- `testDir: './tests'` - Test discovery directory
- `fullyParallel: false` - Tests run sequentially (single worker)
- `workers: 1` - Force single browser instance
- `forbidOnly: !!process.env.CI` - Enforce `.only` removal in CI
- `retries: process.env.CI ? 2 : 0` - Retry failed tests in CI only
- `timeout: 60000` - Per-test timeout: 60 seconds
- `reporter: 'html'` - Generate HTML report on `playwright-report/`
- `trace: 'on-first-retry'` - Record trace (WebKit debugging) on first retry
- `screenshot: 'only-on-failure'` - Capture screenshots only when test fails
- `video: 'retain-on-failure'` - Record video only when test fails

**Browser:**
- Single project: Chromium (Desktop Chrome)
- No Firefox or Safari testing configured

**Web Server:**
```typescript
webServer: {
  command: 'npm run dev',              // Start dev server before tests
  url: 'http://localhost:3000',
  reuseExistingServer: true,           // Reuse if already running
  timeout: 120000,                     // Allow 2 minutes for startup
}
```

**Base URL:**
```typescript
use: {
  baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
}
```

Override with env var: `PLAYWRIGHT_BASE_URL=http://example.com npm run test`

## Common Testing Patterns

**Navigation Pattern:**
```typescript
// Navigate and wait for page load
await page.goto('/librarie');
await page.waitForLoadState('networkidle');  // Wait for network idle
await page.waitForTimeout(3000);              // Extra buffer for app initialization
```

**Element Querying Pattern:**
```typescript
// Count elements
const count = await page.locator('selector').count();

// Get first element
const el = page.locator('selector').first();

// Check visibility
await page.locator('button').isVisible();

// Get text content
const text = await page.locator('h1').innerText();

// Get attribute
const title = await page.locator('button').getAttribute('title');
```

**Interaction Pattern:**
```typescript
// Click element
await page.locator('button').click();

// Fill input
await page.locator('input').fill('text');

// Hover
await page.locator('img').hover();

// Type with delay
await page.locator('input').type('slow text', { delay: 100 });
```

**Async Error Handling Pattern:**
```typescript
// Suppress error in single operation
const text = await btn.innerText().catch(() => '');

// Try-catch for complex flows
try {
  await page.locator('selector').click();
} catch (error) {
  console.error("Click failed:", error);
}
```

**Debugging Pattern:**
```typescript
// Log to console (visible with --reporter=list)
console.log('Debug info:', value);

// Take screenshot for inspection
await page.screenshot({
  path: 'screenshots/debug-state.png',
  fullPage: true
});

// Print HTML snippet
const html = await page.locator('main').innerHTML();
console.log("Main content:", html.substring(0, 500));
```

## Visual Testing Workflow

**Standard Pattern (from CLAUDE.md):**

1. **Take screenshot after UI change:**
   ```typescript
   test('Verify UI change', async ({ page }) => {
     await page.goto('/library');
     await page.waitForLoadState('networkidle');
     await page.waitForTimeout(1000);
     await page.screenshot({ path: 'screenshots/verify-feature.png', fullPage: true });
   });
   ```

2. **Run with visible reporter:**
   ```bash
   cd frontend && npx playwright test tests/screenshot-workflow.spec.ts --reporter=list
   ```

3. **Screenshot saved to:** `frontend/screenshots/{name}.png`

4. **Show screenshot to user for validation**

## Coverage

**Requirements:** Not enforced

**Current State:**
- Manual testing via Playwright
- Focus on E2E user flows (navigation, interaction, visual verification)
- No code coverage metrics configured
- No unit tests for frontend components

## Test Execution Environment

**Prerequisites:**
- Node.js 18+ (ESLint v9 requires this)
- Dev server must be running: `npm run dev` (port 3000)
- Playwright auto-launches with test runner

**Execution Process:**
1. Playwright starts Next.js dev server via `webServer` config
2. Browser opens (Chromium)
3. Tests run sequentially (workers: 1)
4. Screenshots captured on failure
5. Video recorded on first retry in CI
6. HTML report generated to `playwright-report/`

**CI/Production Mode:**
- `forbidOnly: !!process.env.CI` - Prevents `.only` in CI
- `retries: process.env.CI ? 2 : 0` - Auto-retry failed tests
- Traces and videos retained for debugging

## Debugging Tests

**Open UI Mode:**
```bash
npm run test:ui
# or
npx playwright test --ui
```
- Visual test runner with step-by-step debugging
- Time-travel through test execution

**Run with Browser Visible:**
```bash
npm run test:headed
# or
npx playwright test --headed
```

**Show Console Output:**
```bash
npx playwright test --reporter=list
```

**Generate Report:**
```bash
npx playwright show-report
```

## Common Test Selectors

**By Class:**
- `.aspect-video` - Video container with aspect ratio
- `[class*="Card"]` - Any element with Card class
- `.lucide-trash-2` - Lucide trash icon

**By Attribute:**
- `img[src*="thumbnail"]` - Image with thumbnail in src
- `button[title*="Șterge"]` - Button with delete (Romanian)
- `button:has(.lucide-trash)` - Button containing trash icon

**By Content:**
- `text=Rendered Video` - Element with exact text
- `button:has(text)` - Compound selectors

## Test Maintenance

**No Fixtures:**
- Tests access application state directly (localStorage, DB)
- No test data setup factories
- Each test must be independent

**Flakiness:**
- Use `waitForLoadState()` for network operations
- Use `waitForTimeout()` for app-specific delays (e.g., 3000ms for library page)
- Retry logic in CI handles transient failures

**Selector Strategy:**
- Prefer semantic selectors (data-testid would be better, not used)
- Accept class-based selectors for component discovery
- Use CSS custom selectors and pseudo-selectors

---

*Testing analysis: 2026-02-12*
