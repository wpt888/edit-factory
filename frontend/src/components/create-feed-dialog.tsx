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

import { useState } from "react";
import { apiPost } from "@/lib/api";
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

interface CreateFeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (feed: any) => void; // Called with the full feed object from API response
}

export function CreateFeedDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateFeedDialogProps) {
  const [name, setName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    const trimmedName = name.trim();
    const trimmedFeedUrl = feedUrl.trim();

    // Validation
    if (trimmedName.length < 2) {
      toast.error("Feed name must be at least 2 characters");
      return;
    }

    if (!trimmedFeedUrl.startsWith("http")) {
      toast.error("Feed URL must start with http or https");
      return;
    }

    setLoading(true);

    try {
      const response = await apiPost("/feeds", {
        name: trimmedName,
        feed_url: trimmedFeedUrl,
      });

      if (response.ok) {
        const data = await response.json();
        toast.success("Feed created successfully");
        onCreated(data);
        onOpenChange(false);
        setName("");
        setFeedUrl("");
      } else {
        const error = await response.json().catch(() => ({ detail: "Failed to create feed" }));
        toast.error(error.detail || "Failed to create feed");
      }
    } catch (error) {
      console.error("Failed to create feed:", error);
      toast.error("An error occurred while creating the feed");
    } finally {
      setLoading(false);
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
