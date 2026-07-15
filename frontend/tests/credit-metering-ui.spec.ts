import { expect, test } from "@playwright/test";

test("web Seedance is fixed to five seconds and shows the 402 billing action", async ({ page }) => {
  const profile = {
    id: "metering-ui-profile",
    name: "Metering UI",
    is_default: true,
    created_at: "2026-07-15T00:00:00Z",
  };
  let submittedDuration: unknown;

  await page.addInitScript((initialProfile) => {
    localStorage.setItem("editai_profiles", JSON.stringify([initialProfile]));
    localStorage.setItem("editai_current_profile_id", initialProfile.id);
  }, profile);

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (request.method() === "POST" && path.endsWith("/video-gen/generate")) {
      submittedDuration = request.postDataJSON().duration;
      await route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            code: "insufficient_credits",
            message: "You do not have enough Blipost credits for this operation. Add credits to continue.",
            billing_url: "https://blipost.com/billing",
          },
        }),
      });
      return;
    }

    if (path.endsWith("/profiles/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([profile]),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/create-video");

  const duration = page.getByRole("combobox").first();
  await expect(duration).toBeDisabled();
  await expect(duration).toContainText("5 seconds");
  await expect(page.getByText("Web generations use the fixed 5-second credit rate.")).toBeVisible();

  await page.getByLabel("Prompt").fill("A cinematic product reveal with warm studio lighting");
  await page.getByRole("button", { name: "Generate with Seedance 2.0" }).click();

  await expect(page.getByText("You do not have enough Blipost credits for this operation. Add credits to continue.")).toBeVisible();
  await expect(page.getByText("The operation was not started. Add credits to continue.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage credits" })).toBeVisible();
  expect(submittedDuration).toBe("5");
  await page.waitForTimeout(500); // Let the toast finish its entrance animation before capture.

  await page.screenshot({
    path: "../docs/wiki/assets/goal-b2-no-credits.png",
    fullPage: true,
  });
});

test("TTS Library creation shows the shared 402 billing action", async ({ page }) => {
  const profile = {
    id: "metering-tts-profile",
    name: "Metering TTS",
    is_default: true,
    created_at: "2026-07-15T00:00:00Z",
  };
  let createRequests = 0;

  await page.addInitScript((initialProfile) => {
    localStorage.setItem("editai_profiles", JSON.stringify([initialProfile]));
    localStorage.setItem("editai_current_profile_id", initialProfile.id);
  }, profile);

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (request.method() === "POST" && path.endsWith("/tts-library/")) {
      createRequests += 1;
      await route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            code: "insufficient_credits",
            message: "You do not have enough Blipost credits for this operation. Add credits to continue.",
            billing_url: "https://blipost.com/billing",
          },
        }),
      });
      return;
    }

    if (path.endsWith("/profiles/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([profile]),
      });
      return;
    }

    if (path.endsWith("/tts-library/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/tts-library");
  await page.getByRole("button", { name: "New TTS" }).click();
  await page.getByPlaceholder("Enter voiceover text...").fill("A friendly metered voice-over");
  await page.getByRole("button", { name: "Generate", exact: true }).click();

  await expect(page.getByText("You do not have enough Blipost credits for this operation. Add credits to continue.")).toBeVisible();
  await expect(page.getByText("The operation was not started. Add credits to continue.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage credits" })).toBeVisible();
  expect(createRequests).toBe(1);
});
