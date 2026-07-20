import { expect, test } from "@playwright/test";

const PIPELINE_WITH_PREVIEWS = process.env.STEP3_RENDER_SETTINGS_PIPELINE
  ?? "5b02fde8-9517-4829-b200-a7b1552794ec";

test("Step 3 hides Script History by default and toggles it from the toolbar", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_WITH_PREVIEWS}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);

  // History hidden by default on Step 3 → previews claim the full width.
  await expect(page.getByTestId("pipeline-history-sidebar")).toHaveCount(0);
  await page.screenshot({ path: "screenshots/step3-history-hidden.png", fullPage: false });

  // Toggle history on. Fire the DOM click directly (still triggers React
  // onClick) since fixed preview panels overlap the toolbar in headless runs.
  await page.getByTestId("pipeline-history-toggle").evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(500);
  await expect(page.getByTestId("pipeline-history-sidebar")).toBeVisible();
  await page.screenshot({ path: "screenshots/step3-history-shown.png", fullPage: false });
});

test("Step 1 still shows Script History", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto(`/pipeline?step=1&id=${PIPELINE_WITH_PREVIEWS}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await expect(page.getByTestId("pipeline-history-sidebar")).toBeVisible();
  await page.screenshot({ path: "screenshots/step1-history-visible.png", fullPage: false });
});
