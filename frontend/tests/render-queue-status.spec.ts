import { expect, test } from "@playwright/test";

test("queued render shows position and ETA before transitioning to active progress", async ({ page }) => {
  const pipelineId = "queue-ui-demo";
  const profile = {
    id: "queue-ui-profile",
    name: "Queue UI",
    is_default: true,
    created_at: "2026-07-15T00:00:00Z",
  };
  let renderPhase: "queued" | "processing" = "queued";

  await page.addInitScript(({ initialProfile, restoredPipelineId }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([initialProfile]));
    localStorage.setItem("editai_current_profile_id", initialProfile.id);
    localStorage.setItem(
      `blipost.workspace.${initialProfile.id}.pipeline.session`,
      JSON.stringify({ pipelineId: restoredPipelineId, step: 4 }),
    );
  }, { initialProfile: profile, restoredPipelineId: pipelineId });

  await page.route("**/api/v1/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;

    if (path.endsWith(`/pipeline/status/${pipelineId}`)) {
      const variant = renderPhase === "queued"
        ? {
            variant_index: 0,
            status: "queued",
            progress: 0,
            current_step: "Queued for render",
            queue_position: 3,
            eta_seconds: 300,
          }
        : {
            variant_index: 0,
            status: "processing",
            progress: 37,
            current_step: "Encoding final video",
          };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          pipeline_id: pipelineId,
          provider: "gemini",
          variant_count: 1,
          variants: [variant],
          meta_variants: null,
          meta_multiplication: false,
          preview_info: {},
          tts_info: {},
          library_project_id: null,
        }),
      });
      return;
    }

    if (path.endsWith(`/pipeline/scripts/${pipelineId}`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          pipeline_id: pipelineId,
          scripts: ["A deterministic queue UI test script."],
          script_names: ["Queue demo"],
          context_products: [],
          preview_info: {},
          tts_info: {},
          captions: {},
          selected_captions: {},
          name: "Queue UI demo",
          idea: "Show fair rendering feedback",
          provider: "gemini",
          variant_count: 1,
          meta_multiplication: false,
          generation_job: {},
          tts_jobs: {},
        }),
      });
      return;
    }

    if (path.endsWith(`/pipeline/${pipelineId}/source-selection`)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{\"source_video_ids\":[]}" });
      return;
    }
    if (path.endsWith(`/pipeline/${pipelineId}/subtitle-overrides`)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{\"overrides\":{}}" });
      return;
    }
    if (path.endsWith(`/pipeline/${pipelineId}/restore-previews`)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{\"previews\":{}}" });
      return;
    }
    if (path.endsWith("/profiles/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([profile]) });
      return;
    }
    if (path.endsWith("/segments/source-videos")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (path.endsWith("/tts-library/") || path.endsWith("/postiz/integrations") || path.endsWith("/buffer/channels")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (path.endsWith("/schedule/calendar")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{\"postiz_posts\":[],\"schedule_items\":[],\"days\":{}}",
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/pipeline?step=4&id=${pipelineId}`);

  const queuedState = page.getByTestId("render-queue-status-0");
  await expect(queuedState).toContainText("Queued — position 3");
  await expect(queuedState).toContainText("ETA ~5 min");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();

  renderPhase = "processing";
  const activeState = page.getByTestId("render-active-status-0");
  await expect(activeState).toContainText("Rendering", { timeout: 10_000 });
  await expect(activeState).toContainText("37%");
  await expect(page.getByText("Encoding final video")).toBeVisible();
});
