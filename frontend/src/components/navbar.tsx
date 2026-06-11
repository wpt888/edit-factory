"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProfileSwitcher } from "@/components/profile-switcher";
import { useProfile } from "@/contexts/profile-context";
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
} from "@/components/ui/navigation-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { useAuth } from "@/components/auth-provider";
import {
  Clapperboard,
  Film,
  Scissors,
  ShoppingBag,
  Video,
  ListChecks,
  Settings,
  BarChart3,
  Menu,
  ChevronDown,
  Music,
  ImageIcon,
  CalendarClock,
  Calendar,
  BookOpen,
  LogOut,
} from "lucide-react";

const DESKTOP_MODE = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";

// Web-SaaS-only destinations hidden in the desktop build (MVP desktop trim, F1).
// Their backend routers are not mounted in desktop mode, so the pages would
// only show errors. Code stays — the web build still renders everything.
const WEB_ONLY_HREFS = new Set([
  "/create-image",
  "/schedule",
  "/products",
  "/product-video",
  "/batch-generate",
  "/calendar",
]);

const allNavGroups = [
  {
    label: "Create",
    items: [
      { label: "Pipeline", href: "/pipeline", icon: Clapperboard, desc: "Video processing pipeline" },
      { label: "Batch", href: "/batch", icon: ListChecks, desc: "Batch video generation" },
      { label: "Segments", href: "/segments", icon: Scissors, desc: "Manual segment selection" },
      { label: "AI Image", href: "/create-image", icon: ImageIcon, desc: "Generate AI product images" },
    ],
  },
  {
    label: "Library",
    items: [
      { label: "Clips", href: "/librarie", icon: Film, desc: "Browse all clips" },
      { label: "TTS", href: "/tts-library", icon: Music, desc: "Text-to-speech assets" },
      { label: "Schedule", href: "/schedule", icon: CalendarClock, desc: "Smart schedule publishing" },
    ],
  },
  {
    label: "Products",
    items: [
      { label: "Catalog", href: "/products", icon: ShoppingBag, desc: "Product catalog" },
      { label: "Generate", href: "/product-video", icon: Video, desc: "Generate product videos" },
      { label: "Batch", href: "/batch-generate", icon: ListChecks, desc: "Batch video generation" },
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

const SHOW_CALENDAR = !DESKTOP_MODE;

const settingsGroup = {
  label: "Settings",
  items: [
    { label: "Settings", href: "/settings", icon: Settings, desc: "App configuration" },
    { label: "Usage", href: "/usage", icon: BarChart3, desc: "API usage & costs" },
  ],
};

function isGroupActive(items: { href: string }[], pathname: string) {
  return items.some((item) => pathname.startsWith(item.href));
}

export function NavBar() {
  const { currentProfile, isLoading } = useProfile();
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/pipeline" className="flex items-center">
            <span className="text-xl md:text-2xl font-bold text-primary">
              Edit Factory
            </span>
          </Link>

          {/* Desktop Navigation */}
          <NavigationMenu className="hidden lg:flex">
            <NavigationMenuList>
              {navGroups.map((group) => (
                <NavigationMenuItem key={group.label}>
                  <NavigationMenuTrigger
                    className={isGroupActive(group.items, pathname) ? "text-foreground bg-accent/50" : "text-muted-foreground"}
                  >
                    {group.label}
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <ul className="grid w-[280px] gap-1 p-2">
                      {group.items.map((item) => (
                        <li key={item.href}>
                          <NavigationMenuLink asChild>
                            <Link
                              href={item.href}
                              className={`flex items-center gap-3 rounded-md p-3 text-sm transition-colors hover:bg-accent ${
                                pathname === item.href ? "bg-accent text-accent-foreground" : ""
                              }`}
                            >
                              <item.icon className="size-4 shrink-0 text-muted-foreground" />
                              <div>
                                <div className="font-medium leading-none">{item.label}</div>
                                <p className="mt-1 text-xs text-muted-foreground">{item.desc}</p>
                              </div>
                            </Link>
                          </NavigationMenuLink>
                        </li>
                      ))}
                    </ul>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              ))}

              {/* Calendar top-level tab (web only — Postiz publishing) */}
              {SHOW_CALENDAR && (
                <NavigationMenuItem>
                  <NavigationMenuLink asChild>
                    <Link
                      href="/calendar"
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent ${
                        pathname === "/calendar" ? "text-foreground bg-accent/50" : "text-muted-foreground"
                      }`}
                    >
                      <Calendar className="size-4" />
                      Calendar
                    </Link>
                  </NavigationMenuLink>
                </NavigationMenuItem>
              )}

              {/* Wiki top-level tab (always — internal knowledge base) */}
              <NavigationMenuItem>
                <NavigationMenuLink asChild>
                  <Link
                    href="/wiki"
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent ${
                      pathname.startsWith("/wiki") ? "text-foreground bg-accent/50" : "text-muted-foreground"
                    }`}
                  >
                    <BookOpen className="size-4" />
                    Wiki
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>

              {/* Settings gear dropdown */}
              <NavigationMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent focus:outline-none ${
                        isGroupActive(settingsGroup.items, pathname) ? "text-foreground bg-accent/50" : "text-muted-foreground"
                      }`}
                    >
                      <Settings className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[220px]">
                    {settingsGroup.items.map((item) => (
                      <DropdownMenuItem key={item.href} asChild>
                        <Link
                          href={item.href}
                          className={`flex items-center gap-3 cursor-pointer ${
                            pathname === item.href ? "bg-accent text-accent-foreground" : ""
                          }`}
                        >
                          <item.icon className="size-4 shrink-0 text-muted-foreground" />
                          <div>
                            <div className="font-medium leading-none">{item.label}</div>
                            <p className="mt-1 text-xs text-muted-foreground">{item.desc}</p>
                          </div>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <div className={isLoading ? "invisible" : ""}>
              <ProfileSwitcher />
            </div>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {currentProfile?.name || "No Profile"}
            </Badge>

            {user && (
              <Button variant="ghost" size="icon" onClick={signOut} title="Sign out">
                <LogOut className="size-4" />
                <span className="sr-only">Sign out</span>
              </Button>
            )}

            {/* Mobile hamburger */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden">
                  <Menu className="size-5" />
                  <span className="sr-only">Toggle menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 overflow-y-auto">
                <SheetHeader>
                  <SheetTitle className="text-left text-primary text-lg">Edit Factory</SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col gap-1 px-2">
                  {[...navGroups, settingsGroup].map((group) => (
                    <MobileNavGroup
                      key={group.label}
                      group={group}
                      pathname={pathname}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  ))}
                  {SHOW_CALENDAR && (
                    <Link
                      href="/calendar"
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent ${
                        pathname === "/calendar" ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground"
                      }`}
                    >
                      <Calendar className="size-4 shrink-0" />
                      Calendar
                    </Link>
                  )}
                  <Link
                    href="/wiki"
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent ${
                      pathname.startsWith("/wiki") ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground"
                    }`}
                  >
                    <BookOpen className="size-4 shrink-0" />
                    Wiki
                  </Link>
                  {user && (
                    <button
                      onClick={() => { signOut(); setMobileOpen(false); }}
                      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors w-full mt-4 border-t pt-4"
                    >
                      <LogOut className="size-4" />
                      Sign Out
                    </button>
                  )}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}

function MobileNavGroup({
  group,
  pathname,
  onNavigate,
}: {
  group: typeof navGroups[0];
  pathname: string;
  onNavigate: () => void;
}) {
  const active = isGroupActive(group.items, pathname);

  return (
    <Collapsible defaultOpen={active}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors">
        <span className={active ? "text-foreground" : "text-muted-foreground"}>
          {group.label}
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-2 flex flex-col gap-0.5 border-l pl-3 py-1">
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent ${
                pathname === item.href ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground"
              }`}
            >
              <item.icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
