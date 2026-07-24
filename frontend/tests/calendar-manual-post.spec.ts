import { expect, test, type Page } from "@playwright/test";

const PROFILE = {
  id: "calendar-manual-profile",
  name: "Calendar Manual",
  is_default: true,
  created_at: "2026-07-24T00:00:00Z",
};

async function mockCalendar(page: Page) {
  const published: {
    postiz?: Record<string, unknown>;
    buffer?: Record<string, unknown>;
  } = {};

  await page.addInitScript((profile) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
  }, PROFILE);

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path.endsWith("/profiles") || path.endsWith("/profiles/")) {
      await route.fulfill({ json: [PROFILE] });
      return;
    }
    if (path.endsWith("/schedule/calendar")) {
      await route.fulfill({
        json: { postiz_posts: [], schedule_items: [], days: {} },
      });
      return;
    }
    if (path.endsWith("/library/all-clips")) {
      await route.fulfill({
        json: {
          clips: [
            {
              id: "manual-clip-1",
              project_name: "Manual publishing check",
              variant_name: "Ready pipeline video",
              final_video_path: "output/manual-clip-1.mp4",
              thumbnail_path: null,
              final_status: "completed",
              context_text: "A product video used to verify manual publishing.",
              srt_content: "1\n00:00:00,000 --> 00:00:02,000\nManual test caption",
            },
          ],
          has_more: false,
        },
      });
      return;
    }
    if (path.endsWith("/postiz/integrations")) {
      await route.fulfill({
        json: [
          {
            id: "instagram-1",
            name: "Nortia Instagram",
            type: "instagram-standalone",
          },
        ],
      });
      return;
    }
    if (path.endsWith("/buffer/channels")) {
      await route.fulfill({
        json: [
          {
            id: "buffer-tiktok-1",
            name: "Nortia TikTok",
            service: "tiktok",
            type: "profile",
            is_disconnected: false,
          },
        ],
      });
      return;
    }
    if (path.endsWith("/platform/accounts")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (path.endsWith("/postiz/publish")) {
      published.postiz = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { status: "processing", job_id: "postiz-job-1" } });
      return;
    }
    if (path.endsWith("/buffer/publish")) {
      published.buffer = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { status: "processing", job_id: "buffer-job-1" } });
      return;
    }
    if (
      path.endsWith("/postiz/publish/postiz-job-1/progress") ||
      path.endsWith("/buffer/publish/buffer-job-1/progress")
    ) {
      await route.fulfill({ json: { status: "completed", percentage: 100 } });
      return;
    }

    await route.fulfill({ json: {} });
  });

  return published;
}

test("calendar plus opens the shared composer and schedules Postiz plus TikTok via Buffer", async ({ page }) => {
  const published = await mockCalendar(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/calendar");

  await expect(page.getByRole("button", { name: /Create post on/ }).first()).toBeVisible();
  const createButton = page.getByRole("button", { name: "Create post", exact: true });
  await expect(createButton).toBeVisible();
  await expect(page).toHaveScreenshot("calendar-manual-create-controls.png");
  await createButton.click();

  await expect(page.getByRole("heading", { name: "Create scheduled post" })).toBeVisible();
  await expect(page).toHaveScreenshot("calendar-manual-video-picker.png");
  await page.getByRole("button", { name: "Select Ready pipeline video" }).click();

  await expect(page.getByRole("heading", { name: "Publish to Social Media" })).toBeVisible();
  await expect(page.getByText("Nortia Instagram", { exact: true })).toBeVisible();
  await expect(page.getByText("Nortia TikTok", { exact: true })).toBeVisible();
  await expect(page.getByText("Buffer", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Schedule", exact: true }).last()).toBeEnabled();

  await page.getByRole("button", { name: "Schedule", exact: true }).last().click();
  await expect(page.getByText("Post scheduled!", { exact: true })).toBeVisible();

  await expect.poll(() => published.postiz).toMatchObject({
    clip_id: "manual-clip-1",
    caption: "Manual test caption",
    integration_ids: ["instagram-1"],
  });
  await expect.poll(() => published.buffer).toMatchObject({
    clip_id: "manual-clip-1",
    caption: "Manual test caption",
    channel_id: "buffer-tiktok-1",
  });
  expect(published.postiz?.schedule_date).toEqual(published.buffer?.schedule_date);
});
