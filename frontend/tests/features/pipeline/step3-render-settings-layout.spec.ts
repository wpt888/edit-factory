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

test("Step 3 keeps live timing controls left and render controls right", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_WITH_PREVIEWS}`);
  await page.waitForLoadState("networkidle");
  await enterAdvancedMode(page);

  const inspector = page.getByTestId("step3-inspector");
  const canvas = page.getByTestId("step3-variant-canvas");
  const previewTiming = inspector.getByTestId("step3-preview-timing");
  const safeZoneSettings = inspector.getByTestId("step3-safe-zone-settings");
  const renderSettings = canvas.getByTestId("step3-render-settings");
  const livePreview = page.getByTestId("subtitle-sticky-preview");
  const previewDivider = page.locator('[data-workspace-split-resize-handle="step3-preview-canvas"]');

  await expect(canvas.getByRole("button", { name: "About variant previews" })).toBeVisible({ timeout: 10_000 });
  await expect(previewDivider).toBeVisible();
  await expect(previewTiming).toBeVisible({ timeout: 10_000 });
  await expect(renderSettings).toBeVisible({ timeout: 10_000 });
  const [inspectorBackground, canvasBackground] = await Promise.all([
    inspector.evaluate((element) => getComputedStyle(element).backgroundColor),
    canvas.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(inspectorBackground).toBe(canvasBackground);
  const renderSurface = await renderSettings.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
      radius: style.borderRadius,
    };
  });
  expect(renderSurface).toEqual({
    background: inspectorBackground,
    borderWidth: "0px",
    radius: "0px",
  });
  // Inspector grammar: sections are flush, never boxed surface-panel/muted panels.
  await expect(renderSettings.locator(".bg-surface-panel")).toHaveCount(0);
  await expect(renderSettings.locator(".bg-muted\\/30, .bg-muted\\/50")).toHaveCount(0);

  const previewBefore = await livePreview.boundingBox();
  const dividerBounds = await previewDivider.boundingBox();
  expect(previewBefore).not.toBeNull();
  expect(dividerBounds).not.toBeNull();
  await page.mouse.move(
    dividerBounds!.x + dividerBounds!.width / 2,
    dividerBounds!.y + dividerBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    dividerBounds!.x + 120,
    dividerBounds!.y + dividerBounds!.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect.poll(async () => (await livePreview.boundingBox())?.width ?? 0).toBeGreaterThan(
    previewBefore!.width + 80,
  );

  await expect(previewTiming.getByText("Preview Timing", { exact: true })).toBeVisible();
  await expect(previewTiming.getByText("Pacing", { exact: true })).toBeVisible();
  await expect(safeZoneSettings).toBeVisible();
  const safeZoneToggle = safeZoneSettings.getByRole("switch", { name: "Show safe zone over preview" });
  const safeZoneFormat = safeZoneSettings.getByRole("combobox", { name: "Safe zone format" });
  await expect(safeZoneToggle).not.toBeChecked();
  await expect(safeZoneFormat).toBeDisabled();
  await expect(canvas.getByTestId("safe-zone-overlay")).toHaveCount(0);

  await safeZoneToggle.click();
  await expect(safeZoneFormat).toBeEnabled();
  await safeZoneFormat.click();
  await page.getByRole("option", { name: "Story", exact: true }).click();
  await expect(safeZoneToggle).toBeChecked();
  await expect(safeZoneFormat).toContainText("Story");

  await expect(inspector.getByText("Assembly Preset", { exact: true })).toHaveCount(0);

  await expect(inspector.getByText("Export Preset", { exact: true })).toHaveCount(0);
  await expect(inspector.getByText("Voice volume", { exact: true })).toHaveCount(0);
  await expect(renderSettings.getByText("Export Preset", { exact: true })).toBeVisible();
  await expect(renderSettings.getByText("Encoding Mode", { exact: true })).toBeVisible();

  // Flush collapsible sections open from their h-8 title trigger (no boxed panel).
  await renderSettings.getByRole("button", { name: /Video adjustments/ }).click();
  await expect(renderSettings.getByText("Color correction", { exact: true })).toBeVisible();

  await renderSettings.getByRole("button", { name: /Audio adjustments/ }).click();
  await expect(renderSettings.getByText("Voice volume", { exact: true })).toBeVisible();
  await expect(renderSettings.getByText("Fade in", { exact: true })).toBeVisible();
  await expect(renderSettings.getByText("Fade out", { exact: true })).toBeVisible();
});

test("Step 2 inspector keeps the canvas background below its cards", async ({ page }) => {
  await page.setViewportSize({ width: 1344, height: 720 });
  await page.goto(`/pipeline?step=2&id=${PIPELINE_WITH_PREVIEWS}`);
  await page.waitForLoadState("networkidle");
  await enterAdvancedMode(page);

  const inspector = page.getByTestId("step2-inspector");
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveCSS("background-color", "rgb(24, 24, 24)");
});

test("Scripts exposes the assembly preset before preview generation", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto(`/pipeline?step=2&id=${PIPELINE_WITH_PREVIEWS}`);
  await page.waitForLoadState("networkidle");
  await enterAdvancedMode(page);

  const preset = page.getByTestId("step2-assembly-preset");
  await expect(preset).toBeVisible({ timeout: 10_000 });
  await expect(preset.getByText("Assembly Preset", { exact: true })).toBeVisible();
  await expect(preset.getByText(/Applied when previews are generated\./)).toBeVisible();

  const trigger = preset.getByRole("combobox");
  await trigger.click();
  await page.getByRole("option", { name: "Max variety" }).click();
  await expect(trigger).toContainText("Max variety");
});
