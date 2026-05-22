import { test } from "@playwright/test";

test("Verify pipeline page context section with product chips", async ({ page }) => {
  await page.goto("/pipeline");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: "screenshots/verify-catalog-chips.png",
    fullPage: true,
  });
});
