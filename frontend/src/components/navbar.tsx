"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ProfileSwitcher } from "@/components/profile-switcher";
import { useProfile } from "@/contexts/profile-context";

const navLinks = [
  { label: "Pipeline", href: "/pipeline" },
  { label: "Librărie", href: "/librarie" },
  { label: "Export", href: "/library" },
  { label: "Scripts", href: "/scripts" },
  { label: "Assembly", href: "/assembly" },
  { label: "TTS", href: "/tts-library" },
  { label: "Products", href: "/products" },
  { label: "Segments", href: "/segments" },
  { label: "Usage", href: "/usage" },
  { label: "Settings", href: "/settings" },
];

export function NavBar() {
  const { currentProfile, isLoading } = useProfile();

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

          {/* Navigation Links - Hidden on mobile */}
          <nav className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right side actions */}
          <div className="flex items-center gap-3">
            <div className={isLoading ? "invisible" : ""}>
              <ProfileSwitcher />
            </div>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {currentProfile?.name || "No Profile"}
            </Badge>
          </div>
        </div>
      </div>
    </header>
  );
}
