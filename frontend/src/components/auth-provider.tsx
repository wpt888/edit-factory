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

export function AuthProvider({ children }: AuthProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = useMemo(() => createClient(), []);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const refreshSession = useCallback(async () => {
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
  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
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
        if (isMountedRef.current) setLoading(false);
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
      } else if (event === "SIGNED_IN") {
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
