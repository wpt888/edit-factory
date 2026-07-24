"use client";

import { Loader2, Play } from "lucide-react";

import { SkipRenderDialog } from "@/components/dialogs/skip-render-dialog";
import { RenderSettingsPanel } from "@/components/render-settings-panel";
import { Button } from "@/components/ui/button";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Step3Export({ ctx }: { ctx: any }) {
  const {
    selectedOutputIds,
    renderSettings,
    setRenderSettings,
    presetName,
    setPresetName,
    renderAdjust,
    setRenderAdjust,
    handleRenderClick,
    voiceRegenerationActive,
    isCheckingRender,
    skipCheckResults,
    setSkipCheckResults,
    showSkipDialog,
    setShowSkipDialog,
    handleRender,
  } = ctx;

  return (
    <div className="h-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <div>
          <h2 className="text-2xl font-semibold">Export</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the final output, then render the selected previews.
          </p>
        </div>

        <section className="space-y-4" data-testid="export-setup">
          <RenderSettingsPanel
            settings={renderSettings}
            onChange={setRenderSettings}
            presetName={presetName}
            onPresetNameChange={setPresetName}
            adjustments={renderAdjust}
            onAdjustmentsChange={setRenderAdjust}
          />
          <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">
                {selectedOutputIds.size} {selectedOutputIds.size === 1 ? "output" : "outputs"} selected
              </p>
              <p className="text-[11px] text-muted-foreground">
                Encoding, color, and final audio apply to this render batch.
              </p>
            </div>
            <Button
              variant="cta"
              onClick={handleRenderClick}
              disabled={voiceRegenerationActive || isCheckingRender || selectedOutputIds.size === 0}
              size="lg"
              data-testid="export-render-button"
            >
              {isCheckingRender || voiceRegenerationActive ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Play className="mr-2 size-4" />
              )}
              {voiceRegenerationActive
                ? "Voice-over updating..."
                : isCheckingRender
                ? "Checking..."
                : `Render Selected (${selectedOutputIds.size})`}
            </Button>
          </div>
        </section>

        {skipCheckResults && (
          <SkipRenderDialog
            open={showSkipDialog}
            onClose={() => {
              setShowSkipDialog(false);
              setSkipCheckResults(null);
            }}
            checkResults={skipCheckResults}
            onConfirm={(skipVars) => handleRender(skipVars)}
          />
        )}
      </div>
    </div>
  );
}
