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

test("Preview stays edit-only and Export owns the render controls", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_WITH_PREVIEWS}`);
  await page.waitForLoadState("networkidle");
  await enterAdvancedMode(page);

  const inspector = page.getByTestId("step3-inspector");
  const canvas = page.getByTestId("step3-variant-canvas");
  const previewTiming = inspector.getByTestId("step3-preview-timing");
  const safeZoneSettings = inspector.getByTestId("step3-safe-zone-settings");
  const renderSettings = page.getByTestId("export-render-settings");
  const livePreview = page.getByTestId("subtitle-sticky-preview");
  const previewDivider = page.locator('[data-workspace-split-resize-handle="step3-preview-canvas"]');

  await expect(canvas.getByRole("button", { name: "About variant previews" })).toBeVisible({ timeout: 10_000 });
  await expect(previewDivider).toBeVisible();
  await expect(previewTiming).toBeVisible({ timeout: 10_000 });
  await expect(renderSettings).toHaveCount(0);
  const [inspectorBackground, canvasBackground] = await Promise.all([
    inspector.evaluate((element) => getComputedStyle(element).backgroundColor),
    canvas.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(inspectorBackground).toBe(canvasBackground);
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
  await previewTiming.getByRole("button", { name: /^Preview Timing/ }).click();
  await expect(previewTiming.getByText("Pacing", { exact: true })).toBeHidden();
  await previewTiming.getByRole("button", { name: /^Preview Timing/ }).click();
  await expect(previewTiming.getByText("Pacing", { exact: true })).toBeVisible();

  await expect(safeZoneSettings).toBeVisible();
  await safeZoneSettings.getByRole("button", { name: /^Safe Zone/ }).click();
  await expect(safeZoneSettings.getByText("Show over preview", { exact: true })).toBeHidden();
  await safeZoneSettings.getByRole("button", { name: /^Safe Zone/ }).click();
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
  await page.getByTestId("pipeline-mode-export").click();
  await expect(renderSettings).toBeVisible({ timeout: 10_000 });
  await expect(renderSettings.getByText("Export Preset", { exact: true })).toBeVisible();
  await expect(renderSettings.getByText("Encoding Mode", { exact: true })).toBeVisible();
  await expect(page.getByTestId("step3-workspace")).toHaveCount(0);
  await expect(page.getByTestId("pipeline-mode-export")).toHaveAttribute("data-state", "active");

  // Inspector grammar: sections are flush, never boxed surface-panel/muted panels.
  await expect(renderSettings.locator(".bg-surface-panel")).toHaveCount(0);
  await expect(renderSettings.locator(".bg-muted\\/30, .bg-muted\\/50")).toHaveCount(0);

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

  const sourceHeader = page.getByTestId("source-videos-header");
  const reviewHeader = page.getByTestId("step2-review-header");
  await expect(sourceHeader).toBeVisible();
  await expect(reviewHeader).toBeVisible();
  const [sourceHeaderBox, reviewHeaderBox] = await Promise.all([
    sourceHeader.boundingBox(),
    reviewHeader.boundingBox(),
  ]);
  expect(sourceHeaderBox).not.toBeNull();
  expect(reviewHeaderBox).not.toBeNull();
  expect(Math.abs(sourceHeaderBox!.y - reviewHeaderBox!.y)).toBeLessThanOrEqual(1);
  expect(sourceHeaderBox!.height).toBe(reviewHeaderBox!.height);

  const actionDockPanel = page.getByTestId("step2-action-dock");
  const actionDock = page.getByTestId("step2-secondary-actions");
  await expect(actionDockPanel).toBeVisible();
  await expect(actionDock).toBeVisible();
  await expect(reviewHeader.getByRole("button", { name: "Regenerate all scripts" })).toHaveCount(0);
  await expect(actionDock.getByRole("button")).toHaveCount(3);
  const [actionDockPanelBox, actionDockBox, reviewHeaderBounds] = await Promise.all([
    actionDockPanel.boundingBox(),
    actionDock.boundingBox(),
    reviewHeader.boundingBox(),
  ]);
  expect(actionDockPanelBox).not.toBeNull();
  expect(actionDockBox).not.toBeNull();
  expect(reviewHeaderBounds).not.toBeNull();
  expect(actionDockPanelBox!.y).toBe(reviewHeaderBounds!.y + reviewHeaderBounds!.height);
  expect(actionDockBox!.y).toBeGreaterThanOrEqual(actionDockPanelBox!.y);
  expect(actionDockBox!.y + actionDockBox!.height).toBeLessThanOrEqual(
    actionDockPanelBox!.y + actionDockPanelBox!.height,
  );

  const backToIdea = actionDock.getByRole("button", { name: "Back to Idea" });
  await backToIdea.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Back to Idea");

  await page.screenshot({ path: "screenshots/step2-panel-header-alignment.png", fullPage: false });
});

test("Step 2 keeps raw ElevenLabs credit errors out of the configuration header", async ({
  page,
}) => {
  const rawError =
    '{"detail":{"code":"elevenlabs_governance_unavailable","message":"ElevenLabs credit ledger is unavailable"}}';
  await page.route("**/elevenlabs-accounts/credits", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: rawError,
    });
  });

  await page.setViewportSize({ width: 1344, height: 720 });
  await page.goto(`/pipeline?step=2&id=${PIPELINE_WITH_PREVIEWS}`, {
    waitUntil: "domcontentloaded",
  });
  await enterAdvancedMode(page);

  const configurationHeader = page.getByTestId("step2-tts-header");
  await expect(configurationHeader).toBeVisible();
  await expect(configurationHeader).not.toContainText("elevenlabs_governance_unavailable");

  const retry = configurationHeader.getByRole("button", {
    name: "ElevenLabs credits unavailable. Retry",
  });
  await expect(retry).toBeVisible();
  await retry.hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "ElevenLabs credits unavailable. Click to retry.",
  );
});

test("Scripts exposes the assembly preset before preview generation", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto(`/pipeline?step=2&id=${PIPELINE_WITH_PREVIEWS}`, {
    waitUntil: "domcontentloaded",
  });
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
