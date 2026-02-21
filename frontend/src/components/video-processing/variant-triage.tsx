"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Play,
  Download,
  Check,
  Volume2,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Variant } from "@/types/video-processing";

interface VariantTriageProps {
  /** List of generated variants */
  variants: Variant[];
  /** Called when selection changes */
  onSelectionChange: (variants: Variant[]) => void;
  /** Called when preview button is clicked */
  onPreview: (variant: Variant) => void;
  /** Called when download button is clicked */
  onDownload: (variant: Variant) => void;
  /** Show TTS button for adding voice-over */
  showTtsButton?: boolean;
  /** Called when add TTS button is clicked */
  onAddTts?: () => void;
  /** TTS is currently being added */
  isAddingTts?: boolean;
  /** TTS progress text */
  ttsStatus?: string;
  /** API base URL for video streaming */
  apiBaseUrl?: string;
  /** Custom class name */
  className?: string;
  /** Grid columns (2, 3, or 4) */
  columns?: 2 | 3 | 4;
}

export function VariantTriage({
  variants,
  onSelectionChange,
  onPreview,
  onDownload,
  showTtsButton = false,
  onAddTts,
  isAddingTts = false,
  ttsStatus = "",
  apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1",
  className = "",
  columns = 3,
}: VariantTriageProps) {
  // Count selected variants
  const selectedCount = useMemo(
    () => variants.filter((v) => v.selected).length,
    [variants]
  );

  // Toggle variant selection
  const toggleSelection = (variantIndex: number) => {
    const updated = variants.map((v) =>
      v.variant_index === variantIndex ? { ...v, selected: !v.selected } : v
    );
    onSelectionChange(updated);
  };

  // Select all variants
  const selectAll = () => {
    const updated = variants.map((v) => ({ ...v, selected: true }));
    onSelectionChange(updated);
  };

  // Deselect all variants
  const deselectAll = () => {
    const updated = variants.map((v) => ({ ...v, selected: false }));
    onSelectionChange(updated);
  };

  const gridColsClass = {
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
  }[columns];

  if (variants.length === 0) {
    return (
      <div className={`text-center py-8 text-muted-foreground ${className}`}>
        <p>Nu exista variante generate</p>
        <p className="text-sm mt-1">Proceseaza un video pentru a genera variante</p>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header with selection controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Variante Generate</h3>
          <Badge variant="secondary">{variants.length} variante</Badge>
          {selectedCount > 0 && (
            <Badge variant="default">{selectedCount} selectate</Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={selectAll}>
            Selecteaza toate
          </Button>
          <Button variant="ghost" size="sm" onClick={deselectAll}>
            Deselecteaza
          </Button>
        </div>
      </div>

      {/* Variants grid */}
      <div className={`grid ${gridColsClass} gap-4`}>
        {variants.map((variant) => (
          <Card
            key={variant.variant_index}
            className={`cursor-pointer transition-all hover:shadow-md ${
              variant.selected
                ? "ring-2 ring-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
            onClick={() => toggleSelection(variant.variant_index)}
          >
            <CardContent className="p-4 space-y-3">
              {/* Thumbnail/preview area */}
              <div className="aspect-[9/16] bg-muted rounded-lg relative overflow-hidden group">
                {variant.thumbnail ? (
                  <img
                    src={`${apiBaseUrl}/files/${encodeURIComponent(variant.thumbnail)}`}
                    alt={`Varianta ${variant.variant_index}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900">
                    <Play className="h-12 w-12 text-white/50" />
                  </div>
                )}

                {/* Selection indicator */}
                {variant.selected && (
                  <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                    <Check className="h-4 w-4" />
                  </div>
                )}

                {/* Hover overlay with actions */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreview(variant);
                    }}
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(variant);
                    }}
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </Button>
                </div>
              </div>

              {/* Variant info */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Badge variant="outline">Varianta {variant.variant_index}</Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {variant.variant_name}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* TTS Button */}
      {showTtsButton && onAddTts && (
        <div className="pt-4 border-t">
          <Button
            onClick={onAddTts}
            disabled={selectedCount === 0 || isAddingTts}
            className="w-full"
          >
            {isAddingTts ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {ttsStatus || "Se adauga voice-over..."}
              </>
            ) : (
              <>
                <Volume2 className="h-4 w-4 mr-2" />
                Adauga Voice-over ({selectedCount} variante)
              </>
            )}
          </Button>
          {selectedCount === 0 && !isAddingTts && (
            <p className="text-xs text-center text-muted-foreground mt-2">
              Selecteaza cel putin o varianta pentru a adauga TTS
            </p>
          )}
        </div>
      )}
    </div>
  );
}
