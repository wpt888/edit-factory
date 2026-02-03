/**
 * ProfileSwitcher - Dropdown menu for switching between profiles
 *
 * Features:
 * - Displays current profile in trigger button
 * - Radio selection for profile switching
 * - "Create New Profile" menu item
 * - Loading state skeleton during initialization
 * - Empty state handling
 */

"use client";

import { useState } from "react";
import { useProfile } from "@/contexts/profile-context";
import { CreateProfileDialog } from "./create-profile-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Plus, User } from "lucide-react";

export function ProfileSwitcher() {
  const { currentProfile, profiles, setCurrentProfile, isLoading } = useProfile();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Show skeleton during initial load
  if (isLoading) {
    return (
      <div className="w-32 h-9 bg-muted animate-pulse rounded-md" />
    );
  }

  // Handle profile selection
  const handleProfileChange = (profileId: string) => {
    const selectedProfile = profiles.find((p) => p.id === profileId);
    if (selectedProfile) {
      setCurrentProfile(selectedProfile);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2">
            <User className="h-4 w-4" />
            {currentProfile?.name || "Select Profile"}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Switch Profile</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {profiles.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              No profiles available
            </div>
          ) : (
            <DropdownMenuRadioGroup
              value={currentProfile?.id}
              onValueChange={handleProfileChange}
            >
              {profiles.map((profile) => (
                <DropdownMenuRadioItem key={profile.id} value={profile.id}>
                  {profile.name}
                  {profile.is_default && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Default
                    </span>
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Create New Profile
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateProfileDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </>
  );
}
