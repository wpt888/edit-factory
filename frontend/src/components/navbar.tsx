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
} from "lucide-react";

const navGroups = [
  {
    label: "Create",
    items: [
      { label: "Pipeline", href: "/pipeline", icon: Clapperboard, desc: "Video processing pipeline" },
      { label: "Segments", href: "/segments", icon: Scissors, desc: "Manual segment selection" },
      { label: "AI Image", href: "/create-image", icon: ImageIcon, desc: "Generate AI product images" },
    ],
  },
  {
    label: "Library",
    items: [
      { label: "Clips", href: "/librarie", icon: Film, desc: "Browse all clips" },
      { label: "TTS", href: "/tts-library", icon: Music, desc: "Text-to-speech assets" },
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
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/pipeline" className="flex items-center">
            <span className="text-xl md:text-2xl font-bold text-primary">
              EditAI
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

              {/* Settings gear dropdown */}
              <NavigationMenuItem>
                <NavigationMenuTrigger
                  className={isGroupActive(settingsGroup.items, pathname) ? "text-foreground bg-accent/50" : "text-muted-foreground"}
                >
                  <Settings className="size-4" />
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid w-[220px] gap-1 p-2">
                    {settingsGroup.items.map((item) => (
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
                  <SheetTitle className="text-left text-primary text-lg">EditAI</SheetTitle>
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
