"use client";

import { Button } from "@/components/ui/button";
import { CheckCircle, Sparkles } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

// Mirrors the inline confirmDialog state shape in PipelinePage (page.tsx).
type ConfirmDialogState = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant: "destructive" | "default";
  onConfirm: () => void;
  loading?: boolean;
};

// Loose ctx-bag type: only fields needing contextual typing for inline
// callbacks are typed precisely; everything else stays `any`.
type PipelineStepperCtx = {
  step: number;
  setConfirmDialog: Dispatch<SetStateAction<ConfirmDialogState>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function PipelineStepper({ ctx }: { ctx: any }) {
  const {
    step,
    pipelineId,
    scripts,
    previews,
    ttsResults,
    handlePreviewAll,
    variantStatuses,
    setStep,
    setPreviewError,
    isRendering,
    setConfirmDialog,
    handleCancelRender,
    resetPipeline,
  }: PipelineStepperCtx = ctx;
  // Step 2 -> 3 is unlocked by ready voice-overs, not previews: matching can
  // run on demand (handlePreviewAll reuses the audio and auto-advances).
  const ttsMap = ttsResults as Record<number, { generating: boolean; stale: boolean }>;
  const allTtsReady =
    scripts.length > 0 &&
    // Count over live script indices, not map entries: the backend can retain
    // tts_info for deleted variants, leaving orphan keys that would push the
    // count past scripts.length and wrongly lock this step (never "N === M").
    scripts.filter((_: string, i: number) => { const r = ttsMap[i]; return !!r && !r.generating && !r.stale; }).length === scripts.length;
  return (
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {[
              { num: 1, label: "Idea Input" },
              { num: 2, label: "Review Scripts" },
              { num: 3, label: "Preview Matches" },
              { num: 4, label: "Render Videos" },
            ].map((s, index) => {
              /*
                Allow re-entering previously populated steps even when the current step is earlier.
                This fixes the 1 -> 2 dead-end after returning from Step 2 back to Step 1.
              */
              const canJumpToStep2 = s.num === 2 && step === 1 && !!pipelineId && scripts.length > 0;
              const canJumpToStep3 = s.num === 3 && step === 2 && (Object.keys(previews).length > 0 || allTtsReady);
              const canJumpToStep4 = s.num === 4 && step === 3 && variantStatuses.length > 0;
              const isClickableForward = canJumpToStep2 || canJumpToStep3 || canJumpToStep4;

              return (
                <div key={s.num} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                        step === s.num
                          ? "bg-primary text-primary-foreground"
                          : step > s.num
                          ? "bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90 transition-colors"
                          : isClickableForward
                          ? "bg-primary text-primary-foreground cursor-pointer hover:bg-primary/80 transition-colors"
                          : "bg-secondary text-muted-foreground"
                      }`}
                      onClick={() => {
                        // BUG-FE-31: Step navigation rules:
                        // 1. Backward navigation: always allowed (click any completed step)
                        if (step > s.num) {
                          setStep(s.num);
                          setPreviewError(null);
                        }
                        // 2. Forward to Step 2: allowed from Step 1 when scripts already exist
                        if (canJumpToStep2) {
                          setStep(2);
                          setPreviewError(null);
                        }
                        // 3. Forward to Step 3: from Step 2 when previews exist, or when
                        // voice-overs are ready (matching runs on demand and auto-advances)
                        if (canJumpToStep3) {
                          setPreviewError(null);
                          if (Object.keys(previews).length > 0) {
                            setStep(3);
                          } else {
                            void handlePreviewAll?.();
                          }
                        }
                        // 4. Forward to Step 4: only from Step 3 when rendering has been initiated
                        if (canJumpToStep4) {
                          setStep(4);
                          setPreviewError(null);
                        }
                      }}
                    >
                      {step > s.num ? <CheckCircle className="h-5 w-5" /> : s.num}
                    </div>
                    <p
                      className={`text-xs mt-2 ${
                        step === s.num ? "font-semibold" : "text-muted-foreground"
                      }`}
                    >
                      {s.label}
                    </p>
                  </div>
                  {index < 3 && (
                    <div
                      className={`flex-1 h-1 mx-2 ${
                        step > s.num ? "bg-primary" : "bg-secondary"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {/* New Pipeline button — visible on steps 2-4 */}
          {step > 1 && (
            <div className="flex justify-end mt-3">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (isRendering) {
                    setConfirmDialog({
                      open: true,
                      title: "Render in progress",
                      description: "A render is in progress. Are you sure you want to start a new pipeline?",
                      confirmLabel: "Start new pipeline",
                      variant: "destructive",
                      onConfirm: () => {
                        setConfirmDialog((prev) => ({ ...prev, open: false }));
                        handleCancelRender();
                        resetPipeline();
                      },
                    });
                  } else {
                    resetPipeline();
                  }
                }}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Start New Pipeline
              </Button>
            </div>
          )}
        </div>
  );
}
