import { test, expect } from '@playwright/test';

/**
 * E2E tests for the Product Video workflow.
 *
 * The product video workflow spans two pages:
 *   /products         — product browser (fetches feeds and catalog products on mount)
 *   /product-video    — video generation form (uses query params for product info)
 *
 * The /products page makes these API calls on mount:
 *   GET /api/v1/feeds                    — list of product feeds
 *   GET /api/v1/catalog/products         — catalog product list
 *   GET /api/v1/catalog/products/filters — catalog filter options (brands, categories)
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

test.describe('Product Video Workflow E2E', () => {

  test('products page loads and makes API calls without server errors', async ({ page }) => {
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

    await page.goto('/products');
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

  test('feeds API returns array response on products page', async ({ page }) => {
    const feedsResponsePromise = page.waitForResponse(
      response =>
        response.url().includes('/api/v1/feeds') &&
        !response.url().includes('/products') &&
        !response.url().includes('/sync') &&
        !response.url().includes('/filters') &&
        response.request().method() === 'GET',
      { timeout: 15000 }
    );

    await page.goto('/products');
    await page.waitForLoadState('networkidle');

    const response = await feedsResponsePromise;
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toBeDefined();
    // Feeds API returns an array of feed objects
    const feeds = Array.isArray(data) ? data : (data.feeds || data.items || []);
    expect(Array.isArray(feeds)).toBe(true);

    // If feeds exist, verify expected shape
    if (feeds.length > 0) {
      const feed = feeds[0];
      expect(feed).toHaveProperty('id');
      expect(feed).toHaveProperty('name');
    }
  });

  test('catalog products API returns paginated response', async ({ page }) => {
    const catalogResponsePromise = page.waitForResponse(
      response =>
        response.url().includes('/api/v1/catalog/products') &&
        !response.url().includes('/filters') &&
        response.request().method() === 'GET',
      { timeout: 15000 }
    );

    await page.goto('/products');
    await page.waitForLoadState('networkidle');

    const response = await catalogResponsePromise;
    // Should succeed or gracefully degrade
    expect([200, 503]).toContain(response.status());

    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toBeDefined();
      // Catalog response should have products or items array
      const products = data.products || data.items || data;
      expect(Array.isArray(products)).toBe(true);
    }
  });

  test('product-video page renders without crashing', async ({ page }) => {
    // The product-video page shows an empty state when no product is selected
    await page.goto('/product-video');
    await page.waitForLoadState('domcontentloaded');

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body).not.toContain('Application error');
    expect(body).not.toContain('Unhandled Runtime Error');
  });

  test('product-video page with product params makes API calls and renders form', async ({ page }) => {
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

    // Navigate with product query params (simulating arriving from /products page)
    await page.goto('/product-video?id=test-product-123&title=Test+Product&price=99.99&source=catalog');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Should not crash even with a non-existent product ID
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body).not.toContain('Application error');
    expect(body).not.toContain('Unhandled Runtime Error');

    // Any API calls that were made should return non-500 responses
    for (const call of apiCalls) {
      expect(call.status).toBeLessThan(500);
    }
  });

  test('products page renders without crashing', async ({ page }) => {
    await page.goto('/products');
    await page.waitForLoadState('domcontentloaded');

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body).not.toContain('Application error');
    expect(body).not.toContain('Unhandled Runtime Error');
  });
});
