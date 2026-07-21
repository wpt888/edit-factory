import { expect, test } from "@playwright/test";

// Phase 4: a template slot can carry optional default content. The editor shows
// an indicator for it, and Step 3 pre-populates from it (covered separately in
// attention-step3-picker.spec.ts).

const TEMPLATE = {
  id: "tmpl-default",
  name: "With default",
  is_system: false,
  canvasWidth: 1080,
  canvasHeight: 1920,
  zone: "behind",
  animation: "pop",
  variantGapMs: 1000,
  audioTrackCount: 1,
  tracks: [[{
    id: "slot-a", x: 0.2, y: 0.2, width: 0.5, height: 0.4, opacity: 1, fit: "contain",
    startMs: 0, durationMs: 1500,
    defaultAsset: { url: "https://assets.test/brand.png", type: "image" },
    sfxVolumeDb: 0, sfxTrack: 1,
  }]],
};

test("editor surfaces a slot's saved default content", async ({ page }) => {
  await page.route("**/api/v1/attention-templates", async (route) => {
    await route.fulfill({ json: { templates: [TEMPLATE] } });
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/attention-templates");

  await page.getByRole("button", { name: "Template Library" }).click();
  await page.getByText("With default").click();

  // Select the slot on the timeline; its inspector shows the Default content block.
  await page.locator('[data-testid^="attention-slot-"]').first().click();

  const indicator = page.getByTestId("attention-default-content");
  await expect(indicator).toBeVisible();
  await expect(indicator).toContainText("pre-fills this slot in Step 3");
  await expect(page.getByRole("button", { name: "Change content" })).toBeVisible();

  // The block sits below the inspector fold; scroll it into view so the
  // screenshot actually shows the indicator.
  await indicator.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "screenshots/attention-editor-default-content.png" });
});
