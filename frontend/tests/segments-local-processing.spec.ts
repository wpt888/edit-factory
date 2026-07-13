import { expect, test } from "@playwright/test";


const PROFILE = {
  id: "workspace-local-video",
  name: "Local Video Workspace",
  description: "Polling regression test",
  is_default: true,
  created_at: "2026-07-13T08:00:00Z",
};

const PROCESSING_VIDEO = {
  id: "source-video-id",
  name: "HUGO",
  file_path: "C:\\Videos\\HUGO.MOV",
  thumbnail_path: null,
  duration: null,
  width: null,
  height: null,
  fps: null,
  file_size_bytes: null,
  segments_count: 0,
  status: "processing",
  preview_proxy_status: "pending",
  created_at: "2026-07-13T08:00:00Z",
};

const READY_VIDEO = {
  ...PROCESSING_VIDEO,
  duration: 42,
  width: 1920,
  height: 1080,
  fps: 50,
  file_size_bytes: 199_542_149,
  status: "ready",
  preview_proxy_status: "ready",
};


test("Add Local polls past the first processing response", async ({ page, context }) => {
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

  await page.addInitScript(({ profile, path, authSession }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    // The desktop Supabase client persists sessions in localStorage, while
    // the regular web client uses cookies. Seeding both keeps this regression
    // test valid against either frontend build.
    localStorage.setItem("sb-supabase-auth-token", JSON.stringify(authSession));
    Object.defineProperty(window, "editFactory", {
      configurable: true,
      value: {
        isDesktop: true,
        selectVideoFiles: async () => [path],
      },
    });
  }, { profile: PROFILE, path: PROCESSING_VIDEO.file_path, authSession: session });

  let detailPolls = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/v1/profiles" || path === "/api/v1/profiles/") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([PROFILE]) });
      return;
    }
    if (path === "/api/v1/segments/source-videos/local" && request.method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROCESSING_VIDEO) });
      return;
    }
    if (path === `/api/v1/segments/source-videos/${PROCESSING_VIDEO.id}`) {
      detailPolls += 1;
      const body = detailPolls === 1 ? PROCESSING_VIDEO : READY_VIDEO;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      return;
    }
    if (path === "/api/v1/segments/source-videos") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (path.endsWith("/waveform")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ video_id: PROCESSING_VIDEO.id, samples: 0, duration: 0, waveform: [] }),
      });
      return;
    }
    if (path.endsWith("/thumbnail") || path.endsWith("/stream")) {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto("/segments?desktopAuth=confirmed");
  await expect(page.getByRole("button", { name: "Add Local" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Add Local" }).click();

  const dialog = page.getByRole("dialog", { name: "Add Local Video" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("File Path")).toHaveValue(PROCESSING_VIDEO.file_path);
  await dialog.getByRole("button", { name: "Add Video" }).click();

  await expect(page.getByText("Processing...", { exact: true })).toBeVisible();
  await expect(page.getByText("0:42", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  expect(detailPolls).toBeGreaterThanOrEqual(2);
});
