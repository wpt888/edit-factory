"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { apiPost, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

// Desktop build uses a simple local username/password gate instead of Supabase.
const DESKTOP_MODE = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const isMountedRef = useRef(true);
  useEffect(() => { return () => { isMountedRef.current = false; }; }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Desktop test gate: validate against the local backend, not Supabase.
    if (DESKTOP_MODE) {
      try {
        await apiPost(
          "/desktop/auth/login",
          { username: email, password },
          { skipAuth: true }
        );
        if (!isMountedRef.current) return;
        const next = searchParams.get("next");
        const destination =
          next && next.startsWith("/") && !next.startsWith("//")
            ? next
            : "/librarie";
        router.push(destination);
      } catch (err) {
        if (!isMountedRef.current) return;
        if (err instanceof ApiError && err.status === 401) {
          setError("Incorrect username or password");
        } else {
          setError("Connection error. Please try again.");
        }
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
      return;
    }

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!isMountedRef.current) return;

      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          setError("Incorrect email or password");
        } else if (error.message.includes("Email not confirmed")) {
          setError("Please confirm your email before signing in");
        } else {
          setError(error.message);
        }
        return;
      }

      // Redirect to intended destination or library (Bug #165: router.refresh() after push is redundant)
      const next = searchParams.get("next");
      // Validate: must start with / and not // (prevent open redirect)
      const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/librarie";
      router.push(destination);
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/auth/callback?next=/login/reset-password",
      });
      if (!isMountedRef.current) return;

      if (error) {
        setError(error.message);
        return;
      }

      setResetSent(true);
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink p-4 text-paper">
      <div className="pointer-events-none absolute inset-0 bg-grid-ink" />
      <div className="pointer-events-none absolute inset-0 bg-noise" />
      <div className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-lime/15 blur-[110px]" />
      <Card className="relative w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <span className="font-heading text-2xl font-bold tracking-tight">bli<span className="text-lime">post</span></span>
          </div>
          <CardTitle className="font-heading text-2xl font-bold tracking-tight">
            {forgotMode ? "Reset Password" : "Welcome back!"}
          </CardTitle>
          <CardDescription>
            {forgotMode
              ? "Enter your email to receive a reset link"
              : "Enter your credentials to sign in"}
          </CardDescription>
        </CardHeader>
        {forgotMode ? (
          <form onSubmit={handleForgotPassword}>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {resetSent ? (
                <Alert className="border-primary/30 bg-primary/10">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    Check your email for a password reset link
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                    autoComplete="email"
                  />
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              {!resetSent && (
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>
              )}
              <button
                type="button"
                onClick={() => { setForgotMode(false); setResetSent(false); setError(null); }}
                className="text-sm font-medium text-foreground underline underline-offset-4"
              >
                Back to sign in
              </button>
            </CardFooter>
          </form>
        ) : (
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">{DESKTOP_MODE ? "User" : "Email"}</Label>
                <Input
                  id="email"
                  type={DESKTOP_MODE ? "text" : "email"}
                  placeholder={DESKTOP_MODE ? "Username" : "name@example.com"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete={DESKTOP_MODE ? "username" : "email"}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {!DESKTOP_MODE && (
                    <button
                      type="button"
                      onClick={() => { setForgotMode(true); setError(null); }}
                      className="text-xs font-medium text-foreground underline underline-offset-4"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>
              {DESKTOP_MODE && (
                <p className="text-xs text-muted-foreground">
                  Default local account: username <span className="font-medium">1234</span>, password <span className="font-medium">1234</span>.
                </p>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
              {!DESKTOP_MODE && (
                <p className="text-sm text-muted-foreground text-center">
                  Don&apos;t have an account?{" "}
                  <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
                    Sign up
                  </Link>
                </p>
              )}
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
