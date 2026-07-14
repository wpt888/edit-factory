"use client";

import { useCallback, useMemo, useState, type DragEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BriefcaseBusiness, GripVertical, Plus } from "lucide-react";
import { CreateProfileDialog } from "@/components/dialogs/create-profile-dialog";
import { useProfile, type Profile } from "@/contexts/profile-context";
import { cn } from "@/lib/utils";
import {
  beginWorkspaceNavigation,
  getLastWorkspaceRoute,
  getWorkspaceOrder,
  saveLastWorkspaceRoute,
  saveWorkspaceOrder,
} from "@/lib/workspace-session";

const DESKTOP_MODE = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";

interface WorkspaceBarProps {
  titlebar?: boolean;
}

interface DropTarget {
  profileId: string;
  side: "before" | "after";
}

/** Desktop workspace tabs. One existing profile is one workspace. */
export function WorkspaceBar({ titlebar = false }: WorkspaceBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { currentProfile, profiles, setCurrentProfile, isLoading } = useProfile();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [workspaceOrder, setWorkspaceOrder] = useState<string[]>([]);
  const [draggedProfileId, setDraggedProfileId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const orderedProfiles = useMemo(() => {
    const availableIds = profiles.map((profile) => profile.id);
    const requestedOrder = workspaceOrder.length > 0
      ? [
          ...workspaceOrder.filter((id) => availableIds.includes(id)),
          ...availableIds.filter((id) => !workspaceOrder.includes(id)),
        ]
      : availableIds;
    const resolvedOrder = getWorkspaceOrder(requestedOrder);
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    const ordered = resolvedOrder
      .map((profileId) => profilesById.get(profileId))
      .filter((profile): profile is Profile => Boolean(profile));
    const orderedIds = new Set(ordered.map((profile) => profile.id));
    return [...ordered, ...profiles.filter((profile) => !orderedIds.has(profile.id))];
  }, [profiles, workspaceOrder]);

  const selectWorkspace = useCallback((profile: Profile) => {
    if (profile.id === currentProfile?.id) return;
    if (currentProfile?.id) saveLastWorkspaceRoute(currentProfile.id, pathname);
    const targetRoute = getLastWorkspaceRoute(profile.id);
    beginWorkspaceNavigation(profile.id, targetRoute);
    setCurrentProfile(profile);
    // Push even when the pathname matches so query params owned by the previous
    // workspace (for example /pipeline?id=...) cannot bleed into the next one.
    router.push(targetRoute);
  }, [currentProfile, pathname, router, setCurrentProfile]);

  const moveWorkspace = useCallback((sourceId: string, target: DropTarget) => {
    if (sourceId === target.profileId) return;
    const availableIds = profiles.map((profile) => profile.id);
    setWorkspaceOrder((currentOrder) => {
      const baseOrder = getWorkspaceOrder(
        currentOrder.length > 0
          ? [...currentOrder.filter((id) => availableIds.includes(id)), ...availableIds.filter((id) => !currentOrder.includes(id))]
          : availableIds,
      );
      if (!baseOrder.includes(sourceId) || !baseOrder.includes(target.profileId)) return baseOrder;

      const nextOrder = baseOrder.filter((id) => id !== sourceId);
      const targetIndex = nextOrder.indexOf(target.profileId);
      const insertionIndex = target.side === "after" ? targetIndex + 1 : targetIndex;
      nextOrder.splice(insertionIndex, 0, sourceId);
      saveWorkspaceOrder(nextOrder);
      return nextOrder;
    });
  }, [profiles]);

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, profileId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", profileId);
    setDraggedProfileId(profileId);
    setDropTarget(null);
  };

  const handleDragOver = (event: DragEvent<HTMLButtonElement>, profileId: string) => {
    if (!draggedProfileId || draggedProfileId === profileId) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropTarget({
      profileId,
      side: event.clientX < bounds.left + bounds.width / 2 ? "before" : "after",
    });
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>, profileId: string) => {
    event.preventDefault();
    const sourceId = draggedProfileId || event.dataTransfer.getData("text/plain");
    const bounds = event.currentTarget.getBoundingClientRect();
    if (sourceId && sourceId !== profileId) {
      moveWorkspace(sourceId, {
        profileId,
        side: event.clientX < bounds.left + bounds.width / 2 ? "before" : "after",
      });
    }
    setDraggedProfileId(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDraggedProfileId(null);
    setDropTarget(null);
  };

  if (!DESKTOP_MODE) return null;

  return (
    <>
      <div
        className={cn(
          "flex shrink-0 items-stretch bg-sidebar text-sidebar-foreground",
          titlebar ? "h-full" : "h-10 border-b border-sidebar-border",
        )}
        role="tablist"
        aria-label="Workspaces"
        data-testid="workspace-bar"
      >
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {isLoading ? (
            <div className="m-2 h-6 w-40 animate-pulse rounded bg-sidebar-accent" />
          ) : orderedProfiles.map((profile) => {
            const active = profile.id === currentProfile?.id;
            const isDragged = profile.id === draggedProfileId;
            const profileDropTarget = dropTarget?.profileId === profile.id ? dropTarget : null;
            return (
              <button
                key={profile.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={profile.name}
                draggable
                title={`${profile.description || profile.name} · Drag to reorder`}
                onClick={() => selectWorkspace(profile)}
                onDragStart={(event) => handleDragStart(event, profile.id)}
                onDragOver={(event) => handleDragOver(event, profile.id)}
                onDrop={(event) => handleDrop(event, profile.id)}
                onDragEnd={handleDragEnd}
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                className={cn(
                  "group relative flex min-w-32 max-w-56 shrink-0 cursor-grab items-center gap-2 border-r border-sidebar-border px-3 text-sm transition-colors active:cursor-grabbing",
                  active
                    ? "bg-background text-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  isDragged && "opacity-40",
                )}
              >
                {profileDropTarget && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute inset-y-1 z-20 w-0.5 rounded-full bg-lime",
                      profileDropTarget.side === "before" ? "left-0" : "right-0",
                    )}
                  />
                )}
                <BriefcaseBusiness className={cn("size-3.5", active && "text-lime")} />
                <span className="min-w-0 flex-1 truncate text-left">{profile.name}</span>
                <GripVertical className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" />
                {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-lime" />}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          aria-label="Create workspace"
          title="Create workspace"
          onClick={() => setCreateDialogOpen(true)}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="flex w-10 shrink-0 items-center justify-center border-l border-sidebar-border text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <CreateProfileDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={selectWorkspace}
      />
    </>
  );
}
