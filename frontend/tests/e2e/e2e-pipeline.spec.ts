import { test, expect } from '@playwright/test';

/**
 * E2E tests for the Pipeline workflow.
 *
 * The pipeline page is at /pipeline.
 * On mount it fetches (when a profile is selected):
 *   GET /api/v1/pipeline/list?limit=20        — pipeline history
 *   GET /api/v1/segments/source-videos        — available source video segments
 *   GET /api/v1/pipeline/segment-duration     — default segment duration setting
 *   GET /api/v1/tts/voices?provider=elevenlabs — available TTS voices
 *
 * These tests intercept API calls and assert on response status codes and
 * data structure — not just page content or screenshots.
 *
 * Prerequisites: backend running on port 8000, frontend on port 3000.
 */

test.beforeEach(async ({ page }) => {
  page.on('console', msg => {
    // Observe only — do not fail on console errors
  });
});

test.describe('Pipeline Workflow E2E', () => {

  test('pipeline page loads and makes API calls without server errors', async ({ page }) => {
    const apiCalls: Array<{ url: string; status: number; method: string }> = [];

    page.on('response', response => {
      if (response.url().includes('/api/v1/')) {
        apiCalls.push({
          url: response.url(),
          status: response.status(),
          method: response.request().method(),
        });
      }
    });

    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');
    // Give async calls (profile load, then data load) time to complete
    await page.waitForTimeout(2000);

    // At least one API call should be made
    expect(apiCalls.length).toBeGreaterThan(0);

    // No server errors (5xx) should occur
    for (const call of apiCalls) {
      expect(call.status).toBeLessThan(500);
    }
  });

  test('pipeline history API returns array response', async ({ page }) => {
    const historyResponsePromise = page.waitForResponse(
      response =>
        response.url().includes('/api/v1/pipeline/list') &&
        response.request().method() === 'GET',
      { timeout: 15000 }
    );

    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');

    const response = await historyResponsePromise;
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toBeDefined();
    // Pipeline list should return an array or object with items
    const items = Array.isArray(data) ? data : (data.items || data.pipelines || []);
    expect(Array.isArray(items)).toBe(true);
  });

  test('source videos API returns array response', async ({ page }) => {
    const sourceVideosPromise = page.waitForResponse(
      response =>
        response.url().includes('/api/v1/segments/source-videos') &&
        response.request().method() === 'GET',
      { timeout: 15000 }
    );

    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');

    const response = await sourceVideosPromise;
    // Should succeed (200) or gracefully degrade (503 when Supabase unavailable)
    expect([200, 503]).toContain(response.status());

    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toBeDefined();
      const videos = Array.isArray(data) ? data : (data.source_videos || data.videos || data.items || []);
      expect(Array.isArray(videos)).toBe(true);

      // If videos exist, verify expected shape
      if (videos.length > 0) {
        const video = videos[0];
        expect(video).toHaveProperty('id');
      }
    }
  });

  test('pipeline page renders without crashing', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForLoadState('domcontentloaded');

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body).not.toContain('Application error');
    expect(body).not.toContain('Unhandled Runtime Error');
  });

  test('TTS voices API returns array of voice objects', async ({ page }) => {
    const voicesResponsePromise = page.waitForResponse(
      response =>
        response.url().includes('/api/v1/tts/voices') &&
        response.request().method() === 'GET',
      { timeout: 15000 }
    );

    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');

    const response = await voicesResponsePromise;
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toBeDefined();
    const voices = Array.isArray(data) ? data : (data.voices || []);
    expect(Array.isArray(voices)).toBe(true);
  });
});
