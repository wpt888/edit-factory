import { test } from '@playwright/test';

// SSE body that delivers only a 50% progress event, then ends (stream closes)
// The component will be in "downloading" state showing the progress bar.
const HANGING_SSE = [
  'event: progress',
  'data: {"stage": "download", "downloaded": 500000, "total": 1000000, "percent": 50}',
  '',
  '',
].join('\n');

// Full SSE body that completes the install flow
const FULL_SSE = [
  'event: progress',
  'data: {"stage": "download", "downloaded": 0, "total": 1000000, "percent": 0}',
  '',
  'event: progress',
  'data: {"stage": "download", "downloaded": 500000, "total": 1000000, "percent": 50}',
  '',
  'event: progress',
  'data: {"stage": "download", "downloaded": 1000000, "total": 1000000, "percent": 100}',
  '',
  'event: progress',
  'data: {"stage": "verify"}',
  '',
  'event: progress',
  'data: {"stage": "unpack"}',
  '',
  'event: done',
  'data: {"status": "installed", "version": "0.1.0"}',
  '',
  '',
].join('\n');

const PROFILE = { id: 'test-p', name: 'Test Profile', is_default: true, created_at: '2024-01-01' };
const PROFILE_DETAIL = {
  id: 'test-p', name: 'Test Profile',
  tts_settings: { provider: 'edge', voice_id: 'en-US-AriaNeural' },
  video_template_settings: { template_name: 'product_spotlight', primary_color: '#FF0000', accent_color: '#FFFF00', cta_text: 'Buy now' },
};
const DASHBOARD = {
  stats: { projects_count: 0, clips_count: 0, rendered_count: 0 },
  costs: { elevenlabs: 0, gemini: 0, total: 0, monthly: 0, monthly_quota: null, quota_remaining: null },
};

async function mockSettingsPage(page: import('@playwright/test').Page) {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('localhost:3002')) return route.continue();
    if (url.includes('localhost:8000')) {
      const path = new URL(url).pathname;
      if (path.includes('/desktop/ml/status')) return route.fulfill({ status: 404, body: '{}' });
      if (path.includes('/desktop/ml/download')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
      if (path === '/api/v1/profiles/' || path === '/api/v1/profiles') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([PROFILE]) });
      if (path.includes('/profiles/templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      if (path.includes('/dashboard')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DASHBOARD) });
      if (path.match(/\/profiles\/[^/]+$/)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE_DETAIL) });
      if (path.includes('/elevenlabs-accounts')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accounts: [] }) });
      if (path.includes('/tts/voices')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      if (path.includes('/api-keys')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: null, configured: false }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (url.includes('nortia.ro') || url.includes('supabase')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { session: null }, error: null }) });
    }
    return route.continue();
  });
}

test('Screenshot 1 — ML installer idle state', async ({ page }) => {
  await mockSettingsPage(page);
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('ml-bundle-installer').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/ml-installer-idle.png', fullPage: true });
});

test('Screenshot 2 — ML installer downloading state at 50%', async ({ page }) => {
  await mockSettingsPage(page);

  // Override: downloading SSE fixture that delivers 50% then closes stream
  await page.route('**/api/v1/desktop/ml/download', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: HANGING_SSE,
    });
  });

  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('ml-bundle-installer').scrollIntoViewIfNeeded();
  await page.getByTestId('ml-install-button').click();
  await page.waitForSelector('[data-testid="ml-installer-downloading"]', { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/ml-installer-progress.png', fullPage: true });
});

test('Screenshot 3 — ML installer installed state', async ({ page }) => {
  await mockSettingsPage(page);

  // Override: full SSE fixture that completes
  await page.route('**/api/v1/desktop/ml/download', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: FULL_SSE,
    });
  });

  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('ml-bundle-installer').scrollIntoViewIfNeeded();
  await page.getByTestId('ml-install-button').click();
  await page.waitForSelector('[data-testid="ml-installer-installed"]', { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/ml-installer-installed.png', fullPage: true });
});
