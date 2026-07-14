import { expect, test } from "@playwright/test";

const PROFILE = {
  id: "workspace-a",
  name: "Demo Workspace",
  description: "Automation mirror QA",
  is_default: true,
  created_at: "2026-07-13T08:00:00Z",
};

test("syncs cloud automation nodes and canonical JSON for the signed-in desktop account", async ({ page, context }) => {
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
  const accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, aud: "authenticated", exp: now + 3600, iat: now, email: user.email, role: "authenticated" })}.test-signature`;
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

  await page.addInitScript((profile) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
  }, PROFILE);

  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/profiles" || path === "/api/v1/profiles/") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([PROFILE]) });
      return;
    }
    if (path === "/api/v1/desktop/auth/status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ logged_in: true }) });
      return;
    }
    if (path === "/api/v1/platform/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connected: true, balance: 1240 }) });
      return;
    }
    if (path === "/api/v1/platform/automations") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          connected: true,
          webUrl: "https://blipost.com",
          automations: [
            {
              id: "a1111111-1111-4111-8111-111111111111",
              name: "Daily product reel",
              enabled: true,
              triggerType: "schedule",
              triggerConfig: { mode: "daily", hourUtc: 9 },
              definition: {
                nodes: [
                  { id: "source", type: "sheets_source", config: { sheetId: "demo" } },
                  { id: "caption", type: "ai_text", config: { kind: "caption" } },
                  { id: "video", type: "ai_video", config: { model: "wan-2.5" } },
                  { id: "publish", type: "publish_post", config: { accountIds: ["tiktok-demo"] } },
                ],
                edges: [
                  { from: "__trigger", to: "source" },
                  { from: "source", to: "caption" },
                  { from: "caption", to: "video" },
                  { from: "video", to: "publish" },
                ],
              },
              lastRunAt: "2026-07-13T09:02:00Z",
              createdAt: "2026-07-01T08:00:00Z",
              updatedAt: "2026-07-13T09:02:00Z",
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/automations?desktopAuth=confirmed");
  await expect(page.getByRole("heading", { name: "Automations" })).toBeVisible();
  await expect(page.getByText("Daily product reel", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Google Sheets", { exact: true })).toBeVisible();
  await expect(page.getByText("Canonical workflow JSON", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New automation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save to cloud" })).toBeVisible();
  await expect(page.getByText("Connect your Blipost account", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "screenshots/automations-sync.png", fullPage: true });
});
