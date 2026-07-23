import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PROFILE = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "Create Contract",
  description: "Stable unified-create profile",
  is_default: true,
  created_at: "2026-01-01T00:00:00.000Z",
};

interface CreateRequestCounts {
  commonsImage: number;
  commonsVideo: number;
  imageHistory: number;
  videoHistory: number;
  soundtrackHistory: number;
}

function dimensionsFor(index: number) {
  if (index % 3 === 0) return { width: 720, height: 1280 };
  if (index % 3 === 1) return { width: 1280, height: 720 };
  return { width: 900, height: 900 };
}

async function mockCreateApis(page: Page): Promise<CreateRequestCounts> {
  const stablePreview = await readFile(path.join(process.cwd(), "public", "blipost-logo.png"));
  const requests: CreateRequestCounts = {
    commonsImage: 0,
    commonsVideo: 0,
    imageHistory: 0,
    videoHistory: 0,
    soundtrackHistory: 0,
  };

  await page.route(/https:\/\/commons\.wikimedia\.org\/w\/api\.php(?:\?.*)?$/, async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get("prop") === "videoinfo") {
      requests.commonsVideo += 1;
      const titles = (requestUrl.searchParams.get("titles") ?? "").split("|");
      const pages = titles.map((title, index) => {
        const itemNumber = Number(title.match(/(\d+)\.webm$/)?.[1] ?? index + 1);
        const { width, height } = dimensionsFor(itemNumber - 1);
        return {
          pageid: 20_000 + itemNumber - 1,
          ns: 6,
          title,
          videoinfo: [
            {
              width,
              height,
              duration: 8,
              size: 2_000_000,
              mime: "video/webm",
              mediatype: "VIDEO",
              url: `https://upload.wikimedia.org/mock/verified-ai-video-${itemNumber}.webm`,
              thumburl: `https://upload.wikimedia.org/mock/verified-ai-video-${itemNumber}.jpg`,
              derivatives: [
                {
                  src: `https://upload.wikimedia.org/mock/transcoded/verified-ai-video-${itemNumber}.480p.webm`,
                  type: 'video/webm; codecs="vp9, opus"',
                  width: Math.min(width, 854),
                  height: Math.min(height, 480),
                  bandwidth: 900_000,
                  transcodekey: "480p.vp9.webm",
                },
              ],
            },
          ],
        };
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ batchcomplete: true, query: { pages } }),
      });
      return;
    }

    const search = requestUrl.searchParams.get("gsrsearch") ?? "";
    const kind = search.includes("videos") ? "video" : "image";
    const offset = Number(requestUrl.searchParams.get("gsroffset") ?? "0");
    const categoryBucket = [...search].reduce(
      (hash, character) => (hash * 31 + character.charCodeAt(0)) % 1000,
      0,
    );
    const total = kind === "image" ? 50 : 30;
    const count = Math.min(50, total - offset);
    if (kind === "image") requests.commonsImage += 1;
    else requests.commonsVideo += 1;

    const pages = Array.from({ length: count }, (_, pageIndex) => {
      const index = kind === "image"
        ? categoryBucket * 1000 + offset + pageIndex
        : offset + pageIndex;
      const { width, height } = dimensionsFor(index);
      const extension = kind === "image" ? "webp" : "webm";
      const category = kind === "image"
        ? "AI-generated images including prompts"
        : "AI-generated videos";
      return {
        pageid: (kind === "image" ? 10_000 : 20_000) + index,
        ns: 6,
        title: `File:Verified AI ${kind} ${index + 1}.${extension}`,
        imagerepository: "local",
        imageinfo: [
          {
            size: kind === "video" ? 2_000_000 : 200_000,
            width,
            height,
            duration: kind === "video" ? 8 : undefined,
            thumburl: `https://upload.wikimedia.org/mock/verified-ai-${kind}-${index + 1}.jpg`,
            thumbwidth: 640,
            thumbheight: Math.round(640 * height / width),
            url: `https://upload.wikimedia.org/mock/verified-ai-${kind}-${index + 1}.${extension}`,
            descriptionurl: `https://commons.wikimedia.org/wiki/File:Verified_AI_${kind}_${index + 1}.${extension}`,
            mime: kind === "image" ? "image/webp" : "video/webm",
            mediatype: kind === "image" ? "BITMAP" : "VIDEO",
            extmetadata: {
              Categories: { value: category },
              Artist: { value: `AI test contributor ${index + 1}` },
              LicenseShortName: { value: "CC0" },
              UsageTerms: { value: "CC0" },
              LicenseUrl: { value: "https://creativecommons.org/publicdomain/zero/1.0/" },
              AttributionRequired: { value: "false" },
            },
          },
        ],
      };
    });

    const body: Record<string, unknown> = {
      batchcomplete: true,
      query: { pages },
    };
    if (offset + count < total) {
      body.continue = {
        gsroffset: offset + count,
        continue: "gsroffset||",
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.route("https://upload.wikimedia.org/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith(".webm")) {
      await route.abort();
    } else {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: stablePreview,
      });
    }
  });

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = {};

    if (path.endsWith("/profiles") || path.endsWith("/profiles/")) body = [PROFILE];
    else if (path.endsWith("/platform/me")) body = { connected: false };
    else if (path.endsWith("/image-gen/history")) {
      requests.imageHistory += 1;
      body = {
        images: [
          {
            id: "image-1",
            prompt: "Editorial product portrait with warm directional light",
            status: "completed",
            image_url: "/blipost-logo.png",
            template_name: "Campaign portrait",
            created_at: "2026-07-23T08:00:00.000Z",
          },
          {
            id: "image-2",
            prompt: "Minimal studio still life with a deep charcoal background",
            status: "completed",
            image_url: "/blipost-logo.png",
            template_name: "Studio still life",
            created_at: "2026-07-23T07:00:00.000Z",
          },
        ],
      };
    } else if (path.endsWith("/video-gen/history")) {
      requests.videoHistory += 1;
      body = {
        videos: [
          {
            id: "video-1",
            prompt: "A cinematic vertical product reveal",
            name: "Launch reel",
            status: "completed",
            source_video_id: null,
            created_at: "2026-07-23T06:00:00.000Z",
          },
        ],
      };
    } else if (path.endsWith("/tts-library/")) {
      requests.soundtrackHistory += 1;
      body = [
        "A calm narration for the summer launch campaign.",
        "A practical voice-over for a bright yellow everyday product.",
        "A concise introduction for the new collection.",
        "A warm closing line for the campaign video.",
      ].map((ttsText, index) => ({
        id: `audio-${index + 1}`,
        tts_text: ttsText,
        mp3_url: "/mock-audio.mp3",
        srt_url: null,
        srt_content: null,
        audio_duration: 8 + index,
        char_count: ttsText.length,
        tts_model: "eleven_flash_v2_5",
        status: "ready",
        is_used: false,
        created_at: `2026-07-23T0${5 - index}:00:00.000Z`,
        updated_at: `2026-07-23T0${5 - index}:00:00.000Z`,
      }));
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  return requests;
}

async function prepareStableScreenshot(page: Page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((portal) => portal.remove());
  });
}

test("Create keeps one rights-verified mixed media feed across Image and Video", async ({ page }) => {
  const requests = await mockCreateApis(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/create");

  await expect(page.getByRole("heading", { name: "Create", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Image" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: "AI Image" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "AI Video" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "AI Studio", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Video Pipeline", exact: true })).toHaveAttribute(
    "href",
    "/pipeline",
  );
  await expect(page.getByText("Open AI Studio", { exact: true })).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "Explore AI media" })).toBeVisible();
  await expect.poll(() => requests.commonsImage).toBeGreaterThan(0);
  await expect(page.locator('section[data-catalog-source]')).toHaveAttribute(
    "data-catalog-source",
    "wikimedia-commons",
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-testid="explore-media-item"]')).toHaveCount(160);
  await expect(page.locator('[data-media-kind="image"]')).toHaveCount(130);
  await expect(page.locator('[data-media-kind="video"]')).toHaveCount(30);
  await expect(page.locator('[data-media-kind="image"] img[src]')).toHaveCount(130);
  await expect(page.locator('[data-media-kind="image"] img').first()).toHaveAttribute(
    "loading",
    "eager",
  );
  await expect(page.locator('[data-orientation="portrait"]').first()).toBeVisible();
  await expect(page.locator('[data-orientation="landscape"]').first()).toBeVisible();
  await expect(page.locator('[data-orientation="square"]').first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Use this prompt" })).toHaveCount(0);

  const firstExploreImage = page.locator('[data-media-kind="image"]').first();
  const firstImageOverlay = firstExploreImage.locator('[data-testid="media-hover-overlay"]');
  await expect(firstImageOverlay).toHaveCSS("opacity", "0");
  await firstExploreImage.hover();
  await expect(firstImageOverlay).toHaveCSS("opacity", "1");
  await expect(firstExploreImage.getByText(/AI-generated ·/)).toBeVisible();
  await expect(
    firstExploreImage.getByRole("link", { name: /Open verified source/ }),
  ).toBeVisible();

  // Waiting for history also guarantees the client has hydrated before the
  // controlled Radix tabs receive interaction.
  await expect(page.locator('[data-testid="creation-image"]')).toHaveCount(2, {
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: "Recent images" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open image history" }).first()).toHaveAttribute(
    "href",
    "/create-image",
  );
  await expect(page.locator('[data-testid="creation-video"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="creation-soundtrack"]')).toHaveCount(0);
  expect(requests.imageHistory).toBeGreaterThan(0);
  expect(requests.videoHistory).toBe(0);
  expect(requests.soundtrackHistory).toBe(0);
  await prepareStableScreenshot(page);
  await expect(page).toHaveScreenshot("unified-create-hub.png");

  const mixedAssetIds = await page
    .locator('[data-testid="explore-media-item"]')
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-media-id")));
  expect(new Set(mixedAssetIds).size).toBe(160);

  const mediaSection = page.locator('section[data-media-feed="mixed"]');
  await mediaSection.evaluate((section) => {
    section.setAttribute("data-instance-marker", "preserve-image-video");
  });
  const imageCatalogRequests = requests.commonsImage;
  const videoCatalogRequests = requests.commonsVideo;
  const imageHistoryRequests = requests.imageHistory;

  await page.getByRole("button", { name: "Portrait", exact: true }).click();
  await expect(page.getByRole("button", { name: "Portrait", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const portraitAssetIds = await page
    .locator('[data-testid="explore-media-item"]')
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-media-id")));
  expect(portraitAssetIds.length).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Video" }).click();
  await expect(page.locator("#creation-prompt")).toBeVisible();
  await expect(page.getByText("Native audio", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explore AI media" })).toBeVisible();
  await expect(page.locator('section[data-catalog-source]')).toHaveAttribute(
    "data-catalog-source",
    "wikimedia-commons",
  );
  await expect(mediaSection).toHaveAttribute(
    "data-instance-marker",
    "preserve-image-video",
  );
  await expect(page.getByRole("button", { name: "Portrait", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await page
      .locator('[data-testid="explore-media-item"]')
      .evaluateAll((items) => items.map((item) => item.getAttribute("data-media-id"))),
  ).toEqual(portraitAssetIds);
  expect(requests.commonsImage).toBe(imageCatalogRequests);
  expect(requests.commonsVideo).toBe(videoCatalogRequests);

  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator('[data-testid="explore-media-item"]')).toHaveCount(160);
  expect(
    await page
      .locator('[data-testid="explore-media-item"]')
      .evaluateAll((items) => items.map((item) => item.getAttribute("data-media-id"))),
  ).toEqual(mixedAssetIds);
  await expect(page.locator('[data-media-kind="image"]')).toHaveCount(130);
  await expect(page.locator('[data-media-kind="video"]')).toHaveCount(30);
  await expect(page.locator('[data-media-kind="image"] img[src]')).toHaveCount(130);

  const firstExploreVideo = page.locator('[data-media-kind="video"]').first();
  await firstExploreVideo.scrollIntoViewIfNeeded();
  const firstVideo = firstExploreVideo.locator("video");
  await expect(firstVideo).toHaveAttribute("autoplay", "");
  await expect(firstVideo).toHaveAttribute("loop", "");
  await expect.poll(async () => firstVideo.getAttribute("src")).toMatch(/upload\.wikimedia\.org/);
  expect(await firstVideo.evaluate((video: HTMLVideoElement) => ({
    muted: video.muted,
    playsInline: video.playsInline,
    preload: video.preload,
  }))).toEqual({
    muted: true,
    playsInline: true,
    preload: "none",
  });
  const firstVideoOverlay = firstExploreVideo.locator('[data-testid="media-hover-overlay"]');
  await page.mouse.move(0, 0);
  await expect(firstVideoOverlay).toHaveCSS("opacity", "0");
  await firstExploreVideo.hover();
  await expect(firstVideoOverlay).toHaveCSS("opacity", "1");

  await expect(page.getByRole("heading", { name: "Recent videos" })).toBeVisible();
  await expect(page.locator('[data-testid="creation-video"]')).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Open in Library" })).toHaveAttribute(
    "href",
    "/librarie",
  );
  await expect(page.locator('[data-testid="creation-image"]')).toHaveCount(0);
  expect(requests.imageHistory).toBe(imageHistoryRequests);
  expect(requests.videoHistory).toBeGreaterThan(0);
  expect(requests.soundtrackHistory).toBe(0);
  await prepareStableScreenshot(page);
  await expect(page).toHaveScreenshot("unified-create-videos.png");

  const videoHistoryRequests = requests.videoHistory;

  await page.getByRole("tab", { name: "Soundtrack" }).click();
  await expect(page.locator("#creation-prompt")).toBeVisible();
  await expect(page.getByText("Voice model")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explore voice ideas" })).toBeVisible();
  await expect(page.locator('section[data-media-feed="mixed"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="explore-media-item"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="example-soundtrack"]')).toHaveCount(4);
  await expect(
    page
      .locator('[data-testid="example-soundtrack"]')
      .first()
      .getByRole("button", { name: "Preview voice" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent soundtracks" })).toBeVisible();
  await expect(page.locator('[data-testid="creation-soundtrack"]')).toHaveCount(4);
  await expect(
    page.getByRole("link", { name: "Open in TTS Library" }).first(),
  ).toHaveAttribute("href", "/tts-library");
  await expect(page.locator('[data-testid="creation-video"]')).toHaveCount(0);
  expect(requests.imageHistory).toBe(imageHistoryRequests);
  expect(requests.videoHistory).toBe(videoHistoryRequests);
  expect(requests.soundtrackHistory).toBeGreaterThan(0);
  await page
    .locator('[data-testid="example-soundtrack"]')
    .first()
    .getByRole("button", { name: "Use this narration" })
    .click();
  await expect(page.locator("#creation-prompt")).toHaveValue(/Nu e doar un produs nou/);
  await prepareStableScreenshot(page);
  await expect(page).toHaveScreenshot("unified-create-soundtracks.png");

  await page.getByRole("tab", { name: "Image" }).click();
  await expect(page.getByRole("heading", { name: "Explore AI media" })).toBeVisible();
  await expect(page.locator('[data-testid="explore-media-item"]')).toHaveCount(160);
  await expect(page.locator('[data-media-kind="image"]')).toHaveCount(130);
  await expect(page.locator('[data-media-kind="video"]')).toHaveCount(30);
  expect(
    await page
      .locator('[data-testid="explore-media-item"]')
      .evaluateAll((items) => items.map((item) => item.getAttribute("data-media-id"))),
  ).toEqual(mixedAssetIds);
  expect(requests.commonsImage).toBe(imageCatalogRequests);
  expect(requests.commonsVideo).toBe(videoCatalogRequests);
  expect(requests.imageHistory).toBe(imageHistoryRequests);
  expect(requests.videoHistory).toBe(videoHistoryRequests);
});
