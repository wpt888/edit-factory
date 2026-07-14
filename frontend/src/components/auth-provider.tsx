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
import { apiPost, invalidateApiMemoryCache } from "@/lib/api";
import type { AuthError, User, Session } from "@supabase/supabase-js";
import {
  clearCreativeSsoSession,
  creativeLoginUrl,
  isCreativeBoundSession,
  isCreativeSessionActive,
} from "@/lib/creative-sso-session";

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthError | null>;
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
// Desktop mode is intentionally not part of this condition: desktop and web
// clients use the same Supabase identity contract.
const AUTH_DISABLED = process.env.NEXT_PUBLIC_AUTH_DISABLED === "true";
const DESKTOP_MODE = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";

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
const DEV_USER: User | null = {
  // Mirrors _DEV_PROFILE_ID in app/api/auth.py so profile-scoped data lines up.
  id: "00000000-0000-0000-0000-000000000000",
  aud: "authenticated",
  role: "authenticated",
  email: "dev@blipost.local",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
} as User;

export function AuthProvider({ children }: AuthProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(
    AUTH_DISABLED ? DEV_USER : null,
  );
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
    if (!supabase) return; // AUTH_DISABLED — nothing to refresh
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

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!supabase) {
        return new Error("Authentication is disabled") as AuthError;
      }

      const { data, error } = DESKTOP_MODE
        ? await (async () => {
            try {
              const response = await apiPost(
                "/platform/session",
                { email, password },
                { skipAuth: true, timeout: 20_000 },
              );
              const bridge = (await response.json()) as {
                access_token: string;
                refresh_token: string;
              };
              return await supabase.auth.setSession({
                access_token: bridge.access_token,
                refresh_token: bridge.refresh_token,
              });
            } catch (bridgeError) {
              const message =
                bridgeError instanceof Error
                  ? bridgeError.message
                  : "Could not sign in to Blipost";
              return {
                data: { session: null, user: null },
                error: new Error(message) as AuthError,
              };
            }
          })()
        : await supabase.auth.signInWithPassword({ email, password });

      if (!error) {
        // A direct Studio login starts an independent session. It must not
        // inherit a stale Creative SSO binding from a previous account.
        clearCreativeSsoSession();
        // Commit the authenticated identity before the login page navigates.
        // Relying only on the async auth event creates a race with the route
        // guard, which can otherwise bounce a valid login back to /login.
        setSession(data.session);
        setUser(data.user);
      }

      return error;
    },
    [supabase],
  );

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
      clearCreativeSsoSession();
      localStorage.removeItem("editai_current_profile_id");
      localStorage.removeItem("editai_profiles");
      invalidateApiMemoryCache();
      // Always clear local state and redirect, even if signOut API fails (Bug #43)
      setUser(null);
      setSession(null);
      router.replace("/login");
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
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
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
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();
        if (!isMountedRef.current) return;

        if (currentSession) {
          const creativeSessionValid =
            !isCreativeBoundSession(currentSession) ||
            (await isCreativeSessionActive(currentSession.user));
          if (!creativeSessionValid) {
            clearCreativeSsoSession();
            await supabase.auth.signOut({ scope: "local" });
            setUser(null);
            setSession(null);
            window.location.replace(creativeLoginUrl());
            return;
          }
          // Restore the durable local session immediately. The Supabase client
          // refreshes it automatically; forcing a network refresh on every app
          // launch can discard an otherwise valid login during a brief outage
          // or when two startup consumers race on the same refresh token.
          setSession(currentSession);
          setUser(currentSession.user);
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
        if (
          pathnameRef.current !== "/login" &&
          pathnameRef.current !== "/signup"
        ) {
          router.push("/login");
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, router]);

  // SSO sessions are subordinate to Creative. Re-check on focus/visibility so
  // logout in another tab takes effect immediately, plus periodically for a
  // Studio tab that remains open in the foreground.
  useEffect(() => {
    if (!supabase || !session || !isCreativeBoundSession(session)) return;

    let checking = false;
    let disposed = false;
    const verifyCreativeSession = async () => {
      if (checking || disposed) return;
      checking = true;
      const active = await isCreativeSessionActive(session.user);
      checking = false;
      if (active || disposed) return;

      clearCreativeSsoSession();
      try {
        await supabase.auth.signOut({ scope: "local" });
      } finally {
        if (!disposed) {
          setUser(null);
          setSession(null);
          window.location.replace(creativeLoginUrl());
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void verifyCreativeSession();
    };
    window.addEventListener("focus", verifyCreativeSession);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(verifyCreativeSession, 30_000);

    return () => {
      disposed = true;
      window.removeEventListener("focus", verifyCreativeSession);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(interval);
    };
  }, [router, session, supabase]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signIn,
        signOut,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
