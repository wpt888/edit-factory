"use client";

import { useState } from "react";
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
}

interface SkipRenderDialogProps {
  open: boolean;
  onClose: () => void;
  checkResults: RenderCheckResult[];
  onConfirm: (skipVariants: number[], renderVariants: number[]) => void;
}

export function SkipRenderDialog({
  open,
  onClose,
  checkResults,
  onConfirm,
}: SkipRenderDialogProps) {
  const skippable = checkResults.filter((r) => r.can_skip);
  const nonSkippable = checkResults.filter((r) => !r.can_skip);

  // Track which skippable variants user wants to actually skip (default: all)
  const [skipSet, setSkipSet] = useState<Set<number>>(
    () => new Set(skippable.map((r) => r.variant_index))
  );

  const toggleSkip = (variantIndex: number) => {
    setSkipSet((prev) => {
      const next = new Set(prev);
      if (next.has(variantIndex)) {
        next.delete(variantIndex);
      } else {
        next.add(variantIndex);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const skipVariants = Array.from(skipSet);
    const renderVariants = checkResults
      .map((r) => r.variant_index)
      .filter((idx) => !skipSet.has(idx));
    onConfirm(skipVariants, renderVariants);
  };

  const handleRenderAll = () => {
    onConfirm(
      [],
      checkResults.map((r) => r.variant_index)
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
            <SkipForward className="h-5 w-5" />
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
              key={result.variant_index}
              className="flex items-center justify-between p-3 rounded-lg border bg-card"
            >
              <div className="flex items-center gap-3">
                {result.can_skip ? (
                  <Checkbox
                    checked={skipSet.has(result.variant_index)}
                    onCheckedChange={() => toggleSkip(result.variant_index)}
                  />
                ) : (
                  <RefreshCw className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium">
                  Variant {result.variant_index + 1}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {result.can_skip && result.reason === "fingerprint_match" ? (
                  <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Identical
                  </Badge>
                ) : result.can_skip && result.reason === "render_exists_unverified" ? (
                  <Badge variant="default" className="bg-yellow-600 hover:bg-yellow-700">
                    <CheckCircle className="h-3 w-3 mr-1" />
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
            <RefreshCw className="h-4 w-4 mr-2" />
            Render all again
          </Button>
          <Button onClick={handleConfirm}>
            <SkipForward className="h-4 w-4 mr-2" />
            Continue with existing ({skipSet.size} skipped)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
