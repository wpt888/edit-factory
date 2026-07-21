import { expect, test, type Page } from "@playwright/test";

const PIPELINE_ID = "captions-smart-schedule";
const PROFILE = {
  id: "captions-profile",
  name: "Captions Profile",
  is_default: true,
  created_at: "2026-07-22T00:00:00Z",
};
const GENERATED_CAPTIONS = {
  "clip-v0": "Generated caption for variant one",
  "clip-v1": "Generated caption for variant two",
};

async function mockPipeline(page: Page, onPlan: (payload: Record<string, unknown>) => void) {
  await page.addInitScript(({ profile, pipelineId }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem(
      `blipost.workspace.${profile.id}.pipeline.session`,
      JSON.stringify({ pipelineId, step: 4 }),
    );
  }, { profile: PROFILE, pipelineId: PIPELINE_ID });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path.endsWith(`/pipeline/status/${PIPELINE_ID}`)) {
      await route.fulfill({
        json: {
          pipeline_id: PIPELINE_ID,
          variants: [
            {
              variant_index: 0,
              status: "completed",
              progress: 100,
              clip_id: "clip-v0",
              final_video_path: "clip-v0.mp4",
              library_saved: true,
            },
            {
              variant_index: 1,
              status: "completed",
              progress: 100,
              clip_id: "clip-v1",
              final_video_path: "clip-v1.mp4",
              library_saved: true,
            },
          ],
          meta_variants: null,
          meta_multiplication: false,
          library_project_id: "project-1",
        },
      });
      return;
    }

    if (path.endsWith(`/pipeline/scripts/${PIPELINE_ID}`)) {
      await route.fulfill({
        json: {
          pipeline_id: PIPELINE_ID,
          scripts: ["Variant one script.", "Variant two script."],
          script_names: ["Variant one", "Variant two"],
          context_products: [],
          captions: {},
          selected_captions: {},
          preview_info: {},
          tts_info: {},
          generation_job: {},
          tts_jobs: {},
          name: "Caption schedule test",
          provider: "gemini",
          variant_count: 2,
          meta_multiplication: false,
          library_project_id: "project-1",
        },
      });
      return;
    }

    if (path.endsWith("/pipeline/generate-video-captions")) {
      await route.fulfill({
        json: {
          captions: {
            "0": [GENERATED_CAPTIONS["clip-v0"]],
            "1": [GENERATED_CAPTIONS["clip-v1"]],
          },
          errors: {},
        },
      });
      return;
    }

    if (path.endsWith("/pipeline/selected-captions")) {
      await route.fulfill({ status: 500, json: { detail: "Caption persistence unavailable" } });
      return;
    }

    if (path.endsWith("/pipeline/video-caption-templates")) {
      await route.fulfill({ json: { templates: [] } });
      return;
    }

    if (path.endsWith("/postiz/integrations")) {
      await route.fulfill({ json: [{ id: "tiktok-1", name: "TikTok", type: "tiktok" }] });
      return;
    }

    if (path.endsWith("/schedule/preview")) {
      await route.fulfill({
        json: {
          assignments: [
            {
              scheduled_date: "2026-07-23",
              scheduled_at: "2026-07-23T09:00:00Z",
              clip_id: "clip-v0",
              clip_name: "Variant one",
              project_name: "Caption schedule test",
              integration_id: "tiktok-1",
              platform_type: "tiktok",
              variant_index: 0,
            },
            {
              scheduled_date: "2026-07-24",
              scheduled_at: "2026-07-24T09:00:00Z",
              clip_id: "clip-v1",
              clip_name: "Variant two",
              project_name: "Caption schedule test",
              integration_id: "tiktok-1",
              platform_type: "tiktok",
              variant_index: 1,
            },
          ],
          total_clips: 2,
          days_used: 2,
          collections_count: 1,
          excluded_collections: [],
          variant_routing: { "tiktok-1": 0 },
        },
      });
      return;
    }

    if (path.endsWith("/schedule/plans")) {
      onPlan(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        json: {
          plan_id: "plan-1",
          job_id: "job-1",
          status: "processing",
          message: "Schedule confirmed",
        },
      });
      return;
    }

    if (path.endsWith(`/pipeline/${PIPELINE_ID}/source-selection`)) {
      await route.fulfill({ json: { source_video_ids: [] } });
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/subtitle-overrides`)) {
      await route.fulfill({ json: { overrides: {} } });
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/restore-previews`)) {
      await route.fulfill({ json: { previews: {} } });
      return;
    }
    if (path.endsWith("/profiles") || path.endsWith("/profiles/")) {
      await route.fulfill({ json: [PROFILE] });
      return;
    }
    if (path.endsWith("/segments/source-videos")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (path.endsWith("/buffer/channels")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (path.endsWith("/schedule/calendar")) {
      await route.fulfill({ json: { postiz_posts: [], schedule_items: [], days: {} } });
      return;
    }

    await route.fulfill({ json: {} });
  });
}

test("generated captions reach Smart Schedule and save failures stay visible", async ({ page }) => {
  let planPayload: Record<string, unknown> | null = null;
  await mockPipeline(page, payload => { planPayload = payload; });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`/pipeline?step=4&id=${PIPELINE_ID}`);

  const previewButton = page.getByRole("button", { name: "Preview Schedule" });
  await expect(previewButton).toBeEnabled();
  await previewButton.click();

  await expect(page.getByRole("alert").filter({ hasText: "Add a caption for variants 1" })).toContainText(
    "Add a caption for variants 1, 2 before confirming this schedule.",
  );
  await expect(page.getByRole("button", { name: "Confirm & Schedule" })).toBeDisabled();
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  await page.getByRole("button", { name: "Generate Captions for 2 Clips" }).click();
  await expect(page.getByText("Captions generated!", { exact: true })).toBeVisible();
  await expect(page.getByText(/Failed to save captions: Caption persistence unavailable/)).toBeVisible({ timeout: 5_000 });

  await previewButton.click();
  await expect(page.getByRole("button", { name: "Confirm & Schedule" })).toBeEnabled();
  await page.screenshot({ path: "screenshots/captions-smart-schedule.png", fullPage: true });
  await page.getByRole("button", { name: "Confirm & Schedule" }).click();

  await expect.poll(() => planPayload).not.toBeNull();
  expect(planPayload).toMatchObject({
    captions: GENERATED_CAPTIONS,
    clip_ids: ["clip-v0", "clip-v1"],
  });
  expect(planPayload).not.toHaveProperty("caption_template");
});
