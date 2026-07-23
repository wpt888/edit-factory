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

  const settingsHeader = page.getByTestId("attention-panel-header-settings");
  const monitorHeader = page.getByTestId("attention-panel-header-monitor");
  const timelineHeader = page.getByTestId("attention-panel-header-timeline");
  for (const header of [settingsHeader, monitorHeader, timelineHeader]) {
    await expect(header).toHaveCSS("height", "48px");
    await expect(header).toHaveCSS("border-bottom-style", "solid");
    await expect(header.locator('[data-slot="workspace-panel-grip"]')).toBeVisible();
    const endcapStyle = await header.evaluate((element) => {
      const style = getComputedStyle(element.parentElement!, "::after");
      return {
        content: style.content,
        height: style.height,
        borderTopStyle: style.borderTopStyle,
        backgroundColor: style.backgroundColor,
      };
    });
    expect(endcapStyle).toEqual({
      content: '\"\"',
      height: "12px",
      borderTopStyle: "solid",
      backgroundColor: "rgb(32, 32, 32)",
    });
  }
  const [settingsHeaderBox, monitorHeaderBox] = await Promise.all([
    settingsHeader.boundingBox(),
    monitorHeader.boundingBox(),
  ]);
  expect(settingsHeaderBox).not.toBeNull();
  expect(monitorHeaderBox).not.toBeNull();
  expect(settingsHeaderBox!.y).toBe(monitorHeaderBox!.y);

  const timeline = page.getByTestId("attention-timeline-scroll");
  await expect(timeline).toBeVisible();
  await expect(timeline.getByLabel("Zoom timeline out")).toBeVisible();
  await expect(timeline.getByLabel("Fit the full timeline")).toHaveText("1.00x");
  await expect(timeline.getByLabel("Zoom timeline in")).toBeVisible();

  const ruler = timeline.locator("[data-timeline-axis]:visible").first();
  await expect.poll(async () => Boolean(await timeline.boundingBox())).toBe(true);
  await expect.poll(async () => Boolean(await ruler.boundingBox())).toBe(true);
  const timelineBox = await timeline.boundingBox();
  const rulerBox = await ruler.boundingBox();
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

  const transition = inspector.getByTestId("attention-entrance-effect-select");
  await expect(transition).toContainText("Pop");
  await transition.click();
  await page.getByRole("option", { name: /Static \/ Classic/ }).click();
  await expect(transition).toContainText("Static / Classic");
  const entrance = imageSlot.locator('[data-testid^="attention-entrance-"]');
  await expect(entrance).toHaveCount(0);

  await transition.click();
  await page.getByRole("option", { name: /Wipe from right/ }).click();
  await expect(transition).toContainText("Wipe from right");
  await inspector.getByText("Entrance duration", { exact: true }).locator("..").locator("input").first().fill("0.4");
  await expect(entrance).toBeVisible();
  await expect(entrance).toHaveAttribute("title", /Entrance: Wipe from right · 400ms/);

  const slotTransition = inspector.getByRole("combobox", { name: "Slot entrance effect" });
  await expect(slotTransition).toContainText("Template default");
  await slotTransition.click();
  await page.getByRole("option", { name: /^Fade/ }).click();
  await inspector.getByTestId(/attention-slot-.*-enter-duration/).fill("0.65");
  await expect(entrance).toHaveAttribute("title", /Entrance: Fade · 650ms/);

  await timeline.getByRole("button", { name: "Open V2 track settings" }).click();
  await page.getByRole("menuitem", { name: "Add video track" }).click();
  await expect(timeline.locator("span.truncate", { hasText: /^V3$/ })).toBeVisible();

  await timeline.getByRole("button", { name: "Open A1 track settings" }).click();
  await page.getByRole("menuitem", { name: "Add audio track" }).click();
  await expect(timeline.locator("span.truncate", { hasText: /^A2$/ })).toBeVisible();

  await expect(page.getByTestId("attention-track-list")).toHaveScreenshot("attention-template-va-timeline.png", {
    animations: "disabled",
  });

  const v2Lane = timeline.locator('[data-attention-template-track-index="0"]');
  const v3Lane = timeline.locator('[data-attention-template-track-index="1"]');
  const dragSlotToLane = async (targetLane: typeof v3Lane) => {
    const [slotBox, targetLaneBox] = await Promise.all([
      imageSlot.boundingBox(),
      targetLane.boundingBox(),
    ]);
    expect(slotBox).not.toBeNull();
    expect(targetLaneBox).not.toBeNull();
    await page.mouse.move(
      slotBox!.x + slotBox!.width / 2,
      slotBox!.y + slotBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      targetLaneBox!.x + slotBox!.width / 2,
      targetLaneBox!.y + targetLaneBox!.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect.poll(async () => (await imageSlot.boundingBox())?.y).toBeGreaterThan(targetLaneBox!.y);
    await expect.poll(async () => (await imageSlot.boundingBox())?.y).toBeLessThan(targetLaneBox!.y + targetLaneBox!.height);
  };
  await dragSlotToLane(v3Lane);
  await dragSlotToLane(v2Lane);

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
  expect(savedPayload?.animation).toBe("wipe-right");
  expect(savedPayload?.enterMs).toBe(400);
  expect(savedTracks[0][0]).toMatchObject({
    animation: "fade",
    enterMs: 650,
  });
  expect(savedTracks[0][0]).toMatchObject({
    sfxUrl: "https://example.com/whoosh.mp3",
    sfxTrack: 1,
  });

  // A dragged media edge is attracted to an edge on another track and exposes
  // the shared vertical alignment guide while the magnet is active.
  await imageSlot.first().click();
  await inspector.getByText("Duration", { exact: true }).locator("..").locator("input").fill("8");
  const currentRulerBox = await ruler.boundingBox();
  expect(currentRulerBox).not.toBeNull();
  await page.mouse.click(
    currentRulerBox!.x + currentRulerBox!.width / 6,
    currentRulerBox!.y + currentRulerBox!.height / 2,
  );
  await timeline.getByLabel("Add media to V2").click();
  await expect(imageSlot).toHaveCount(2);

  const [firstSlotBox, secondSlotBox, endHandleBox] = await Promise.all([
    imageSlot.nth(0).boundingBox(),
    imageSlot.nth(1).boundingBox(),
    imageSlot.nth(0).locator('[data-testid^="attention-video-end-handle-"]').boundingBox(),
  ]);
  expect(firstSlotBox).not.toBeNull();
  expect(secondSlotBox).not.toBeNull();
  expect(endHandleBox).not.toBeNull();
  await page.mouse.move(endHandleBox!.x + endHandleBox!.width / 2, endHandleBox!.y + endHandleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(secondSlotBox!.x + 2, endHandleBox!.y + endHandleBox!.height / 2, { steps: 8 });
  await expect(timeline.locator("[data-timeline-snap-guide]")).toBeVisible();
  await page.mouse.up();
  await expect(timeline.locator("[data-timeline-snap-guide]")).toHaveCount(0);
  await expect.poll(async () => {
    const [first, second] = await Promise.all([imageSlot.nth(0).boundingBox(), imageSlot.nth(1).boundingBox()]);
    return first && second ? Math.abs(first.x + first.width - second.x) : Number.POSITIVE_INFINITY;
  }).toBeLessThan(1.5);

});

test("attention template panels exchange positions and persist their order", async ({ page }) => {
  await page.route("**/api/v1/attention-templates", async route => {
    await route.fulfill({ json: { templates: [] } });
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/attention-templates");

  const settingsHeader = page.getByTestId("attention-panel-header-settings");
  const monitorHeader = page.getByTestId("attention-panel-header-monitor");
  await expect(settingsHeader).toBeVisible();
  await expect(monitorHeader).toBeVisible();
  const [settingsBeforeMove, monitorBeforeMove] = await Promise.all([
    settingsHeader.boundingBox(),
    monitorHeader.boundingBox(),
  ]);
  expect(settingsBeforeMove).not.toBeNull();
  expect(monitorBeforeMove).not.toBeNull();

  await page.mouse.move(
    settingsBeforeMove!.x + settingsBeforeMove!.width / 2,
    settingsBeforeMove!.y + settingsBeforeMove!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    monitorBeforeMove!.x + monitorBeforeMove!.width / 2,
    monitorBeforeMove!.y + monitorBeforeMove!.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect.poll(async () => {
    const [settingsBox, monitorBox] = await Promise.all([
      settingsHeader.boundingBox(),
      monitorHeader.boundingBox(),
    ]);
    return Boolean(settingsBox && monitorBox && settingsBox.x > monitorBox.x);
  }).toBe(true);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("blipost.attention-templates.panel-order.v1")))
    .toBe('["monitor","settings","timeline"]');
});

test("program monitor is restored above the timeline from an obsolete saved order", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "blipost.attention-templates.panel-order.v1",
      '["settings","timeline","monitor"]',
    );
  });
  await page.route("**/api/v1/attention-templates", async route => {
    await route.fulfill({ json: { templates: [] } });
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/attention-templates");

  const monitorHeader = page.getByTestId("attention-panel-header-monitor");
  const timelineHeader = page.getByTestId("attention-panel-header-timeline");
  await expect(monitorHeader).toBeVisible();
  await expect(timelineHeader).toBeVisible();

  await expect.poll(async () => {
    const [monitorBox, timelineBox] = await Promise.all([
      monitorHeader.boundingBox(),
      timelineHeader.boundingBox(),
    ]);
    return Boolean(monitorBox && timelineBox && monitorBox.y < timelineBox.y);
  }).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem("blipost.attention-templates.panel-order.v1"),
  )).toBe('["settings","monitor","timeline"]');
  await expect(page.getByTestId("attention-template-editor")).toHaveScreenshot(
    "attention-template-program-monitor-layout.png",
    { animations: "disabled" },
  );
});

test("an authored attention slot overrides the template entrance effect", async ({ page }) => {
  let savedPayload: Record<string, unknown> | undefined;
  await page.route("**/api/v1/attention-templates", async route => {
    if (route.request().method() === "POST") {
      savedPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 201, json: { ...savedPayload, id: "slot-effect", is_system: false } });
      return;
    }
    await route.fulfill({ json: { templates: [] } });
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/attention-templates");

  const timeline = page.getByTestId("attention-timeline-scroll");
  await timeline.getByLabel("Add media to V2").click();
  const inspector = page.getByTestId("attention-template-inspector");
  const slotTransition = inspector.getByRole("combobox", { name: "Slot entrance effect" });
  await expect(slotTransition).toContainText("Template default");
  await slotTransition.click();
  await page.getByRole("option", { name: /^Fade/ }).click();
  await inspector.getByTestId(/attention-slot-.*-enter-duration/).fill("0.65");

  const slot = timeline.locator('[data-testid^="attention-slot-"]').first();
  await expect(slot.locator('[data-testid^="attention-entrance-"]')).toHaveAttribute(
    "title",
    /Entrance: Fade · 650ms/,
  );
  await expect(inspector.locator('[data-testid$="-effect-controls"]').last()).toHaveScreenshot(
    "attention-slot-effect-controls.png",
    { animations: "disabled" },
  );

  await page.getByRole("button", { name: "Save template" }).click();
  await expect.poll(() => savedPayload).toBeTruthy();
  const tracks = savedPayload?.tracks as Array<Array<Record<string, unknown>>>;
  expect(tracks[0][0]).toMatchObject({ animation: "fade", enterMs: 650 });
});

test("attention template playhead scrubs continuously while dragging", async ({ page }) => {
  await page.route("**/api/v1/attention-templates", async route => {
    await route.fulfill({ json: { templates: [] } });
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/attention-templates");

  const timeline = page.getByTestId("attention-timeline-scroll");
  const ruler = timeline.locator("[data-timeline-axis]:visible").first();
  const playhead = timeline.locator("[data-timeline-lane-playhead]");
  await expect(ruler).toBeVisible();

  const rulerBox = await ruler.boundingBox();
  expect(rulerBox).not.toBeNull();
  if (!rulerBox) return;

  const rulerY = rulerBox.y + rulerBox.height / 2;
  await page.mouse.move(rulerBox.x + rulerBox.width * 0.1, rulerY);
  await page.mouse.down();

  for (const ratio of [0.25, 0.45, 0.7]) {
    const targetX = rulerBox.x + rulerBox.width * ratio;
    await page.mouse.move(targetX, rulerY - 80, { steps: 3 });
    await expect.poll(async () => (await playhead.boundingBox())?.x)
      .toBeCloseTo(targetX, 0);
  }

  await page.mouse.up();
  await expect.poll(async () => (await playhead.boundingBox())?.x)
    .toBeCloseTo(rulerBox.x + rulerBox.width * 0.7, 0);
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
