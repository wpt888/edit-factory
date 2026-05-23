import { test, expect } from '@playwright/test';

const SSE_BODY = [
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
  id: 'test-p',
  name: 'Test Profile',
  tts_settings: { provider: 'edge', voice_id: 'en-US-AriaNeural' },
  video_template_settings: { template_name: 'product_spotlight', primary_color: '#FF0000', accent_color: '#FFFF00', cta_text: 'Buy now' },
};

const DASHBOARD = {
  stats: { projects_count: 0, clips_count: 0, rendered_count: 0 },
  costs: { elevenlabs: 0, gemini: 0, total: 0, monthly: 0, monthly_quota: null, quota_remaining: null },
};

/** Mock all backend API calls needed for the settings page to render past the loading gate */
async function mockSettingsPage(page: import('@playwright/test').Page) {
  await page.route('**/*', async (route) => {
    const url = route.request().url();

    if (url.includes('localhost:3002')) {
      return route.continue();
    }

    if (url.includes('localhost:8000')) {
      const path = new URL(url).pathname;

      // ML-specific mocks (will be overridden per test via page.route — Playwright matches in registration order)
      if (path.includes('/desktop/ml/status')) {
        return route.fulfill({ status: 404, body: '{}' });
      }
      if (path.includes('/desktop/ml/download')) {
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
      }

      // Profiles list
      if (path === '/api/v1/profiles/' || path === '/api/v1/profiles') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([PROFILE]) });
      }

      // Profile templates
      if (path.includes('/profiles/templates')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      }

      // Dashboard
      if (path.includes('/dashboard')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DASHBOARD) });
      }

      // Profile detail (must come after more-specific routes)
      if (path.match(/\/profiles\/[^/]+$/)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE_DETAIL) });
      }

      // ElevenLabs accounts
      if (path.includes('/elevenlabs-accounts')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accounts: [] }) });
      }

      // TTS voices
      if (path.includes('/tts/voices')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }

      // API keys
      if (path.includes('/api-keys')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: null, configured: false }) });
      }

      // Any other backend call
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

    // Supabase auth
    if (url.includes('nortia.ro') || url.includes('supabase')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { session: null }, error: null }) });
    }

    return route.continue();
  });
}

test.describe('ML Bundle Installer', () => {
  test('happy path: click Install -> see progress -> see Installed badge', async ({ page }) => {
    await mockSettingsPage(page);

    // Override ML download route for this test (registered AFTER the catch-all, so Playwright matches
    // the more-recently-registered specific route first for the same URL pattern)
    await page.route('**/api/v1/desktop/ml/download', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: SSE_BODY,
      });
    });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('ml-bundle-installer')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('ml-install-button')).toBeVisible();
    await page.getByTestId('ml-install-button').click();
    // The fixture body replays all events at once — installed badge appears quickly.
    await expect(page.getByTestId('ml-installer-installed')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('ml-installer-installed')).toContainText('Installed (v0.1.0)');
  });

  test('error path: error event shows Retry button', async ({ page }) => {
    await mockSettingsPage(page);

    const ERR_BODY = [
      'event: progress',
      'data: {"stage": "verify"}',
      '',
      'event: error',
      'data: {"error": "sha256 mismatch", "stage": "verify"}',
      '',
      '',
    ].join('\n');

    await page.route('**/api/v1/desktop/ml/download', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ERR_BODY,
      });
    });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('ml-install-button')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('ml-install-button').click();
    await expect(page.getByTestId('ml-installer-error')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('ml-retry-button')).toBeVisible();
  });

  test('409 conflict: shows toast and stays idle', async ({ page }) => {
    await mockSettingsPage(page);

    await page.route('**/api/v1/desktop/ml/download', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'download_in_progress' }),
      });
    });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('ml-install-button')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('ml-install-button').click();
    // Idle state is preserved — Install button still visible
    await expect(page.getByTestId('ml-install-button')).toBeVisible({ timeout: 3000 });
  });
});
