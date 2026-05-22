import { test } from '@playwright/test';

test('Segments page shows data after selecting Nortia profile', async ({ page }) => {
  // Set Nortia profile in localStorage before navigating
  await page.goto('http://localhost:3001');
  await page.evaluate(() => {
    localStorage.setItem('editai_current_profile_id', '1d651396-6bea-4774-bf53-ad17bbc5ad42');
    localStorage.setItem('editai_profiles', JSON.stringify([
      { id: '00000000-0000-0000-0000-000000000000', name: 'Default', is_default: true, created_at: '2025-01-01' },
      { id: '1d651396-6bea-4774-bf53-ad17bbc5ad42', name: 'Nortia', is_default: false, created_at: '2025-01-01' },
      { id: '72fffc27-ae54-49b5-9e96-2843645379f4', name: 'Obsid', is_default: false, created_at: '2025-01-01' },
    ]));
  });

  // Navigate to segments page
  await page.goto('http://localhost:3001/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Screenshot initial state
  await page.screenshot({ path: 'screenshots/segments-nortia-profile.png', fullPage: true });

  // Check if "New Jilin" appears in the left sidebar
  const newJilin = page.locator('text=New Jilin');
  const isVisible = await newJilin.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`New Jilin visible: ${isVisible}`);

  // If visible, click it to load segments
  if (isVisible) {
    await newJilin.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'screenshots/segments-new-jilin-selected.png', fullPage: true });
  }
});
