import { test } from '@playwright/test';

test('debug page structure', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Get the HTML of the page
  const clipCardsCount = await page.locator('[class*="Card"]').count();
  console.log('Cards with "Card" class:', clipCardsCount);

  // Check different selectors
  const selectors = [
    '.aspect-video',
    '[class*="aspect-video"]',
    '[class*="aspect"]',
    '.relative.aspect-video',
    'div[class*="rounded"]',
    '[class*="overflow-hidden"]',
    'img[src*="thumbnail"]',
    'button:has(.lucide-trash)',
    'button:has(.lucide-trash-2)',
    'button[title*="Șterge"]',
    '.lucide-trash-2',
    'svg.lucide-trash-2'
  ];

  for (const sel of selectors) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      console.log(`Selector "${sel}": ${count} elements`);
    }
  }

  // Get a snippet of the page HTML around clip cards
  const bodyHTML = await page.locator('main').innerHTML();

  // Find all buttons and their attributes
  const buttons = await page.locator('button').all();
  console.log(`\nTotal buttons: ${buttons.length}`);

  for (let i = 0; i < Math.min(buttons.length, 30); i++) {
    const btn = buttons[i];
    const classes = await btn.getAttribute('class');
    const title = await btn.getAttribute('title');
    const innerText = await btn.innerText().catch(() => '');
    const innerHTML = await btn.innerHTML();

    // Check if it has trash icon
    if (innerHTML.includes('trash') || innerHTML.includes('Trash') || title?.includes('Șterge')) {
      console.log(`Button ${i}: title="${title}" classes="${classes?.substring(0, 50)}..." hasTrash=true`);
    }
  }

  // Take screenshot
  await page.screenshot({
    path: 'screenshots/debug-structure.png',
    fullPage: true
  });

  // Hover over first thumbnail image and check what appears
  const firstImg = page.locator('img[src*="thumbnail"]').first();
  if (await firstImg.count() > 0) {
    await firstImg.hover();
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: 'screenshots/debug-after-hover.png',
      fullPage: true
    });

    // Check for trash button after hover
    const trashAfterHover = await page.locator('svg.lucide-trash-2, .lucide-trash-2').count();
    console.log(`Trash icons after hover: ${trashAfterHover}`);
  }
});
