/**
 * CreateFeedDialog - Modal dialog for adding a new Google Shopping XML feed
 *
 * Features:
 * - Feed name and URL input fields
 * - Validation: name min 2 chars, URL must start with "http"
 * - API integration via POST /api/v1/feeds
 * - Toast notifications on success/failure
 * - Form reset on close
 * - onCreated callback with full feed object for auto-select
 */

"use client";

import React, { useState, useEffect } from "react";
import { apiPost, handleApiError } from "@/lib/api";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Feed {
  id: string;
  name: string;
  feed_url: string;
  sync_status: string;
  product_count: number;
  last_synced_at: string | null;
  sync_error: string | null;
}

interface CreateFeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (feed: Feed) => void; // Called with the full feed object from API response
}

export function CreateFeedDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateFeedDialogProps) {
  const [name, setName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [loading, setLoading] = useState(false);

  // Reset form state when dialog closes
  useEffect(() => {
    if (!open) {
      setName("");
      setFeedUrl("");
      setLoading(false);
    }
  }, [open]);

  const abortControllerRef = React.useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!open) {
      abortControllerRef.current?.abort();
    }
  }, [open]);

  const handleCreate = async () => {
    const trimmedName = name.trim();
    const trimmedFeedUrl = feedUrl.trim();

    if (trimmedName.length < 2) {
      toast.error("Feed name must be at least 2 characters");
      return;
    }

    if (!trimmedFeedUrl.startsWith("http")) {
      toast.error("Feed URL must start with http or https");
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);

    try {
      const response = await apiPost("/feeds", {
        name: trimmedName,
        feed_url: trimmedFeedUrl,
      });

      if (controller.signal.aborted) return;
      const data = await response.json();
      toast.success("Feed created successfully");
      onCreated(data);
      onOpenChange(false);
      setName("");
      setFeedUrl("");
    } catch (error) {
      if (controller.signal.aborted) return;
      handleApiError(error, "Error creating feed");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Feed</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="feed-name">
              Feed Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="feed-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Store Feed"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feed-url">
              Feed URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="feed-url"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
              disabled={loading}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
