"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

// When NEXT_PUBLIC_AUTH_DISABLED=true we must not instantiate the Supabase
// browser client at all: its constructor runs _recoverAndRefresh() against any
// stored session and crashes with `TypeError: Failed to fetch` during
// HMR/Fast Refresh remounts or when the stored refresh_token is stale.
// Matches the gate already present in middleware.ts:15 and the backend
// auth_disabled branch in app/api/auth.py.
// Also bypass in desktop builds: the desktop renderer never has a Supabase SSR
// session (auth is the local /desktop/auth gate + 1234), and a clean/CI build
// without baked Supabase env vars would otherwise crash createClient() at render.
// Mirrors the desktop no-op in middleware.ts, so a fresh build behaves exactly
// like the current one instead of white-screening.
const AUTH_DISABLED =
  process.env.NEXT_PUBLIC_AUTH_DISABLED === "true" ||
  process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";

// TODO(you): fill in the dev user contract below.
//
// This is the object returned from useAuth() in dev mode. The backend already
// hardcodes a dev user when AUTH_DISABLED=true, so we want the frontend to
// mirror that — otherwise navbar.tsx and pages that read `user?.id` will
// flip into guest mode and hide data.
//
// Fields to decide (5–10 lines):
//   - id:    should match whatever profile_id your backend dev-bypass returns
//            (grep backend for `auth_disabled` / dev user to find it)
//   - email: cosmetic, shows in navbar dropdown
//   - any other User fields your pages actually read (check navbar + pipeline)
//
// Return `null` instead of an object if you want to test the real guest UX.
const DEV_USER: User | null = null;  // <-- replace with { id, email, ... } or keep null

export function AuthProvider({ children }: AuthProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(AUTH_DISABLED ? DEV_USER : null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!AUTH_DISABLED);

  // Only create the Supabase client when auth is actually enabled. The
  // constructor itself triggers network calls, so gating createClient() is
  // what actually silences the "Failed to fetch" error — not just skipping
  // refreshSession().
  const supabase = useMemo(() => (AUTH_DISABLED ? null : createClient()), []);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const refreshSession = useCallback(async () => {
    if (!supabase) return;  // AUTH_DISABLED — nothing to refresh
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        console.error("Error refreshing session:", error);
        setUser(null);
        setSession(null);
      } else {
        setSession(data.session);
        setUser(data.session?.user ?? null);
      }
    } catch (error) {
      console.error("Error in refreshSession:", error);
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) {
      // AUTH_DISABLED — no real session to terminate, just bounce to login
      // so the user can test the login UI if they want.
      setUser(null);
      setSession(null);
      router.push("/login");
      return;
    }
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    } finally {
      // Always clear local state and redirect, even if signOut API fails (Bug #43)
      setUser(null);
      setSession(null);
      router.push("/login");
    }
  }, [supabase, router]);

  const isMountedRef = useRef(true);
  // Track whether initAuth has completed to distinguish real sign-ins from
  // session-restore/token-refresh events that Supabase fires as SIGNED_IN.
  // Without this guard, refreshSession() inside initAuth triggers SIGNED_IN →
  // router.refresh() → full remount → initAuth again → infinite loop that
  // interrupts video playback and resets all page state.
  const initCompleteRef = useRef(false);
  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    initCompleteRef.current = false;

    // AUTH_DISABLED: no Supabase client exists, skip init + listener entirely.
    // State was already seeded from DEV_USER above, and loading started false.
    if (!supabase) {
      initCompleteRef.current = true;
      return;
    }

    // Initial session check
    const initAuth = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!isMountedRef.current) return;

        if (currentSession) {
          // Session exists — try to refresh the token
          const { data, error } = await supabase.auth.refreshSession();
          if (!isMountedRef.current) return;
          if (error) {
            console.error("Error refreshing session:", error);
            // Stale session — clear it
            setUser(null);
            setSession(null);
          } else {
            setSession(data.session);
            setUser(data.session?.user ?? null);
          }
        } else {
          // No session — nothing to refresh
          setUser(null);
          setSession(null);
        }
      } catch (error) {
        console.error("Error in initAuth:", error);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          initCompleteRef.current = true;
        }
      }
    };

    initAuth();

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!isMountedRef.current) return;
      // Skip INITIAL_SESSION — already handled by initAuth above (Bug #42)
      if (event === "INITIAL_SESSION") return;

      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (event === "SIGNED_OUT") {
        // Redirect to login on sign out
        if (pathnameRef.current !== "/login" && pathnameRef.current !== "/signup") {
          router.push("/login");
        }
      } else if (event === "SIGNED_IN" && initCompleteRef.current) {
        // Only refresh for genuine post-init sign-ins (e.g., login page redirect).
        // Supabase may fire SIGNED_IN during token refresh / session restore;
        // calling router.refresh() in those cases remounts the entire page tree.
        router.refresh();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, router]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signOut,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
