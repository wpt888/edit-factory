import { test } from "@playwright/test";
import * as fs from "fs";

test("Verify feed creation UI on products page", async ({ page }) => {
  // Ensure screenshots directory exists
  if (!fs.existsSync("screenshots")) {
    fs.mkdirSync("screenshots", { recursive: true });
  }

  // Navigate to products page
  await page.goto("/products");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  // Screenshot 1: products page showing Add Your First Feed or New Feed button
  await page.screenshot({
    path: "screenshots/verify-feed-creation.png",
    fullPage: true,
  });

  // Try to find and click the feed creation button (either "Add Your First Feed" or "New Feed")
  const addFirstFeedBtn = page.getByRole("button", {
    name: /Add Your First Feed/i,
  });
  const newFeedBtn = page.getByRole("button", { name: /New Feed/i });

  const hasFirstFeedBtn = await addFirstFeedBtn.isVisible().catch(() => false);
  const hasNewFeedBtn = await newFeedBtn.isVisible().catch(() => false);

  if (hasFirstFeedBtn) {
    await addFirstFeedBtn.click();
  } else if (hasNewFeedBtn) {
    await newFeedBtn.click();
  }

  // Wait for dialog to appear
  await page.waitForTimeout(500);

  // Screenshot 2: dialog with name and URL fields
  await page.screenshot({
    path: "screenshots/verify-feed-dialog.png",
    fullPage: true,
  });
});
