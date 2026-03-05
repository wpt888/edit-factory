/**
 * ImagePickerDialog - Modal dialog for viewing and selecting product gallery images
 * on an existing segment-product association.
 *
 * Features:
 * - Fetches all images for a catalog product via GET /catalog/products/{id}/images
 * - Displays images in a responsive grid with toggle selection (Set<string> for O(1) lookups)
 * - Selected images get a green border and checkmark overlay
 * - Save button calls PATCH /associations/{id} with selected_image_urls
 * - Loading spinner and "No images available" empty state
 */

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiGet, apiPatch, handleApiError } from "@/lib/api";
import { toast } from "sonner";
import { Check, Loader2, Images } from "lucide-react";

// Re-export AssociationResponse so consumers can import from one place
export type { AssociationResponse } from "@/components/product-picker-dialog";
import type { AssociationResponse } from "@/components/product-picker-dialog";

// ============== PROPS ==============

interface ImagePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  associationId: string;
  catalogProductId: string;
  currentSelectedUrls: string[];
  productTitle: string | null;
  onImagesUpdated: (updatedAssociation: AssociationResponse) => void;
}

// ============== COMPONENT ==============

export function ImagePickerDialog({
  open,
  onOpenChange,
  associationId,
  catalogProductId,
  currentSelectedUrls,
  productTitle,
  onImagesUpdated,
}: ImagePickerDialogProps) {
  const [images, setImages] = useState<string[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Bug #128: stabilize currentSelectedUrls to avoid re-fetch on every parent render
  const selectedUrlsKey = JSON.stringify(currentSelectedUrls);

  // ---- Fetch images on open ----
  useEffect(() => {
    if (!open) {
      // Reset on close
      setImages([]);
      setSelectedUrls(new Set());
      return;
    }

    // Initialize selected URLs from prop
    setSelectedUrls(new Set(currentSelectedUrls));

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = await apiGet(`/catalog/products/${catalogProductId}/images`);
        if (cancelled) return;
        const data = await res.json();
        setImages(data.images ?? []);
      } catch {
        if (cancelled) return;
        toast.error("Failed to load product images");
        setImages([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // Bug #128: use stable key instead of array reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, catalogProductId, selectedUrlsKey]);

  // ---- Toggle image selection ----
  const toggleImage = (url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  // ---- Save selection ----
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiPatch(`/associations/${associationId}`, {
        selected_image_urls: Array.from(selectedUrls),
      });
      const updated: AssociationResponse = await res.json();
      toast.success("Image selection saved");
      onImagesUpdated(updated);
      onOpenChange(false);
    } catch (err) {
      handleApiError(err, "Failed to save image selection");
    } finally {
      setSaving(false);
    }
  };

  const dialogTitle = productTitle
    ? `Select Images — ${productTitle}`
    : "Select Images";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Images className="h-5 w-5 shrink-0" />
            <span className="truncate">{dialogTitle}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Image grid */}
        <ScrollArea className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : images.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                <Images className="h-6 w-6" />
              </div>
              <p className="text-lg font-medium text-muted-foreground">
                No images available
              </p>
              <p className="text-sm text-muted-foreground text-center max-w-xs">
                This product has no gallery images in the catalog.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 p-1 pr-3">
              {images.map((url) => {
                const isSelected = selectedUrls.has(url);
                return (
                  <div
                    key={url}
                    className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                      isSelected
                        ? "border-green-500 ring-1 ring-green-500"
                        : "border-transparent hover:border-muted-foreground/40"
                    }`}
                    onClick={() => toggleImage(url)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt="Product image"
                      className="w-full aspect-square object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          "/placeholder-product.svg";
                      }}
                    />
                    {/* Checkmark overlay when selected */}
                    {isSelected && (
                      <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-green-500 flex items-center justify-center shadow-sm">
                        <Check className="h-3 w-3 text-white" strokeWidth={3} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <DialogFooter className="pt-2 border-t">
          <div className="flex items-center gap-2 w-full justify-between">
            <span className="text-sm text-muted-foreground">
              {selectedUrls.size} of {images.length} selected
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving || loading}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Selection"
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
