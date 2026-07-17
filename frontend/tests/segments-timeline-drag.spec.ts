import { expect, test } from "@playwright/test";

const PROFILE = {
  id: "timeline-workspace",
  name: "Timeline Workspace",
  description: "Timeline drag regression test",
  is_default: true,
  created_at: "2026-07-16T08:00:00Z",
};

const VIDEO = {
  id: "timeline-video",
  name: "Timeline source",
  file_path: "C:\\Videos\\timeline-source.mp4",
  thumbnail_path: null,
  duration: 30,
  width: 1920,
  height: 1080,
  fps: 30,
  file_size_bytes: 1024,
  segments_count: 1,
  status: "ready",
  preview_proxy_status: "ready",
  created_at: "2026-07-16T08:00:00Z",
};

const SEGMENT = {
  id: "timeline-segment",
  source_video_id: VIDEO.id,
  start_time: 2,
  end_time: 5,
  duration: 3,
  keywords: ["movable"],
  usage_count: 0,
  is_favorite: false,
  notes: "",
  transforms: null,
  product_group: null,
  single_use: false,
  created_at: "2026-07-16T08:00:00Z",
  source_video_name: VIDEO.name,
};

test("segment body moves the range while the timeline moves the playhead separately", async ({ page, context }) => {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "22222222-2222-4222-8222-222222222222",
    aud: "authenticated",
    role: "authenticated",
    email: "timeline@blipost.com",
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
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(session),
    });
  });
  await page.addInitScript(({ profile, authSession }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem("sb-supabase-auth-token", JSON.stringify(authSession));
  }, { profile: PROFILE, authSession: session });

  let serverSegment = { ...SEGMENT };
  const timingWrites: Array<{ start_time: number; end_time: number }> = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/v1/profiles" || path === "/api/v1/profiles/") {
      await route.fulfill({ json: [PROFILE] });
      return;
    }
    if (path === `/api/v1/segments/${SEGMENT.id}` && request.method() === "PATCH") {
      const timing = JSON.parse(request.postData() || "{}") as { start_time: number; end_time: number };
      timingWrites.push(timing);
      serverSegment = {
        ...serverSegment,
        ...timing,
        duration: timing.end_time - timing.start_time,
      };
      await route.fulfill({ json: serverSegment });
      return;
    }
    if (path === "/api/v1/segments/source-videos") {
      await route.fulfill({ json: [VIDEO] });
      return;
    }
    if (path === `/api/v1/segments/source-videos/${VIDEO.id}`) {
      await route.fulfill({ json: VIDEO });
      return;
    }
    if (path === `/api/v1/segments/source-videos/${VIDEO.id}/segments`) {
      await route.fulfill({ json: [serverSegment] });
      return;
    }
    if (path === `/api/v1/segments/source-videos/${VIDEO.id}/product-groups`) {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === "/api/v1/segments/" || path === "/api/v1/segments") {
      await route.fulfill({ json: [serverSegment] });
      return;
    }
    if (path === "/api/v1/associations/segments") {
      await route.fulfill({ json: { associations: { [SEGMENT.id]: null } } });
      return;
    }
    if (path.endsWith("/waveform")) {
      await route.fulfill({ json: { video_id: VIDEO.id, samples: 0, duration: 0, waveform: [] } });
      return;
    }
    if (path.endsWith("/voice-detection")) {
      await route.fulfill({ json: { regions: [] } });
      return;
    }
    if (path.endsWith("/thumbnail") || path.endsWith("/stream")) {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({ json: [] });
  });

  await page.goto(`/segments?video=${VIDEO.id}&desktopAuth=confirmed`);

  const timeline = page.getByLabel("Source video timeline");
  const segment = page.locator(`[data-segment-id="${SEGMENT.id}"]`);
  const playhead = page.getByRole("button", { name: "Move playhead" });
  await expect(segment).toBeVisible({ timeout: 30_000 });
  await expect(playhead).toBeVisible();

  const timelineBox = await timeline.boundingBox();
  const segmentBox = await segment.boundingBox();
  const playheadBeforeMove = await playhead.boundingBox();
  expect(timelineBox).not.toBeNull();
  expect(segmentBox).not.toBeNull();
  expect(playheadBeforeMove).not.toBeNull();
  if (!timelineBox || !segmentBox || !playheadBeforeMove) return;

  const dragDistance = Math.min(120, timelineBox.width * 0.2);
  await page.mouse.move(segmentBox.x + segmentBox.width / 2, segmentBox.y + segmentBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    segmentBox.x + segmentBox.width / 2 + dragDistance,
    segmentBox.y + segmentBox.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();

  await expect.poll(() => timingWrites.length).toBe(1);
  expect(timingWrites[0].start_time).toBeGreaterThan(SEGMENT.start_time);
  expect(timingWrites[0].end_time - timingWrites[0].start_time).toBeCloseTo(SEGMENT.duration, 3);

  const playheadAfterSegmentMove = await playhead.boundingBox();
  expect(playheadAfterSegmentMove).not.toBeNull();
  if (!playheadAfterSegmentMove) return;
  expect(playheadAfterSegmentMove.x).toBeCloseTo(playheadBeforeMove.x, 0);

  const scrubStartX = timelineBox.x + timelineBox.width * 0.55;
  const scrubEndX = timelineBox.x + timelineBox.width * 0.75;
  const rulerY = timelineBox.y + 10;
  await page.mouse.move(scrubStartX, rulerY);
  await page.mouse.down();
  await page.mouse.move(scrubEndX, rulerY, { steps: 4 });
  await page.mouse.up();

  expect(timingWrites).toHaveLength(1);
  const playheadAfterScrub = await playhead.boundingBox();
  expect(playheadAfterScrub).not.toBeNull();
  if (!playheadAfterScrub) return;
  expect(playheadAfterScrub.x).toBeGreaterThan(playheadAfterSegmentMove.x + timelineBox.width * 0.5);
});
