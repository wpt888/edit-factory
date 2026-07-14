import { expect, test, type Page } from "@playwright/test";

const WORKSPACES = [
  { id: "workspace-a", name: "Client A", description: "First client", is_default: true, created_at: "2026-01-01" },
  { id: "workspace-b", name: "Store B", description: "Second store", is_default: false, created_at: "2026-01-02" },
];

async function selectWorkspace(page: Page, name: string) {
  const desktopTab = page.getByRole("tab", { name });
  if (await desktopTab.isVisible().catch(() => false)) {
    await desktopTab.click();
    return;
  }

  await page.getByRole("button", { name: /Client A|Store B|Select Workspace/ }).click();
  await page.getByRole("menuitemradio", { name: new RegExp(name) }).click();
}

async function expectPathname(page: Page, pathname: string) {
  await expect.poll(() => page.evaluate(() => window.location.pathname)).toBe(pathname);
}

async function expectWorkspaceRoute(page: Page, profileId: string, pathname: string) {
  await expect.poll(() => page.evaluate((id) => {
    const routes = JSON.parse(localStorage.getItem("blipost.workspace.routes.v1") || "{}");
    return routes[id];
  }, profileId)).toBe(pathname);
}

test("each profile workspace restores its own route and tab order", async ({ page }) => {
  await page.addInitScript((profiles) => {
    localStorage.setItem("editai_profiles", JSON.stringify(profiles));
    localStorage.setItem("editai_current_profile_id", "workspace-a");
  }, WORKSPACES);

  await page.route("**/api/v1/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === "/api/v1/profiles/" || requestUrl.pathname === "/api/v1/profiles") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(WORKSPACES) });
      return;
    }
    if (requestUrl.pathname === "/api/v1/desktop/auth/status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ logged_in: true }) });
      return;
    }
    // Most background list endpoints on Pipeline (source videos, TTS assets,
    // integrations) expect arrays. Object-shaped endpoints tolerate an empty
    // array while rendering their defaults.
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto("/pipeline");
  await expect(page.getByText("Client A", { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem("blipost.workspace.workspace-a.pipeline.draft"),
  )).not.toBeNull();

  await selectWorkspace(page, "Store B");
  await expectPathname(page, "/pipeline");
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem("blipost.workspace.workspace-b.pipeline.draft"),
  )).not.toBeNull();
  await page.getByRole("link", { name: "Segments", exact: true }).first().click();
  await expectPathname(page, "/segments");
  await expectWorkspaceRoute(page, "workspace-b", "/segments");

  await selectWorkspace(page, "Client A");
  await expectPathname(page, "/pipeline");
  await expectWorkspaceRoute(page, "workspace-b", "/segments");

  await selectWorkspace(page, "Store B");
  await expectPathname(page, "/segments");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("editai_current_profile_id"))).toBe("workspace-b");

  const workspaceBar = page.getByTestId("workspace-bar");
  await workspaceBar.getByRole("tab", { name: "Store B" }).dragTo(
    workspaceBar.getByRole("tab", { name: "Client A" }),
    { targetPosition: { x: 2, y: 10 } },
  );
  await expect(workspaceBar.getByRole("tab")).toHaveText(["Store B", "Client A"]);
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("blipost.workspace.order.v1") || "[]"),
  )).toEqual(["workspace-b", "workspace-a"]);
});
