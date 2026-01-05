import { test, expect } from '@playwright/test';

test('Test additive generation - keeps existing clips', async ({ page, request }) => {
  const API_URL = 'http://localhost:8000/api/v1';
  const projectId = '4b310ada-0fc5-4d54-983a-b554d5203faf'; // Armaf Bliss

  // Get current clips BEFORE generation
  const beforeRes = await request.get(`${API_URL}/library/projects/${projectId}/clips`);
  const beforeData = await beforeRes.json();
  const clipsBefore = beforeData.clips;

  console.log('=== BEFORE GENERATION ===');
  console.log('Number of clips:', clipsBefore.length);
  clipsBefore.forEach((clip: any, i: number) => {
    console.log(`  Clip ${i + 1}: variant_${clip.variant_index}, id=${clip.id.substring(0, 8)}..., name="${clip.variant_name}"`);
  });

  const clipIdsBefore = clipsBefore.map((c: any) => c.id);
  const maxVariantBefore = Math.max(...clipsBefore.map((c: any) => c.variant_index));
  console.log('Max variant index before:', maxVariantBefore);

  // Navigate to library
  await page.goto('http://localhost:3001/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on "Armaf Bliss" project
  await page.locator('text=Armaf Bliss').click();
  await page.waitForTimeout(2000);

  // Screenshot before
  await page.screenshot({
    path: 'screenshots/additive-01-before.png',
    fullPage: true
  });

  // Click the generate button
  const generateButton = page.locator('button:has-text("GENEREAZĂ")');
  await generateButton.click();
  console.log('Clicked generate button');

  // Wait for generation to complete (up to 90 seconds)
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(1000);
    const statusRes = await request.get(`${API_URL}/library/projects/${projectId}`);
    const statusData = await statusRes.json();

    if (i % 10 === 0) {
      console.log(`  Progress check ${i}s: status=${statusData.status}`);
    }

    if (statusData.status === 'ready_for_triage') {
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
    path: 'screenshots/additive-02-after.png',
    fullPage: true
  });

  // Get clips AFTER generation
  const afterRes = await request.get(`${API_URL}/library/projects/${projectId}/clips`);
  const afterData = await afterRes.json();
  const clipsAfter = afterData.clips;

  console.log('\n=== AFTER GENERATION ===');
  console.log('Number of clips:', clipsAfter.length);
  clipsAfter.forEach((clip: any, i: number) => {
    console.log(`  Clip ${i + 1}: variant_${clip.variant_index}, id=${clip.id.substring(0, 8)}..., name="${clip.variant_name}"`);
  });

  const clipIdsAfter = clipsAfter.map((c: any) => c.id);

  // VERIFY: Old clip IDs should still exist
  console.log('\n=== VERIFICATION ===');
  const oldClipsPreserved = clipIdsBefore.every((id: string) => clipIdsAfter.includes(id));
  console.log('Old clips preserved:', oldClipsPreserved ? '✓ YES' : '✗ NO');

  // VERIFY: We should have MORE clips now
  const hasMoreClips = clipsAfter.length > clipsBefore.length;
  console.log('Has more clips:', hasMoreClips ? `✓ YES (${clipsBefore.length} -> ${clipsAfter.length})` : '✗ NO');

  // VERIFY: New clips should have higher variant_index
  const newClips = clipsAfter.filter((c: any) => !clipIdsBefore.includes(c.id));
  console.log('New clips added:', newClips.length);
  newClips.forEach((clip: any) => {
    console.log(`  NEW: variant_${clip.variant_index}, id=${clip.id.substring(0, 8)}...`);
  });

  // Assert
  expect(oldClipsPreserved).toBe(true);
  expect(hasMoreClips).toBe(true);
  expect(newClips.length).toBeGreaterThan(0);

  console.log('\n=== ADDITIVE GENERATION SUCCESS ===');
});
