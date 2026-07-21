"use client";

import { Button } from "@/components/ui/button";
import { EditorHeader } from "@/components/editor-header";
import { ArrowLeft, CheckCircle, Clock, Download, Film, Loader2, Sparkles, Upload } from "lucide-react";
import { useRef, type Dispatch, type SetStateAction } from "react";

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

const PIPELINE_STEPS = [
  { num: 1, label: "Idea" },
  { num: 2, label: "Scripts" },
  { num: 3, label: "Preview" },
  { num: 4, label: "Render" },
] as const;

const STEP_CONTEXT_LABELS: Record<number, string> = {
  1: "Idea Input",
  2: "Review Scripts",
  3: "Preview & Select",
  4: "Render Videos",
};

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

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
    previewCards,
    selectedVariants,
    variantCount,
    templateTransferBusy,
    handleExportPipelineTemplate,
    handleImportPipelineTemplate,
    showHistoryPanel,
    setShowHistoryPanel,
  }: PipelineStepperCtx = ctx;
  const templateInputRef = useRef<HTMLInputElement>(null);

  // Step 2 -> 3 is unlocked by ready voice-overs, not previews: matching can
  // run on demand (handlePreviewAll reuses the audio and auto-advances).
  const ttsMap = ttsResults as Record<number, { generating: boolean; stale: boolean }>;
  const allTtsReady =
    scripts.length > 0 &&
    // Count over live script indices, not map entries: the backend can retain
    // tts_info for deleted variants, leaving orphan keys that would push the
    // count past scripts.length and wrongly lock this step (never "N === M").
    scripts.filter((_: string, i: number) => {
      const result = ttsMap[i];
      return !!result && !result.generating && !result.stale;
    }).length === scripts.length;

  const selectedPreviewCount = Array.isArray(previewCards)
    ? previewCards.filter((card) => selectedVariants?.has(card.baseIndex)).length
    : Object.keys(previews).length;

  const contextCount = (() => {
    if (step === 1) return formatCount(Number(variantCount) || 0, "variant");
    if (step === 2) return formatCount(scripts.length, "script");
    if (step === 3) return formatCount(selectedPreviewCount, "preview");
    return formatCount(variantStatuses.length, "render");
  })();

  const startNewPipeline = () => {
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
  };

  const canOpenStep = (targetStep: number) => {
    if (targetStep <= step) return true;
    if (targetStep === 2 && step === 1) {
      return !!pipelineId && scripts.length > 0;
    }
    if (targetStep === 3 && step === 2) {
      return Object.keys(previews).length > 0 || allTtsReady;
    }
    return targetStep === 4 && step === 3 && variantStatuses.length > 0;
  };

  const openStep = (targetStep: number) => {
    if (!canOpenStep(targetStep) || targetStep === step) return;

    setPreviewError(null);
    if (targetStep === 3 && step === 2 && Object.keys(previews).length === 0) {
      void handlePreviewAll?.();
      return;
    }
    setStep(targetStep);
  };

  return (
    <EditorHeader
      className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85"
      testId="pipeline-toolbar"
      icon={<Film className="size-4 shrink-0 text-primary" />}
      title={<span data-testid="pipeline-toolbar-context">Multi-Variant Pipeline</span>}
      breadcrumb={STEP_CONTEXT_LABELS[step]}
      subtitle={contextCount}
      actions={(
      <div
        className="flex shrink-0 items-center justify-end gap-1"
        data-testid="pipeline-toolbar-actions"
      >
        <input
          ref={templateInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="pipeline-template-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleImportPipelineTemplate(file);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2.5 text-sm"
          disabled={!!templateTransferBusy}
          onClick={() => templateInputRef.current?.click()}
          title="Import a complete pipeline template"
          data-testid="pipeline-template-import"
        >
          {templateTransferBusy === "import"
            ? <Loader2 className="mr-1.5 size-4 animate-spin" />
            : <Upload className="mr-1.5 size-4" />}
          <span className="hidden min-[1450px]:inline">Import Template</span>
          <span className="min-[1450px]:hidden">Import</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2.5 text-sm"
          disabled={!pipelineId || !!templateTransferBusy}
          onClick={() => void handleExportPipelineTemplate()}
          title={pipelineId ? "Export every pipeline setting as JSON" : "Create or load a pipeline before exporting"}
          data-testid="pipeline-template-export"
        >
          {templateTransferBusy === "export"
            ? <Loader2 className="mr-1.5 size-4 animate-spin" />
            : <Download className="mr-1.5 size-4" />}
          <span className="hidden min-[1450px]:inline">Export Template</span>
          <span className="min-[1450px]:hidden">Export</span>
        </Button>
        {step === 3 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-2.5 text-sm"
            aria-pressed={!!showHistoryPanel}
            onClick={() => setShowHistoryPanel?.((prev: boolean) => !prev)}
            title={showHistoryPanel ? "Hide script history" : "Show script history"}
            data-testid="pipeline-history-toggle"
          >
            <Clock className="mr-1.5 size-4" />
            <span className="hidden min-[1450px]:inline">{showHistoryPanel ? "Hide History" : "History"}</span>
          </Button>
        )}
        {step === 3 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-2.5 text-sm"
            onClick={() => openStep(2)}
          >
            <ArrowLeft className="mr-1.5 size-4" />
            Back to Scripts
          </Button>
        )}
        {step > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-2.5 text-sm text-muted-foreground hover:text-foreground"
            onClick={startNewPipeline}
          >
            <Sparkles className="mr-1.5 size-4" />
            New Pipeline
          </Button>
        )}
      </div>
      )}
    >
      <div
        className="absolute left-1/2 hidden w-full max-w-2xl -translate-x-1/2 items-center justify-center min-[1950px]:flex"
        aria-label="Pipeline progress"
        data-testid="pipeline-progress"
      >
        <div className="flex w-full max-w-2xl min-w-0 items-center">
          {PIPELINE_STEPS.map((item, index) => {
            const isComplete = item.num < step;
            const isActive = item.num === step;
            const canOpen = canOpenStep(item.num);

            return (
              <div key={item.num} className="flex min-w-0 flex-1 items-center last:flex-none">
                <button
                  type="button"
                  disabled={!canOpen}
                  aria-current={isActive ? "step" : undefined}
                  onClick={() => openStep(item.num)}
                  className={`group flex h-10 items-center gap-2.5 px-1 text-sm transition-colors disabled:opacity-100 ${
                    isActive
                      ? "font-semibold text-primary"
                      : canOpen
                        ? "text-muted-foreground hover:text-foreground"
                        : "cursor-default text-muted-foreground/45"
                  }`}
                  data-testid={`pipeline-step-${item.num}`}
                >
                  <span
                    className={`flex size-8 items-center justify-center rounded-full border-2 bg-background text-sm font-semibold transition-[border-color,box-shadow,color] ${
                      isActive
                        ? "border-primary text-primary ring-2 ring-primary/15"
                        : isComplete
                          ? "border-primary text-primary group-hover:ring-2 group-hover:ring-primary/10"
                          : canOpen
                            ? "border-primary/65 text-primary group-hover:border-primary group-hover:ring-2 group-hover:ring-primary/10"
                            : "border-border text-muted-foreground/55"
                    }`}
                  >
                    {isComplete ? <CheckCircle className="size-4" /> : item.num}
                  </span>
                  <span>{item.label}</span>
                </button>
                {index < PIPELINE_STEPS.length - 1 && (
                  <div
                    className={`mx-3 h-px min-w-4 flex-1 ${
                      step > item.num ? "bg-primary/45" : "bg-border"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </EditorHeader>
  );
}
