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
import { usePathname, useRouter } from "next/navigation";
import { useProfile, type Profile } from "@/contexts/profile-context";
import { CreateProfileDialog } from "@/components/dialogs/create-profile-dialog";
import {
  beginWorkspaceNavigation,
  getLastWorkspaceRoute,
  saveLastWorkspaceRoute,
} from "@/lib/workspace-session";
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
  const pathname = usePathname();
  const router = useRouter();

  // Show skeleton during initial load
  if (isLoading) {
    return (
      <div className="w-full h-9 bg-muted animate-pulse rounded-lg" />
    );
  }

  // Handle profile selection
  const selectWorkspace = (profile: Profile) => {
    if (profile.id === currentProfile?.id) return;
    if (currentProfile?.id) saveLastWorkspaceRoute(currentProfile.id, pathname);
    const targetRoute = getLastWorkspaceRoute(profile.id);
    beginWorkspaceNavigation(profile.id, targetRoute);
    setCurrentProfile(profile);
    router.push(targetRoute);
  };

  const handleProfileChange = (profileId: string) => {
    const selectedProfile = profiles.find((p) => p.id === profileId);
    if (selectedProfile) selectWorkspace(selectedProfile);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-start gap-2">
            <User className="h-4 w-4" />
            <span className="truncate">{currentProfile?.name || "Select Workspace"}</span>
            <ChevronDown className="ml-auto h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Switch Workspace</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {profiles.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              No workspaces available
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
            Create New Workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateProfileDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={selectWorkspace}
      />
    </>
  );
}
