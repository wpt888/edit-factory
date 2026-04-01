import { test } from '@playwright/test';

test('Verify Buffer in Pipeline step 4 publish dialog', async ({ page }) => {
  // Listen for console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`BROWSER ERROR: ${msg.text()}`);
    }
  });

  // Listen for failed network requests
  page.on('response', response => {
    if (response.url().includes('buffer') || response.url().includes('postiz')) {
      console.log(`[${response.status()}] ${response.url()}`);
    }
  });

  await page.goto('/pipeline?step=4&id=a8bfef51-937a-43a4-af6a-88d16ade96f3');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Screenshot step 4
  await page.screenshot({ path: 'screenshots/pipeline-step4.png', fullPage: true });

  // Try to find and click any "Publish" button
  const publishBtn = page.getByRole('button', { name: /Publish|Publica|Social Media/i });
  if (await publishBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await publishBtn.first().click();
    await page.waitForTimeout(3000);
    // Screenshot the publish dialog
    await page.screenshot({ path: 'screenshots/pipeline-publish-dialog.png', fullPage: true });
  } else {
    console.log('No publish button found - video may not be rendered yet');
    await page.screenshot({ path: 'screenshots/pipeline-no-publish.png', fullPage: true });
  }
});
