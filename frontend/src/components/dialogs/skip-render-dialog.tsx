"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, RefreshCw, SkipForward } from "lucide-react";

export interface RenderCheckResult {
  variant_index: number;
  can_skip: boolean;
  reason: string;
  existing_video_path?: string | null;
  output_key?: string | null;
  visual_version?: string | null;
}

interface SkipRenderDialogProps {
  open: boolean;
  onClose: () => void;
  checkResults: RenderCheckResult[];
  onConfirm: (skipOutputKeys: string[], renderOutputKeys: string[]) => void;
}

export function SkipRenderDialog({
  open,
  onClose,
  checkResults,
  onConfirm,
}: SkipRenderDialogProps) {
  const skippable = checkResults.filter((r) => r.can_skip);
  const resultKey = (result: RenderCheckResult) => (
    result.output_key
    || `${result.variant_index}${result.visual_version ? `_${result.visual_version}` : ""}`
  );

  // Track exact output keys, so A and B never collapse to the same script index.
  const [skipSet, setSkipSet] = useState<Set<string>>(
    () => new Set(skippable.map(resultKey))
  );
  useEffect(() => {
    if (open) setSkipSet(new Set(skippable.map(resultKey)));
    // `checkResults` is the server snapshot for this dialog opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkResults, open]);

  const toggleSkip = (outputKey: string) => {
    setSkipSet((prev) => {
      const next = new Set(prev);
      if (next.has(outputKey)) {
        next.delete(outputKey);
      } else {
        next.add(outputKey);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const skipOutputKeys = Array.from(skipSet);
    const renderOutputKeys = checkResults
      .map(resultKey)
      .filter((outputKey) => !skipSet.has(outputKey));
    onConfirm(skipOutputKeys, renderOutputKeys);
  };

  const handleRenderAll = () => {
    onConfirm(
      [],
      checkResults.map(resultKey)
    );
  };

  const reasonLabel = (reason: string) => {
    switch (reason) {
      case "fingerprint_match":
        return "Identical parameters";
      case "no_previous_render":
        return "No previous render";
      case "file_missing":
        return "File deleted";
      case "fingerprint_mismatch":
        return "Parameters changed";
      case "render_exists_unverified":
        return "Existing render (unverified)";
      case "still_processing":
        return "Rendering in progress";
      default:
        return reason;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SkipForward className="size-5" />
            Existing videos detected
          </DialogTitle>
          <DialogDescription>
            {skippable.length} of {checkResults.length} variants already have a
            render with the same parameters. You can continue with the existing
            videos or render everything again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {checkResults.map((result) => (
            <div
              key={resultKey(result)}
              className="flex items-center justify-between p-3 rounded-lg border bg-card"
            >
              <div className="flex items-center gap-3">
                {result.can_skip ? (
                  <Checkbox
                    checked={skipSet.has(resultKey(result))}
                    onCheckedChange={() => toggleSkip(resultKey(result))}
                    aria-label={`Use existing render for output ${result.variant_index + 1}${result.visual_version ? ` ${result.visual_version}` : ""}`}
                  />
                ) : (
                  <RefreshCw className="size-4 text-muted-foreground" />
                )}
                <span className="font-medium">
                  Output {result.variant_index + 1}{result.visual_version ? ` ${result.visual_version}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {result.can_skip && result.reason === "fingerprint_match" ? (
                  <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                    <CheckCircle className="size-3 mr-1" />
                    Identical
                  </Badge>
                ) : result.can_skip && result.reason === "render_exists_unverified" ? (
                  <Badge variant="default" className="bg-yellow-600 hover:bg-yellow-700">
                    <CheckCircle className="size-3 mr-1" />
                    Existing
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    {reasonLabel(result.reason)}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={handleRenderAll}>
            <RefreshCw className="size-4 mr-2" />
            Render all again
          </Button>
          <Button onClick={handleConfirm}>
            <SkipForward className="size-4 mr-2" />
            Continue with existing ({skipSet.size} skipped)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
