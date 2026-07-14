"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

const PUBLIC_ROUTES = ["/login", "/signup", "/setup", "/auth/callback"];

interface DesktopAuthGuardProps {
  children: React.ReactNode;
}

/**
 * Client-side Supabase session gate.
 *
 * The web build also has middleware. Electron still needs this guard because
 * its local Next server must start independently of server-readable auth state.
 */
export function DesktopAuthGuard({ children }: DesktopAuthGuardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/"),
  );

  useEffect(() => {
    if (loading) return;

    // A restored or newly-created session must never remain stranded on the
    // login form. This also provides a safe fallback if navigation from the
    // submit handler is interrupted by a React remount.
    if (user && (pathname === "/login" || pathname === "/signup")) {
      const requested = new URLSearchParams(window.location.search).get("next");
      const destination = requested?.startsWith("/") && !requested.startsWith("//")
        ? requested
        : "/librarie";
      router.replace(destination);
      return;
    }

    if (isPublicRoute || user) return;
    const next = pathname && pathname.startsWith("/") ? pathname : "/librarie";
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [isPublicRoute, loading, pathname, router, user]);

  if (isPublicRoute) return <>{children}</>;

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
