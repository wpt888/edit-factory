import { test, expect } from '@playwright/test';

test('Debug 422 error - trigger generation', async ({ page }) => {
  // Enable console logging
  page.on('console', msg => {
    console.log(`Browser [${msg.type()}]: ${msg.text()}`);
  });

  // Log all network requests to generate-from-segments
  page.on('request', request => {
    if (request.url().includes('generate-from-segments')) {
      console.log('\n=== REQUEST TO generate-from-segments ===');
      console.log('URL:', request.url());
      console.log('Method:', request.method());
      console.log('Headers:', JSON.stringify(request.headers(), null, 2));
      console.log('PostData:', request.postData());
      console.log('==========================================\n');
    }
  });

  page.on('response', async response => {
    if (response.url().includes('generate-from-segments')) {
      console.log('\n=== RESPONSE FROM generate-from-segments ===');
      console.log('URL:', response.url());
      console.log('Status:', response.status());
      try {
        const body = await response.text();
        console.log('Body:', body);
      } catch (e) {
        console.log('Could not read body');
      }
      console.log('=============================================\n');
    }
  });

  // Navigate to library page
  await page.goto('http://localhost:3001/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on "Armaf Bliss" project
  const projectCard = page.locator('text=Armaf Bliss');
  if (await projectCard.isVisible()) {
    console.log('Clicking on Armaf Bliss project...');
    await projectCard.click();
    await page.waitForTimeout(2000);
  }

  // Take screenshot after selecting project
  await page.screenshot({
    path: 'screenshots/debug-422-01-project-selected.png',
    fullPage: true
  });

  // Look for GENEREAZĂ button (be more specific)
  const generateButton = page.getByRole('button', { name: /GENEREAZĂ.*VARIANTE/ });

  if (await generateButton.isVisible()) {
    console.log('Found GENEREAZĂ button, clicking...');
    await generateButton.click();

    // Wait for network request
    await page.waitForTimeout(5000);

    // Take screenshot after clicking generate
    await page.screenshot({
      path: 'screenshots/debug-422-02-after-generate.png',
      fullPage: true
    });
  } else {
    console.log('GENEREAZĂ button not visible');
  }

  // Wait for any response
  await page.waitForTimeout(3000);

  // Final screenshot
  await page.screenshot({
    path: 'screenshots/debug-422-03-final.png',
    fullPage: true
  });
});
