import { test, expect } from '@playwright/test';

test.describe('Librarie Page - Delete Functionality', () => {
  test('should load librarie page and show clips with delete button', async ({ page }) => {
    // Navigate to librarie
    await page.goto('/librarie');

    // Wait for page to load
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Take screenshot of initial state
    await page.screenshot({
      path: 'screenshots/librarie-initial.png',
      fullPage: true
    });

    // Check if page loaded correctly
    const pageTitle = await page.locator('h1').first().textContent();
    console.log('Page title:', pageTitle);

    // Check for any error messages
    const errorMessages = await page.locator('.text-red-500, .text-destructive, [role="alert"]').all();
    if (errorMessages.length > 0) {
      for (const error of errorMessages) {
        console.log('Error found:', await error.textContent());
      }
    }

    // Check for loading state
    const loadingIndicator = await page.locator('text=Se încarcă').count();
    console.log('Loading indicators:', loadingIndicator);

    // Wait a bit more if loading
    if (loadingIndicator > 0) {
      await page.waitForTimeout(3000);
    }

    // Check for clips
    const clipCards = await page.locator('[class*="Card"], .card, [data-testid*="clip"]').all();
    console.log('Clip cards found:', clipCards.length);

    // Check for any buttons
    const allButtons = await page.locator('button').all();
    console.log('Total buttons on page:', allButtons.length);

    // Look for delete button specifically (Trash icon)
    const deleteButtons = await page.locator('button:has(svg.lucide-trash-2), button[title*="Șterge"]').all();
    console.log('Delete buttons found:', deleteButtons.length);

    // Look for any video thumbnails
    const thumbnails = await page.locator('video, img[src*="thumbnail"], .aspect-video').all();
    console.log('Thumbnails/videos found:', thumbnails.length);

    // Take another screenshot after loading
    await page.screenshot({
      path: 'screenshots/librarie-loaded.png',
      fullPage: true
    });

    // Check navbar logo link
    const logoLink = await page.locator('a:has-text("EditAI")').first();
    const logoHref = await logoLink.getAttribute('href');
    console.log('Logo href:', logoHref);

    // Check console errors
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Reload to catch console errors
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    if (consoleErrors.length > 0) {
      console.log('Console errors:', consoleErrors);
    }

    // Final screenshot
    await page.screenshot({
      path: 'screenshots/librarie-final.png',
      fullPage: true
    });
  });

  test('check API response for clips', async ({ page }) => {
    // Intercept API calls
    const apiCalls: string[] = [];

    page.on('response', response => {
      if (response.url().includes('/api/') || response.url().includes(':8000')) {
        apiCalls.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto('/librarie');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    console.log('API calls made:');
    apiCalls.forEach(call => console.log('  ', call));

    await page.screenshot({
      path: 'screenshots/librarie-api-check.png',
      fullPage: true
    });
  });
});
