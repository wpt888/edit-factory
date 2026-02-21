/**
 * CreateProfileDialog - Modal dialog for creating new profiles
 *
 * Features:
 * - Name and description input fields
 * - Validation: min 2 chars, max 50 chars for profile name
 * - Character count display
 * - API integration with toast notifications
 * - Auto-refresh profile list after creation
 */

"use client";

import { useState } from "react";
import { useProfile } from "@/contexts/profile-context";
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

interface CreateProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProfileDialog({
  open,
  onOpenChange,
}: CreateProfileDialogProps) {
  const { refreshProfiles } = useProfile();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    // Validate name length
    const trimmedName = name.trim();

    if (trimmedName.length < 2) {
      toast.error("Profile name must be at least 2 characters");
      return;
    }

    if (trimmedName.length > 50) {
      toast.error("Profile name must be 50 characters or less");
      return;
    }

    setLoading(true);

    try {
      const response = await apiPost("/profiles/", {
        name: trimmedName,
        description: description.trim() || undefined,
      });

      if (response.ok) {
        toast.success("Profile created successfully");

        // Refresh the profile list in context
        await refreshProfiles();

        // Close dialog and reset form
        onOpenChange(false);
        setName("");
        setDescription("");
      } else {
        const error = await response.json();
        toast.error(error.detail || "Failed to create profile");
      }
    } catch (error) {
      console.error("Failed to create profile:", error);
      toast.error("An error occurred while creating the profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Profile</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">
              Profile Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Personal, Work, Client X"
              maxLength={50}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              {name.length}/50 characters
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-description">Description</Label>
            <Input
              id="profile-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description"
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
