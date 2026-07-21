import { expect, test, type Page } from "@playwright/test";

const PROFILE = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "Design Contract",
  description: "Stable visual test profile",
  is_default: true,
  created_at: "2026-01-01T00:00:00.000Z",
};

async function mockDesignApis(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};

    if (path.endsWith("/profiles") || path.endsWith("/profiles/")) body = [PROFILE];
    else if (path.endsWith("/image-gen/templates")) body = { templates: [] };
    else if (path.endsWith("/image-gen/logo")) body = { exists: false };
    else if (path.endsWith("/product-library")) body = { products: [] };

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test("dark theme exposes the canonical two-surface contract", async ({ page }) => {
  await mockDesignApis(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/create-video");

  const shell = page.locator('[data-slot="generator-shell"]');
  await expect(shell).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI Video Generator" })).toBeVisible();

  const tokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      canvas: root.getPropertyValue("--surface-canvas").trim(),
      panel: root.getPropertyValue("--surface-panel").trim(),
      body: getComputedStyle(document.body).backgroundColor,
    };
  });
  expect(tokens).toEqual({ canvas: "#181818", panel: "#202020", body: "rgb(24, 24, 24)" });

  const cardStyle = await page.locator('[data-slot="card"]').first().evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      radius: style.borderRadius,
      shadow: style.boxShadow,
    };
  });
  expect(cardStyle).toEqual({ background: "rgb(32, 32, 32)", radius: "10px", shadow: "none" });
});

test("image and video generators share one shell contract", async ({ page }) => {
  await mockDesignApis(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/create-video");
  const videoShell = page.locator('[data-slot="generator-shell"]');
  await expect(videoShell).toBeVisible();
  const videoBox = await videoShell.boundingBox();

  await page.goto("/create-image");
  const imageShell = page.locator('[data-slot="generator-shell"]');
  await expect(imageShell).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI Image Generator" })).toBeVisible();
  const imageBox = await imageShell.boundingBox();

  expect(videoBox).not.toBeNull();
  expect(imageBox).not.toBeNull();
  expect(imageBox!.x).toBeCloseTo(videoBox!.x, 0);
  expect(imageBox!.width).toBeCloseTo(videoBox!.width, 0);
  await expect(imageShell.locator('[data-slot="card"]').first()).toHaveCSS("background-color", "rgb(32, 32, 32)");
});
