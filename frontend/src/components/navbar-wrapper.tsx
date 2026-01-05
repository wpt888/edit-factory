"use client";

import { usePathname } from "next/navigation";
import { NavBar } from "@/components/navbar";

// Paths where navbar should be hidden
const hideNavbarPaths = ["/login", "/signup"];

export function NavBarWrapper() {
  const pathname = usePathname();

  // Hide navbar on login and signup pages
  if (hideNavbarPaths.some((path) => pathname.startsWith(path))) {
    return null;
  }

  return <NavBar />;
}
