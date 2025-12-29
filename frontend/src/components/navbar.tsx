"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const navLinks = [
  { label: "Librarie", href: "/library" },
  { label: "Usage", href: "/usage" },
  { label: "Functionalitati", href: "/functionalitati" },
  { label: "Cum functioneaza", href: "/cum-functioneaza" },
  { label: "Preturi", href: "/preturi" },
  { label: "Testimoniale", href: "/testimoniale" },
  { label: "Contact", href: "/contact" },
];

export function NavBar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center">
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
            <Badge variant="secondary" className="hidden sm:inline-flex">
              Plan Gratuit
            </Badge>
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              Contul Meu
            </Button>
            <Button size="sm" className="font-semibold" asChild>
              <Link href="/preturi">Upgrade</Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
