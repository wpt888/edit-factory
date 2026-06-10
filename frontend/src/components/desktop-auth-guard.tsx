"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { Loader2 } from "lucide-react";

const DESKTOP_MODE = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";
const PUBLIC_ROUTES = ["/login", "/signup", "/setup", "/auth/callback"];

interface DesktopAuthGuardProps {
  children: React.ReactNode;
}

/**
 * Desktop test-auth gate. Replaces the old license gate.
 *
 * In desktop mode, protected routes require the simple username/password login
 * (backend /desktop/auth/status). Unauthenticated users are redirected to
 * /login. On the web build (DESKTOP_MODE !== "true") this is a no-op — Supabase
 * auth + middleware handle gating there.
 */
export function DesktopAuthGuard({ children }: DesktopAuthGuardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  const checkAuth = useCallback(async () => {
    try {
      const resp = await apiGet("/desktop/auth/status", { skipAuth: true });
      const data = await resp.json();
      if (data.logged_in) {
        setAuthed(true);
        return;
      }
      // Not logged in — redirect; keep showing the spinner (never render children).
      router.push("/login");
    } catch {
      // Backend unreachable or error — fail closed: send to login.
      router.push("/login");
    }
  }, [router]);

  useEffect(() => {
    if (!DESKTOP_MODE || isPublicRoute) return;
    checkAuth();
  }, [isPublicRoute, checkAuth]);

  // Web build or public routes bypass the desktop gate.
  if (!DESKTOP_MODE || isPublicRoute) {
    return <>{children}</>;
  }

  // Until auth is confirmed, show only a spinner. Crucially we never render the
  // protected children for an unauthenticated user — not even for one frame
  // while redirecting — which previously crashed the root/pipeline page.
  if (!authed) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
