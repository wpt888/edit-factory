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

import { useState, useEffect, useRef } from "react";
import { useProfile, type Profile } from "@/contexts/profile-context";
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

interface CreateProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (profile: Profile) => void;
}
export function CreateProfileDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateProfileDialogProps) {
  const { refreshProfiles } = useProfile();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Bug #136: reset form state when dialog closes
  useEffect(() => {
    if (!open) { setName(""); setDescription(""); }
  }, [open]);

  const handleCreate = async () => {
    // Validate name length
    const trimmedName = name.trim();

    if (trimmedName.length < 2) {
      toast.error("Workspace name must be at least 2 characters");
      return;
    }

    if (trimmedName.length > 50) {
      toast.error("Workspace name must be 50 characters or less");
      return;
    }

    setLoading(true);

    try {
      const response = await apiPost("/profiles/", {
        name: trimmedName,
        description: description.trim() || undefined,
      });

      const createdProfile = await response.json() as Profile;

      if (!isMountedRef.current) return;
      toast.success("Workspace created successfully");

      await refreshProfiles();

      if (!isMountedRef.current) return;
      onCreated?.(createdProfile);
      onOpenChange(false);
      setName("");
      setDescription("");
    } catch (error) {
      if (!isMountedRef.current) return;
      handleApiError(error, "Error creating workspace");
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Workspace</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">
              Workspace Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Client X, Fashion Store"
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
              placeholder="Client, store, or project description"
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
            {loading ? "Creating..." : "Create Workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
