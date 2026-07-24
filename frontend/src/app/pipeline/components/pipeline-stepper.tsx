"use client";

import { Button } from "@/components/ui/button";
import { EditorHeader } from "@/components/editor-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowLeft, CheckCircle, Clock, Download, Film, Loader2, Plus, Upload } from "lucide-react";
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
    step3Mode,
    setStep3Mode,
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
    selectedOutputIds,
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

  const selectedPreviewCount = selectedOutputIds instanceof Set
    ? selectedOutputIds.size
    : Array.isArray(previewCards)
      ? previewCards.length
      : Object.keys(previews).length;

  const contextCount = (() => {
    if (step === 1) return formatCount(Number(variantCount) || 0, "variant");
    if (step === 2) return formatCount(scripts.length, "script");
    if (step === 3) return formatCount(selectedPreviewCount, "output");
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
    if (targetStep === 3 && step < 3) {
      setStep3Mode("edit");
    }
    setStep(targetStep);
  };

  const canOpenExport = step === 3 && selectedPreviewCount > 0;
  const openWorkspaceMode = (mode: string) => {
    if (mode === step3Mode) return;
    if (mode === "edit" || canOpenExport) {
      setPreviewError(null);
      setStep3Mode(mode);
    }
  };

  return (
    <EditorHeader
      compact
      className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85"
      testId="pipeline-toolbar"
      icon={<Film className="size-4 shrink-0 text-primary" />}
      title={<span data-testid="pipeline-toolbar-context">Multi-Variant Pipeline</span>}
      breadcrumb={STEP_CONTEXT_LABELS[step]}
      subtitle={contextCount}
      navigation={step === 3 ? (
        <Tabs
          value={step3Mode}
          onValueChange={openWorkspaceMode}
          className="gap-0"
          data-testid="pipeline-workspace-tabs"
        >
          <TabsList variant="line" className="h-8 gap-2 p-0">
            <TabsTrigger
              value="edit"
              className="h-8 min-w-16 px-2 after:top-[-5px] after:bottom-auto"
              data-testid="pipeline-mode-edit"
            >
              Edit
            </TabsTrigger>
            <TabsTrigger
              value="export"
              disabled={!canOpenExport}
              className="h-8 min-w-16 px-2 after:top-[-5px] after:bottom-auto"
              data-testid="pipeline-mode-export"
            >
              Export
            </TabsTrigger>
          </TabsList>
        </Tabs>
      ) : undefined}
      actions={(
      <div
        className="flex shrink-0 items-center justify-end gap-1 [&_button]:size-8"
        data-testid="pipeline-toolbar-actions"
      >
        <TooltipProvider>
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
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex" tabIndex={templateTransferBusy ? 0 : -1}>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!!templateTransferBusy}
                  onClick={() => templateInputRef.current?.click()}
                  aria-label="Import Pipeline Preset"
                  data-testid="pipeline-template-import"
                >
                  {templateTransferBusy === "import"
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Upload className="size-4" />}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Import Pipeline Preset</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex"
                tabIndex={!pipelineId || templateTransferBusy ? 0 : -1}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!pipelineId || !!templateTransferBusy}
                  onClick={() => void handleExportPipelineTemplate()}
                  aria-label="Export Pipeline Preset"
                  data-testid="pipeline-template-export"
                >
                  {templateTransferBusy === "export"
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Download className="size-4" />}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {pipelineId
                ? "Export Pipeline Preset"
                : "Create or load a pipeline before exporting"}
            </TooltipContent>
          </Tooltip>
          {step >= 1 && step <= 4 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={showHistoryPanel ? "Hide Script History" : "Show Script History"}
                  aria-pressed={!!showHistoryPanel}
                  onClick={() => setShowHistoryPanel?.((prev: boolean) => !prev)}
                  data-testid="pipeline-history-toggle"
                >
                  <Clock className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {showHistoryPanel ? "Hide Script History" : "Show Script History"}
              </TooltipContent>
            </Tooltip>
          )}
          {step === 3 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Back to Scripts"
                  onClick={() => openStep(2)}
                >
                  <ArrowLeft className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Back to Scripts</TooltipContent>
            </Tooltip>
          )}
          {step > 1 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="New Pipeline"
                  onClick={startNewPipeline}
                >
                  <Plus className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New Pipeline</TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>
      </div>
      )}
    >
      <div
        className="absolute left-1/2 hidden w-full max-w-md -translate-x-1/2 items-center justify-center min-[1800px]:flex"
        aria-label="Pipeline progress"
        data-testid="pipeline-progress"
      >
        <div className="flex w-full max-w-xl min-w-0 items-center">
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
                  className={`group flex h-8 items-center gap-1.5 px-1 text-xs transition-colors disabled:opacity-100 ${
                    isActive
                      ? "font-semibold text-primary"
                      : canOpen
                        ? "text-muted-foreground hover:text-foreground"
                        : "cursor-default text-muted-foreground/45"
                  }`}
                  data-testid={`pipeline-step-${item.num}`}
                >
                  <span
                    className={`flex size-6 items-center justify-center rounded-full border bg-background text-[11px] font-semibold transition-[border-color,box-shadow,color] ${
                      isActive
                        ? "border-primary text-primary ring-2 ring-primary/15"
                        : isComplete
                          ? "border-primary text-primary group-hover:ring-2 group-hover:ring-primary/10"
                          : canOpen
                            ? "border-primary/65 text-primary group-hover:border-primary group-hover:ring-2 group-hover:ring-primary/10"
                            : "border-border text-muted-foreground/55"
                    }`}
                  >
                    {isComplete ? <CheckCircle className="size-3.5" /> : item.num}
                  </span>
                  <span>{item.label}</span>
                </button>
                {index < PIPELINE_STEPS.length - 1 && (
                  <div
                    className={`mx-1.5 h-px min-w-3 flex-1 ${
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
