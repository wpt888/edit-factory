import { expect, test } from "@playwright/test";

const PROFILE_ID = "a35ce8f1-e4ba-4bf5-b9a1-adca9016a3dc";

test("Pipeline does not navigate repeatedly when its URL is already synchronized", async ({
  page,
}) => {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    let body: unknown = {};
    if (path.endsWith("/profiles/")) {
      body = [
        {
          id: PROFILE_ID,
          name: "Regression workspace",
          description: "",
          is_default: true,
        },
      ];
    } else if (path.endsWith("/pipeline/list")) {
      body = [];
    } else if (path.endsWith("/segments/source-videos")) {
      body = [];
    } else if (path.endsWith("/pipeline/segment-duration")) {
      body = { total_segment_duration: 0 };
    } else if (path.endsWith("/ai-instructions")) {
      body = { ai_instructions: "" };
    } else if (path.endsWith("/tts/voices")) {
      body = { voices: [] };
    } else if (path.endsWith("/tts-library/")) {
      body = [];
    } else if (path.endsWith("/subtitle-presets")) {
      body = [];
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  let routeRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/pipeline" &&
      url.searchParams.get("step") === "1" &&
      (request.resourceType() === "document" || request.headers().rsc === "1")
    ) {
      routeRequests += 1;
    }
  });

  await page.goto("/pipeline?step=1");
  await expect(
    page.getByRole("region", { name: "Video idea editor" }),
  ).toBeVisible();
  await page.waitForTimeout(2_500);

  expect(routeRequests).toBe(1);
  expect(new URL(page.url()).search).toBe("?step=1");

  await page.screenshot({
    path: "screenshots/verify-pipeline-url-stability.png",
    fullPage: true,
  });
});
