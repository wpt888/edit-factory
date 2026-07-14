import { expect, test } from "@playwright/test";

const PROFILE = {
  id: "undo-workspace",
  name: "Undo Workspace",
  description: "Undo regression test",
  is_default: true,
  created_at: "2026-07-14T08:00:00Z",
};

const VIDEO = {
  id: "undo-video",
  name: "Undo source",
  file_path: "C:\\Videos\\undo-source.mp4",
  thumbnail_path: null,
  duration: 30,
  width: 1080,
  height: 1920,
  fps: 30,
  file_size_bytes: 1024,
  segments_count: 1,
  status: "ready",
  preview_proxy_status: "ready",
  created_at: "2026-07-14T08:00:00Z",
};

const DEFAULT_TRANSFORMS = {
  rotation: 0,
  scale: 1,
  pan_x: 0,
  pan_y: 0,
  flip_h: false,
  flip_v: false,
  opacity: 1,
};

const SEGMENT = {
  id: "undo-segment",
  source_video_id: VIDEO.id,
  start_time: 1,
  end_time: 4,
  duration: 3,
  keywords: ["undo-keyword"],
  usage_count: 0,
  is_favorite: false,
  notes: "",
  transforms: DEFAULT_TRANSFORMS,
  product_group: null,
  single_use: false,
  created_at: "2026-07-14T08:00:00Z",
  source_video_name: VIDEO.name,
};

test("Ctrl+Z uses native text history and application transform history", async ({ page, context }) => {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    aud: "authenticated",
    role: "authenticated",
    email: "undo@blipost.com",
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

  const transformWrites: typeof DEFAULT_TRANSFORMS[] = [];
  let serverTransforms = { ...DEFAULT_TRANSFORMS };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/v1/profiles" || path === "/api/v1/profiles/") {
      await route.fulfill({ json: [PROFILE] });
      return;
    }
    if (path === `/api/v1/segments/${SEGMENT.id}/transforms` && request.method() === "PUT") {
      serverTransforms = JSON.parse(request.postData() || "{}") as typeof DEFAULT_TRANSFORMS;
      transformWrites.push({ ...serverTransforms });
      await route.fulfill({ json: { id: SEGMENT.id, transforms: serverTransforms } });
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
      await route.fulfill({ json: [{ ...SEGMENT, transforms: serverTransforms }] });
      return;
    }
    if (path === `/api/v1/segments/source-videos/${VIDEO.id}/product-groups`) {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === "/api/v1/segments/" || path === "/api/v1/segments") {
      await route.fulfill({ json: [{ ...SEGMENT, transforms: serverTransforms }] });
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

  await page.goto(`/segments?video=${VIDEO.id}`);
  const segmentKeyword = page.locator('[data-slot="badge"]', { hasText: "undo-keyword" });
  await expect(segmentKeyword).toBeVisible({ timeout: 30_000 });
  await segmentKeyword.click();
  await expect(page.getByText("Transforms", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /^90/ }).first().click();
  await expect.poll(() => transformWrites.length).toBe(1);
  expect(transformWrites.at(-1)?.rotation).toBe(90);

  // A focused text field retains Chromium's native undo stack. It must not
  // consume the segment transform action registered at application level.
  const search = page.getByPlaceholder("Search...", { exact: true });
  await search.click();
  await search.pressSequentially("needle");
  await expect(search).toHaveValue("needle");
  await page.keyboard.press("Control+z");
  await expect(search).toHaveValue("needl");
  expect(transformWrites).toHaveLength(1);
  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press("Control+z");
  }
  await expect(search).toHaveValue("");
  expect(transformWrites).toHaveLength(1);

  await page.getByText("Transforms", { exact: true }).click();
  await page.keyboard.press("Control+z");
  await expect.poll(() => transformWrites.length).toBe(2);
  expect(transformWrites.at(-1)?.rotation).toBe(0);

  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => transformWrites.length).toBe(3);
  expect(transformWrites.at(-1)?.rotation).toBe(90);

  // Undo also works before the 500 ms autosave fires. The pending 180-degree
  // write must be cancelled, leaving the server at the previous 90 degrees.
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^180/ }).first().click();
  await page.keyboard.press("Control+z");
  await expect.poll(() => transformWrites.length).toBe(4);
  expect(transformWrites.at(-1)?.rotation).toBe(90);
  await page.waitForTimeout(700);
  expect(transformWrites).toHaveLength(4);
  await expect(page.getByText("Nothing to undo", { exact: true })).toHaveCount(0);
});
