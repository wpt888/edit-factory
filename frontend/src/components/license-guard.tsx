"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldX, RefreshCw } from "lucide-react";

const DESKTOP_MODE = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const PUBLIC_ROUTES = ["/login", "/signup", "/setup", "/auth/callback"];

interface LicenseGuardProps {
  children: React.ReactNode;
}

export function LicenseGuard({ children }: LicenseGuardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [licenseChecked, setLicenseChecked] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Skip license checks entirely in non-desktop mode
  if (!DESKTOP_MODE) {
    return <>{children}</>;
  }

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  const checkLicense = useCallback(async () => {
    try {
      const resp = await apiGet("/desktop/license/status", { skipAuth: true });
      const data = await resp.json();

      if (data.needs_revalidation) {
        // Trigger full validation in background
        try {
          await apiPost("/desktop/license/validate", undefined, {
            skipAuth: true,
          });
        } catch (valErr) {
          if (valErr instanceof ApiError && valErr.status === 403) {
            // Validation failed AND grace period exceeded
            setBlocked(true);
            return;
          }
          // Network error during validation -- grace period handles offline
        }
      }

      setBlocked(false);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          // No license activated -- redirect to setup
          router.push("/setup");
          return;
        }
        if (err.status === 403) {
          // License expired + grace period exceeded
          setBlocked(true);
          return;
        }
      }
      // Network error -- do nothing, grace period handles offline
    } finally {
      setLicenseChecked(true);
    }
  }, [router]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      await apiPost("/desktop/license/validate", undefined, {
        skipAuth: true,
      });
      // If validation succeeds, re-check status
      try {
        await apiGet("/desktop/license/status", { skipAuth: true });
        setBlocked(false);
      } catch {
        // Status still invalid
      }
    } catch {
      // Validation failed -- stay blocked
    } finally {
      setRetrying(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (isPublicRoute) {
      setLicenseChecked(true);
      return;
    }

    checkLicense();

    intervalRef.current = setInterval(checkLicense, CHECK_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPublicRoute, checkLicense]);

  // Public routes bypass license checks
  if (isPublicRoute) {
    return <>{children}</>;
  }

  // Show spinner while first check is in progress
  if (!licenseChecked) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Blocking overlay when license is expired and grace period exceeded
  if (blocked) {
    return (
      <>
        {children}
        <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
          <div className="max-w-md text-center space-y-6 p-8">
            <ShieldX className="h-16 w-16 mx-auto text-destructive" />
            <h1 className="text-2xl font-bold">License Expired</h1>
            <p className="text-muted-foreground">
              Your license could not be validated. Please check your internet
              connection and try again, or enter a new license key.
            </p>
            <div className="flex gap-4 justify-center">
              <Button
                variant="outline"
                onClick={handleRetry}
                disabled={retrying}
              >
                {retrying ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Retry Validation
              </Button>
              <Button onClick={() => router.push("/setup")}>
                Enter New Key
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return <>{children}</>;
}
