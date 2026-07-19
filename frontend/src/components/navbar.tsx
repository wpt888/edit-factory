"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import blipostLogo from "../../public/blipost-logo.png";
import { cn } from "@/lib/utils";
import { ProfileSwitcher } from "@/components/profile-switcher";
import { ProductSwitcher } from "@/components/product-switcher";
import { WorkspaceBar } from "@/components/workspace-bar";
import { useProfile } from "@/contexts/profile-context";
import { useAuth } from "@/components/auth-provider";
import { apiGet } from "@/lib/api";
import {
  completeWorkspaceNavigation,
  getPendingWorkspaceNavigation,
  isActiveWorkspace,
  saveLastWorkspaceRoute,
} from "@/lib/workspace-session";
import {
  Clapperboard,
  Film,
  Scissors,
  BookOpen,
  Video,
  ListChecks,
  ListVideo,
  Settings,
  BarChart3,
  Music,
  ImageIcon,
  Images,
  CalendarClock,
  Calendar,
  NotebookPen,
  LogOut,
  Zap,
  ChevronLeft,
  ChevronRight,
  Workflow,
  LayoutTemplate,
} from "lucide-react";

const DESKTOP_MODE = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";

// Desktop now mounts ALL backend routers (full web↔desktop parity — see app/main.py),
// so every destination works in the desktop build too. Nothing is hidden anymore.
// Kept as an (empty) set + filter below so re-trimming a single page later stays a
// one-line change instead of a refactor.
const WEB_ONLY_HREFS = new Set<string>([]);

const allNavGroups = [
  {
    label: "Create",
    items: [
      { label: "Video Pipeline", href: "/pipeline", icon: Clapperboard },
      { label: "Attention Templates", href: "/attention-templates", icon: LayoutTemplate },
      { label: "Footage & Segments", href: "/segments", icon: ListVideo },
      { label: "Clipping", href: "/clipping", icon: Scissors },
      { label: "AI Image", href: "/create-image", icon: ImageIcon },
      { label: "AI Video", href: "/create-video", icon: Film },
    ],
  },
  {
    label: "Library",
    items: [
      { label: "Local Exports", href: "/librarie", icon: Film },
      { label: "Media Library", href: "/media-library", icon: Images },
      { label: "TTS", href: "/tts-library", icon: Music },
      { label: "Schedule", href: "/schedule", icon: CalendarClock },
    ],
  },
  {
    label: "Context",
    items: [
      // D1: local context library is the default source; the Gomag catalog is
      // gated off (see /products page + CATALOG_GOMAG_ENABLED backend flag).
      { label: "Context Library", href: "/product-library", icon: BookOpen },
      { label: "Context Video", href: "/product-video", icon: Video },
      { label: "Batch Generate", href: "/batch-generate", icon: ListChecks },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "Calendar", href: "/calendar", icon: Calendar },
      { label: "Automations", href: "/automations", icon: Workflow },
      { label: "Notes", href: "/wiki", icon: NotebookPen },
      { label: "Settings", href: "/settings", icon: Settings },
      { label: "Usage", href: "/usage", icon: BarChart3 },
    ],
  },
];

const navGroups = DESKTOP_MODE
  ? allNavGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !WEB_ONLY_HREFS.has(item.href)),
      }))
      .filter((group) => group.items.length > 0)
  : allNavGroups;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLink({
  item,
  pathname,
  collapsed = false,
}: {
  item: {
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
  };
  pathname: string;
  collapsed?: boolean;
}) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex shrink-0 items-center gap-2.5 rounded-lg text-sm font-medium transition-colors",
        collapsed ? "justify-center py-2" : "px-3 py-2",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
      )}
    >
      <item.icon className="size-4" />
      {!collapsed && item.label}
    </Link>
  );
}

function AppNav({
  horizontal = false,
  collapsed = false,
}: {
  horizontal?: boolean;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  if (horizontal) {
    return (
      <nav className="flex items-center gap-1 overflow-x-auto">
        {navGroups.flatMap((group) =>
          group.items.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          )),
        )}
      </nav>
    );
  }
  // Icon-only rail: drop the group headers, keep dividers between groups.
  if (collapsed) {
    return (
      <nav className="flex flex-col gap-0.5">
        {navGroups.map((group, index) => (
          <React.Fragment key={group.label}>
            {index > 0 && (
              <div className="mx-2 my-1.5 border-t border-sidebar-border" />
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed
              />
            ))}
          </React.Fragment>
        ))}
      </nav>
    );
  }
  return (
    <nav className="flex flex-col gap-0.5">
      {navGroups.map((group) => (
        <React.Fragment key={group.label}>
          <p className="px-3 pt-4 pb-1 text-[10px] font-semibold tracking-[0.14em] text-sidebar-foreground/35 uppercase">
            {group.label}
          </p>
          {group.items.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </React.Fragment>
      ))}
    </nav>
  );
}

// Credit balance pill — only renders when a Blipost platform token is connected.
// Refreshes on mount (and when the profile changes), per the U1 spec.
function CreditBalance() {
  const { currentProfile } = useProfile();
  const [balance, setBalance] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!currentProfile) return;
    let cancelled = false;
    apiGet("/platform/me")
      .then((res) => res.json())
      .then((data: { connected?: boolean; balance?: number | null }) => {
        if (!cancelled && data.connected && typeof data.balance === "number") {
          setBalance(data.balance);
        } else if (!cancelled) {
          setBalance(null);
        }
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProfile]);

  if (balance === null) return null;
  return (
    <Link
      href="/settings"
      className="group rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-3 transition-colors hover:border-lime/30"
      title="Blipost credit balance"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-sidebar-foreground/60">AI Credits Remaining</span>
        <Zap className="size-3.5 text-lime" />
      </div>
      <p className="mt-1.5 font-mono text-sm font-semibold">{balance.toLocaleString()}</p>
    </Link>
  );
}

function Wordmark({ className }: { className?: string }) {
  // Keep the brand artwork identical across themes. Its white lettering needs
  // a stable dark field for contrast on the light sidebar.
  return (
    <span className="inline-flex rounded-md bg-ink px-2 py-1.5">
      <Image
        src={blipostLogo}
        alt="Blipost"
        priority
        className={cn("w-auto", className)}
      />
    </span>
  );
}

const SIDEBAR_STORAGE_KEY = "blipost.sidebar.collapsed";

// Runtime Electron detection (same pattern as desktop-titlebar.tsx). The
// build-time flag alone is not enough: the desktop standalone build can be
// opened in a plain browser (localhost:3947), where the Electron titlebar —
// and its workspace tabs — don't exist.
const subscribeRuntime = () => () => {};

export function AppShell({ children }: { children: React.ReactNode }) {
  const isElectron = React.useSyncExternalStore(
    subscribeRuntime,
    () => DESKTOP_MODE && Boolean(window.editFactory?.isDesktop),
    () => DESKTOP_MODE,
  );
  const { currentProfile } = useProfile();
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const routeProfileRef = React.useRef(currentProfile?.id);
  const pendingWorkspaceNavigation = getPendingWorkspaceNavigation();
  const workspaceTransitioning = Boolean(
    pendingWorkspaceNavigation &&
    (currentProfile?.id !== pendingWorkspaceNavigation.profileId ||
      pathname !== pendingWorkspaceNavigation.pathname),
  );

  // Remember navigation independently for every profile/workspace. Skip the
  // transitional render immediately after switching profiles: it can still
  // carry the previous workspace's pathname until router.push settles.
  React.useEffect(() => {
    const profileId = currentProfile?.id;
    if (!profileId) return;
    const pendingNavigation = getPendingWorkspaceNavigation();
    if (pendingNavigation) {
      if (
        pendingNavigation.profileId === profileId &&
        pendingNavigation.pathname === pathname
      ) {
        routeProfileRef.current = profileId;
        completeWorkspaceNavigation(profileId, pathname);
      }
      return;
    }
    if (routeProfileRef.current !== profileId) {
      routeProfileRef.current = profileId;
      return;
    }
    // setCurrentProfile persists the new profile before router.push settles.
    // If the URL moves first, do not attribute that transitional route to the
    // workspace that is already being left.
    if (!isActiveWorkspace(profileId)) return;
    saveLastWorkspaceRoute(profileId, pathname);
  }, [currentProfile?.id, pathname]);

  // Restore the persisted preference after mount — reading localStorage during
  // render would break hydration (the server has no localStorage).
  React.useEffect(() => {
    if (localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true")
      setCollapsed(true);
  }, []);

  const toggleSidebar = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        /* private mode / storage disabled — collapse still works for the session */
      }
      return next;
    });
  }, []);

  const displayName = user?.email || currentProfile?.name || "You";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* desktop sidebar — icon-only rail when collapsed, full panel otherwise */}
      {collapsed ? (
        <aside className="hidden h-full w-16 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
          <div className="flex justify-center px-2 pt-4 pb-2">
            <button
              type="button"
              onClick={toggleSidebar}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              className="flex size-9 items-center justify-center rounded-lg text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="flex justify-center px-2 pb-2">
            <ProductSwitcher
              activeProduct="studio"
              compact
              compactMenuPlacement="side"
            />
          </div>
          <div className="flex-1 overflow-y-auto px-2 pt-2">
            <AppNav collapsed />
          </div>
          <div className="flex flex-col items-center gap-2 px-2 pb-5 pt-3">
            <span
              title={`${displayName}${currentProfile?.name ? ` · ${currentProfile.name}` : ""}`}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime font-heading text-sm font-bold text-ink"
            >
              {initial}
            </span>
            {user && (
              <button
                type="button"
                onClick={signOut}
                title="Sign out"
                className="flex size-9 items-center justify-center rounded-lg text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <LogOut className="size-4" />
              </button>
            )}
          </div>
        </aside>
      ) : (
        <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
          <div className="px-5 pt-6 pb-4">
            <div className="flex items-start justify-between">
              <Link href="/pipeline" className="flex items-center">
                <Wordmark className="h-11" />
              </Link>
              <button
                type="button"
                onClick={toggleSidebar}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <ChevronLeft className="size-4" />
              </button>
            </div>
            <div className="mt-3">
              <ProductSwitcher activeProduct="studio" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pt-2">
            <AppNav />
          </div>
          <div className="flex flex-col gap-3 px-4 pb-5 pt-3">
            <CreditBalance />
            <ProfileSwitcher />
            <div className="flex items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime font-heading text-sm font-bold text-ink">
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <p className="truncate text-xs font-medium text-sidebar-foreground/60">
                  {currentProfile?.name || "No workspace"}
                </p>
              </div>
              {user && (
                <button
                  type="button"
                  onClick={signOut}
                  title="Sign out"
                  className="flex size-8 items-center justify-center rounded-lg text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                >
                  <LogOut className="size-4" />
                </button>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* content + mobile chrome */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Workspace tabs — hidden only when the Electron titlebar already shows them. */}
        {!isElectron && (
          <div className="hidden md:block">
            <WorkspaceBar />
          </div>
        )}
        <header className="sticky top-0 z-40 flex flex-col gap-2 border-b border-sidebar-border bg-sidebar px-4 pt-3 pb-2 text-sidebar-foreground md:hidden">
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Link href="/pipeline" className="flex shrink-0 items-center">
                <Wordmark className="h-7" />
              </Link>
              <ProductSwitcher activeProduct="studio" compact />
            </div>
            <div className="flex items-center gap-3">
              <ProfileSwitcher />
              {user && (
                <button
                  type="button"
                  onClick={signOut}
                  title="Sign out"
                  className="flex items-center"
                >
                  <LogOut className="size-4 text-sidebar-foreground/70" />
                </button>
              )}
            </div>
          </div>
          <AppNav horizontal />
        </header>
        <main
          key={currentProfile?.id || "workspace-loading"}
          className="flex-1 overflow-y-auto"
        >
          {workspaceTransitioning ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Switching workspace…
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
