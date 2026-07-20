import { expect, test } from "@playwright/test";

const PROFILE = {
  id: "timeline-workspace",
  name: "Timeline QA",
  is_default: true,
  created_at: "2026-07-21T08:00:00Z",
};

test("attention templates uses the shared timeline chrome and clip shell", async ({ page, context }) => {
  const now = Math.floor(Date.now() / 1000);
  const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "timeline@blipost.com" };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, aud: "authenticated", exp: now + 3600, role: "authenticated" })}.test-signature`,
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
  await page.route("https://supabase.nortia.ro/auth/v1/**", async route => {
    await route.fulfill({ json: session });
  });
  await page.addInitScript(({ profile, authSession }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem("sb-supabase-auth-token", JSON.stringify(authSession));
  }, { profile: PROFILE, authSession: session });
  await page.route("**/api/v1/attention-templates", async route => {
    await route.fulfill({ json: { templates: [] } });
  });

  await page.goto("/attention-templates");

  const timeline = page.getByTestId("attention-timeline-scroll");
  await expect(timeline).toBeVisible();
  await expect(timeline.getByLabel("Zoom timeline out")).toBeVisible();
  await expect(timeline.getByLabel("Fit the full timeline")).toHaveText("1.00x");
  await expect(timeline.getByLabel("Zoom timeline in")).toBeVisible();

  const timelineBox = await timeline.boundingBox();
  const rulerBox = await timeline.locator("[data-timeline-axis]").first().boundingBox();
  expect(timelineBox).not.toBeNull();
  expect(rulerBox).not.toBeNull();
  expect(Math.round(rulerBox!.x - timelineBox!.x)).toBe(136);

  await timeline.getByLabel("Add image slot to V2").click();
  await expect(timeline.locator('[data-testid^="attention-slot-"]')).toHaveCount(1);
  await expect(timeline.locator("[data-timeline-block]")).toContainText("Slot 1");
});
