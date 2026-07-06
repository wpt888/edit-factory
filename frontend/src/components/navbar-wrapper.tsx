"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/navbar";

// Paths rendered without the app shell (sidebar): auth & onboarding flows
const barePaths = ["/login", "/signup", "/setup", "/auth"];

export function NavBarWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (barePaths.some((path) => pathname.startsWith(path))) {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}
