import { expect, test } from "@playwright/test";

test("signed-out users see the branded Blipost login", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByText("Welcome back!", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible();
  await expect(page.getByText("Account-scoped data")).toBeVisible();
  await expect(page.getByRole("img", { name: "Blipost" })).toHaveCount(1);

  await page.screenshot({ path: "screenshots/auth-login.png", fullPage: true });
});
