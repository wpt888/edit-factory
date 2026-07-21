import { expect, test } from "@playwright/test";

// Verifies the Attention Templates editor uses shadcn Select (dark popover,
// correct contrast) instead of native <select> for its inspector fields.

const PROFILE = {
  id: "attention-editor-profile",
  name: "Attention Editor QA",
  is_default: true,
  created_at: "2026-07-21T00:00:00Z",
};

test("attention-template editor inspector uses shadcn dropdowns", async ({ page }) => {
  await page.addInitScript(({ profile }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
  }, { profile: PROFILE });

  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/attention-templates")) {
      await route.fulfill({ json: { templates: [] } });
      return;
    }
    if (path.endsWith("/profiles/") || path.endsWith("/profiles")) {
      await route.fulfill({ json: [PROFILE] });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/attention-templates?desktopAuth=confirmed");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: /New template/ }).click();

  const inspector = page.getByTestId("attention-template-inspector");
  await expect(inspector).toBeVisible();

  const animation = inspector.getByRole("combobox", { name: "Animation" });
  await expect(animation).toBeVisible();
  await animation.click();
  // The shadcn listbox renders in a dark popover (bg-popover), not an OS popup.
  await expect(page.getByRole("option", { name: "tornado" })).toBeVisible();

  await page.screenshot({ path: "screenshots/attention-editor-dropdown.png", fullPage: false });
});
