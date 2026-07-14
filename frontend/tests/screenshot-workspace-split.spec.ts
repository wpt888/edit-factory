import { expect, test } from "@playwright/test";

const PROFILE = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Playwright",
  slug: "playwright",
};

test("pipeline workspace panels resize and swap", async ({ page, context }) => {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    aud: "authenticated",
    role: "authenticated",
    email: "desktop@blipost.com",
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: user.id,
    aud: "authenticated",
    exp: now + 3600,
    iat: now,
    email: user.email,
    role: "authenticated",
  })}.test-signature`;
  const session = {
    access_token: accessToken,
    refresh_token: "playwright-refresh-token",
    expires_in: 3600,
    expires_at: now + 3600,
    token_type: "bearer",
    user,
  };

  await context.addCookies([{
    name: "sb-supabase-auth-token",
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    domain: "localhost",
    path: "/",
  }]);
  await page.route("https://supabase.nortia.ro/auth/v1/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
  });
  await page.addInitScript(({ profile, authSession }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem("sb-supabase-auth-token", JSON.stringify(authSession));
  }, { profile: PROFILE, authSession: session });

  // Backend is not running; answer everything with an empty payload.
  await page.route("**/api/v1/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto("/pipeline");

  // Two separators: page split (main | history) and step1 split (source | editor)
  const separators = page.locator("[data-separator]");
  await expect(separators).toHaveCount(2, { timeout: 20_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "screenshots/workspace-split-1-default.png", fullPage: false });

  // Drag the step1 divider ~250px to the right
  const boxes = await separators.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  const inner = boxes.reduce((a, b) => (a.x < b.x ? a : b));
  await page.mouse.move(inner.x + inner.w / 2, inner.y + inner.h / 2);
  await page.mouse.down();
  await page.mouse.move(inner.x + 250, inner.y + inner.h / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "screenshots/workspace-split-2-resized.png", fullPage: false });

  // Drag from the top of a panel onto its neighbor to swap them.
  const leftPanel = page.locator('[data-workspace-split="step1"][data-workspace-split-panel="left"]');
  const rightPanel = page.locator('[data-workspace-split="step1"][data-workspace-split-panel="right"]');
  const leftBefore = await leftPanel.boundingBox();
  const rightBefore = await rightPanel.boundingBox();
  expect(leftBefore).not.toBeNull();
  expect(rightBefore).not.toBeNull();
  await page.mouse.move(leftBefore!.x + 40, leftBefore!.y + 40);
  await page.mouse.down();
  await page.mouse.move(rightBefore!.x + rightBefore!.width / 2, rightBefore!.y + 40, { steps: 10 });
  await expect(page.locator('[data-workspace-drop-indicator="step1"]')).toBeVisible();
  await page.mouse.up();
  await page.waitForTimeout(400);
  const leftAfter = await leftPanel.boundingBox();
  const rightAfter = await rightPanel.boundingBox();
  expect(leftAfter!.x).toBeGreaterThan(rightAfter!.x);
  await page.screenshot({ path: "screenshots/workspace-split-3-swapped.png", fullPage: false });

  // Reload — divider position and swap should persist from localStorage
  await page.reload();
  await expect(separators).toHaveCount(2, { timeout: 20_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "screenshots/workspace-split-4-persisted.png", fullPage: false });
});
