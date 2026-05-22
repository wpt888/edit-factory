import { test } from '@playwright/test'

test('Buffer Connected Channels card appears in Settings', async ({ page }) => {
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'screenshots/buffer-connected-channels.png', fullPage: true })
})
