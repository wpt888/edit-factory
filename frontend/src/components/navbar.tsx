"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import blipostLogo from "../../public/blipost-logo.png";
import { cn } from "@/lib/utils";
import { ProfileSwitcher } from "@/components/profile-switcher";
import { useProfile } from "@/contexts/profile-context";
import { useAuth } from "@/components/auth-provider";
import { apiGet } from "@/lib/api";
import {
  Clapperboard,
  Film,
  Scissors,
  ShoppingBag,
  Tag,
  Video,
  ListChecks,
  Settings,
  BarChart3,
  Music,
  ImageIcon,
  CalendarClock,
  Calendar,
  NotebookPen,
  LogOut,
  Wallet,
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
      { label: "Pipeline", href: "/pipeline", icon: Clapperboard },
      { label: "Batch", href: "/batch", icon: ListChecks },
      { label: "Segments", href: "/segments", icon: Scissors },
      { label: "AI Image", href: "/create-image", icon: ImageIcon },
    ],
  },
  {
    label: "Library",
    items: [
      { label: "Clips", href: "/librarie", icon: Film },
      { label: "TTS", href: "/tts-library", icon: Music },
      { label: "Schedule", href: "/schedule", icon: CalendarClock },
    ],
  },
  {
    label: "Products",
    items: [
      // D1: local product library is the default source; the Gomag catalog is
      // gated off (see /products page + CATALOG_GOMAG_ENABLED backend flag).
      { label: "My Products", href: "/product-library", icon: ShoppingBag },
      { label: "Feed Import", href: "/products", icon: Tag },
      { label: "Generate", href: "/product-video", icon: Video },
      { label: "Batch Generate", href: "/batch-generate", icon: ListChecks },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "Calendar", href: "/calendar", icon: Calendar },
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
}: {
  item: { label: string; href: string; icon: React.ComponentType<{ className?: string }> };
  pathname: string;
}) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      className={cn(
        "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      )}
    >
      <item.icon className={cn("size-4", active && "text-lime")} />
      {item.label}
    </Link>
  );
}

function AppNav({ horizontal = false }: { horizontal?: boolean }) {
  const pathname = usePathname();
  if (horizontal) {
    return (
      <nav className="flex items-center gap-1 overflow-x-auto">
        {navGroups.flatMap((group) =>
          group.items.map((item) => <NavLink key={item.href} item={item} pathname={pathname} />)
        )}
      </nav>
    );
  }
  return (
    <nav className="flex flex-col gap-1">
      {navGroups.map((group) => (
        <React.Fragment key={group.label}>
          <p className="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wider text-sidebar-foreground/40 uppercase first:pt-0">
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
      .catch(() => { if (!cancelled) setBalance(null); });
    return () => { cancelled = true; };
  }, [currentProfile]);

  if (balance === null) return null;
  return (
    <Link
      href="/settings"
      className="flex items-center gap-2 rounded-xl border border-lime/40 bg-lime/10 px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-lime/15"
      title="Blipost credit balance"
    >
      <Wallet className="size-4 text-lime" />
      <span className="font-semibold">{balance.toLocaleString()}</span>
      <span className="text-sidebar-foreground/60">credits</span>
    </Link>
  );
}

function Wordmark({ className }: { className?: string }) {
  return (
    <Image
      src={blipostLogo}
      alt="Blipost"
      priority
      className={cn("w-auto", className)}
    />
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { currentProfile } = useProfile();
  const { user, signOut } = useAuth();

  const displayName = user?.email || currentProfile?.name || "You";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full overflow-hidden bg-ink">
      {/* desktop sidebar */}
      <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="px-5 pt-6 pb-4">
          <Link href="/pipeline" className="flex items-center">
            <Wordmark className="h-8" />
          </Link>
          <p className="mt-2.5 text-xs leading-snug text-sidebar-foreground/45">
            AI scripts, TTS and video assembly
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pt-2">
          <AppNav />
        </div>
        <div className="flex flex-col gap-3 px-4 pb-5 pt-3">
          <CreditBalance />
          <ProfileSwitcher />
          <div className="flex items-center gap-2.5 rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime font-heading text-sm font-bold text-ink">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-xs font-medium text-lime">
                {currentProfile?.name || "No profile"}
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

      {/* content + mobile chrome */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-40 flex flex-col gap-2 border-b border-sidebar-border bg-sidebar px-4 pt-3 pb-2 text-sidebar-foreground md:hidden">
          <div className="flex items-center justify-between">
            <Link href="/pipeline" className="flex items-center">
              <Wordmark className="h-7" />
            </Link>
            <div className="flex items-center gap-3">
              <ProfileSwitcher />
              {user && (
                <button type="button" onClick={signOut} title="Sign out" className="flex items-center">
                  <LogOut className="size-4 text-sidebar-foreground/70" />
                </button>
              )}
            </div>
          </div>
          <AppNav horizontal />
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
