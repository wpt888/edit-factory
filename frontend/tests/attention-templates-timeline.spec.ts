import { expect, test } from "@playwright/test";

const PROFILE = {
  id: "timeline-workspace",
  name: "Timeline QA",
  is_default: true,
  created_at: "2026-07-21T08:00:00Z",
};

test("attention templates uses the shared timeline chrome and clip shell", async ({ page, context }) => {
  let savedPayload: Record<string, unknown> | undefined;
  let personalTemplates: Array<Record<string, unknown>> = [];
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
    if (route.request().method() === "POST") {
      savedPayload = route.request().postDataJSON() as Record<string, unknown>;
      const saved = { ...savedPayload, id: "saved-template", is_system: false };
      personalTemplates = [saved];
      await route.fulfill({ status: 201, json: saved });
      return;
    }
    await route.fulfill({ json: { templates: personalTemplates } });
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/attention-templates");

  const timeline = page.getByTestId("attention-timeline-scroll");
  await expect(timeline).toBeVisible();
  await expect(timeline.getByLabel("Zoom timeline out")).toBeVisible();
  await expect(timeline.getByLabel("Fit the full timeline")).toHaveText("1.00x");
  await expect(timeline.getByLabel("Zoom timeline in")).toBeVisible();

  const timelineBox = await timeline.boundingBox();
  const rulerBox = await timeline.locator("[data-timeline-axis]:visible").first().boundingBox();
  expect(timelineBox).not.toBeNull();
  expect(rulerBox).not.toBeNull();
  expect(Math.round(rulerBox!.x - timelineBox!.x)).toBe(136);

  const labels = await timeline.locator("span.truncate").allInnerTexts();
  expect(labels.indexOf("V2")).toBeLessThan(labels.indexOf("V1"));
  expect(labels.indexOf("V1")).toBeLessThan(labels.indexOf("A1"));
  await expect(page.getByRole("button", { name: "Add track" })).toHaveCount(0);

  await timeline.getByLabel("Add media to V2").click();
  const imageSlot = timeline.locator('[data-testid^="attention-slot-"]');
  const audioSlot = timeline.locator('[data-testid^="attention-audio-slot-"]');
  await expect(imageSlot).toHaveCount(1);
  await expect(imageSlot).toBeVisible();
  await expect(imageSlot).toContainText("Slot 1");
  await expect(audioSlot).toHaveCount(0);
  expect((await imageSlot.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(30);

  const inspector = page.getByTestId("attention-template-inspector");
  const inspectorBox = await inspector.boundingBox();
  const durationInputBox = await inspector.getByText("Duration", { exact: true }).locator("..").locator("input").boundingBox();
  expect(inspectorBox).not.toBeNull();
  expect(durationInputBox).not.toBeNull();
  expect(durationInputBox!.x + durationInputBox!.width).toBeLessThanOrEqual(inspectorBox!.x + inspectorBox!.width);

  await timeline.getByRole("button", { name: "Open V2 track settings" }).click();
  await page.getByRole("menuitem", { name: "Add video track" }).click();
  await expect(timeline.locator("span.truncate", { hasText: /^V3$/ })).toBeVisible();

  await timeline.getByRole("button", { name: "Open A1 track settings" }).click();
  await page.getByRole("menuitem", { name: "Add audio track" }).click();
  await expect(timeline.locator("span.truncate", { hasText: /^A2$/ })).toBeVisible();

  await expect(page.getByTestId("attention-track-list")).toHaveScreenshot("attention-template-va-timeline.png", {
    animations: "disabled",
  });

  await timeline.getByLabel("Add media to A1").click();
  const soundEffectDialog = page.getByRole("dialog", { name: "Choose sound effect" });
  await expect(soundEffectDialog).toBeVisible();
  await expect(page.getByTestId("attention-template-preview")).toHaveCSS("isolation", "isolate");
  await expect(page).toHaveScreenshot("attention-template-sound-effect-dialog.png", {
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "URL" }).click();
  await page.getByLabel("Sound effect URL").fill("https://example.com/whoosh.mp3");
  await page.getByRole("button", { name: "Use sound effect URL" }).click();
  await expect(audioSlot).toHaveCount(1);
  await expect(audioSlot).toBeVisible();
  await expect(audioSlot).toContainText("Sound effect");

  await page.getByRole("button", { name: "Save template" }).click();
  await expect.poll(() => savedPayload).toBeTruthy();
  const savedTracks = savedPayload?.tracks as Array<Array<Record<string, unknown>>>;
  expect(savedPayload?.audioTrackCount).toBe(2);
  expect(savedTracks[0][0]).toMatchObject({
    sfxUrl: "https://example.com/whoosh.mp3",
    sfxTrack: 1,
  });
});

test("attention templates retries a transient fetch failure", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/v1/attention-templates", async route => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.abort("connectionrefused");
      return;
    }
    await route.fulfill({
      json: {
        templates: [{
          id: "system-quick-pulse",
          name: "Quick Pulse",
          is_system: true,
          strategy: "count",
          count: 3,
          durationMs: 1200,
          animation: "pop",
        }],
      },
    });
  });

  await page.goto("/attention-templates");
  await page.getByRole("button", { name: "Template Library" }).click();

  await expect(page.getByText("Quick Pulse")).toBeVisible();
  expect(requestCount).toBe(2);
  await expect(page.getByText("Failed to fetch")).toHaveCount(0);
});
