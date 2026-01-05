import { test, expect } from '@playwright/test';

test('Test regeneration creates new database entries', async ({ page, request }) => {
  const API_URL = 'http://localhost:8000/api/v1';
  const projectId = '4b310ada-0fc5-4d54-983a-b554d5203faf'; // Armaf Bliss

  // Get current clips BEFORE regeneration
  const beforeRes = await request.get(`${API_URL}/library/projects/${projectId}/clips`);
  const beforeData = await beforeRes.json();
  const clipsBefore = beforeData.clips;

  console.log('=== BEFORE REGENERATION ===');
  console.log('Number of clips:', clipsBefore.length);
  clipsBefore.forEach((clip: any, i: number) => {
    console.log(`Clip ${i + 1}: id=${clip.id.substring(0, 8)}..., name=${clip.variant_name}, created=${clip.created_at}`);
  });

  const clipIdsBefore = clipsBefore.map((c: any) => c.id);

  // Navigate to library and trigger regeneration
  await page.goto('http://localhost:3001/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on "Armaf Bliss" project
  await page.locator('text=Armaf Bliss').click();
  await page.waitForTimeout(2000);

  // Screenshot before
  await page.screenshot({
    path: 'screenshots/regen-db-01-before.png',
    fullPage: true
  });

  // Click the generate button
  const generateButton = page.locator('button:has-text("GENEREAZĂ")');
  const isVisible = await generateButton.isVisible();
  console.log('Generate button visible:', isVisible);

  if (isVisible) {
    await generateButton.click();
    console.log('Clicked generate button, waiting for completion...');

    // Wait for generation to complete (up to 120 seconds)
    let completed = false;
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(1000);

      // Check project status via API
      const statusRes = await request.get(`${API_URL}/library/projects/${projectId}`);
      const statusData = await statusRes.json();

      console.log(`  Attempt ${i + 1}: status=${statusData.status}`);

      if (statusData.status === 'ready_for_triage') {
        completed = true;
        console.log('Generation completed!');
        break;
      }

      if (statusData.status === 'failed') {
        console.log('Generation FAILED!');
        break;
      }
    }

    await page.waitForTimeout(2000);

    // Screenshot after
    await page.screenshot({
      path: 'screenshots/regen-db-02-after.png',
      fullPage: true
    });

    // Get clips AFTER regeneration
    const afterRes = await request.get(`${API_URL}/library/projects/${projectId}/clips`);
    const afterData = await afterRes.json();
    const clipsAfter = afterData.clips;

    console.log('\n=== AFTER REGENERATION ===');
    console.log('Number of clips:', clipsAfter.length);
    clipsAfter.forEach((clip: any, i: number) => {
      console.log(`Clip ${i + 1}: id=${clip.id.substring(0, 8)}..., name=${clip.variant_name}, created=${clip.created_at}`);
    });

    const clipIdsAfter = clipsAfter.map((c: any) => c.id);

    // Verify clips have new IDs (regeneration should create new entries)
    console.log('\n=== COMPARISON ===');
    const allDifferent = clipIdsAfter.every((id: string) => !clipIdsBefore.includes(id));
    console.log('All clip IDs are different:', allDifferent);

    if (allDifferent && completed) {
      console.log('SUCCESS: Regeneration created new clips with new IDs!');
    } else if (!allDifferent && completed) {
      console.log('WARNING: Some clip IDs are the same - regeneration may have issues');
    } else {
      console.log('ERROR: Generation did not complete successfully');
    }
  } else {
    console.log('ERROR: Generate button not visible');
  }
});
