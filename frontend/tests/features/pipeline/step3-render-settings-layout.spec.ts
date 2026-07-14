import { expect, test } from "@playwright/test";

const PIPELINE_WITH_PREVIEWS = process.env.STEP3_RENDER_SETTINGS_PIPELINE
  ?? "5b02fde8-9517-4829-b200-a7b1552794ec";

async function enterAdvancedMode(page: import("@playwright/test").Page) {
  const advancedButton = page.getByRole("button", { name: /^Advanced$/ });
  if (await advancedButton.count() > 0) {
    await advancedButton.first().click();
    await page.waitForTimeout(600);
  }
}

test("Step 3 keeps assembly controls left and render controls right", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_WITH_PREVIEWS}`);
  await page.waitForLoadState("networkidle");
  await enterAdvancedMode(page);

  const inspector = page.getByTestId("step3-inspector");
  const canvas = page.getByTestId("step3-variant-canvas");
  const assemblySettings = inspector.getByTestId("step3-assembly-settings");
  const renderSettings = canvas.getByTestId("step3-render-settings");

  await expect(assemblySettings).toBeVisible({ timeout: 10_000 });
  await expect(renderSettings).toBeVisible({ timeout: 10_000 });
  await expect(assemblySettings.getByText("Assembly Settings", { exact: true })).toBeVisible();
  await expect(assemblySettings.getByText("Assembly Preset", { exact: true })).toBeVisible();
  await expect(assemblySettings.getByText("Pacing", { exact: true })).toBeVisible();

  await expect(inspector.getByText("Export Preset", { exact: true })).toHaveCount(0);
  await expect(inspector.getByText("Voice volume", { exact: true })).toHaveCount(0);
  await expect(renderSettings.getByText("Export Preset", { exact: true })).toBeVisible();
  await expect(renderSettings.getByText("Encoding Mode", { exact: true })).toBeVisible();

  await renderSettings.getByTestId("render-video-adjustments-trigger").click();
  await expect(renderSettings.getByText("Color correction", { exact: true })).toBeVisible();

  await renderSettings.getByTestId("render-audio-adjustments-trigger").click();
  await expect(renderSettings.getByText("Voice volume", { exact: true })).toBeVisible();
  await expect(renderSettings.getByText("Fade in", { exact: true })).toBeVisible();
  await expect(renderSettings.getByText("Fade out", { exact: true })).toBeVisible();
});
