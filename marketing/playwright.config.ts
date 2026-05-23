import { defineConfig, devices } from '@playwright/test';

// Port and base URL are overridable via env vars to handle port-3001
// collisions in autonomous test environments (T-89-02 fallback). The
// canonical dev port remains 3001 — locked at package.json scripts.dev
// per D-06. Default values below keep all locked decisions intact:
//   - default baseURL: http://localhost:3001
//   - default webServer command: `npm run dev` (which runs `next dev --port 3001`)
// To run the smoke on a different port (e.g., when 3001 is occupied):
//   PLAYWRIGHT_PORT=3099 PLAYWRIGHT_BASE_URL=http://localhost:3099 CI=1 npx playwright test
const PW_PORT = process.env.PLAYWRIGHT_PORT || '3001';
const PW_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 60000,
  use: {
    baseURL: PW_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: process.env.PLAYWRIGHT_PORT
      ? `npx next dev --port ${PW_PORT}`
      : 'npm run dev',
    url: PW_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
