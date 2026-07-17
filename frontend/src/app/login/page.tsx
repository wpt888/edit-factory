"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";
import blipostLogo from "../../../public/blipost-logo.png";
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
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Captions,
  Film,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";

const FEATURES = [
  { icon: WandSparkles, label: "AI scripts" },
  { icon: Captions, label: "Styled captions" },
  { icon: Film, label: "Local rendering" },
  { icon: ShieldCheck, label: "Account-scoped data" },
] as const;

const DESKTOP_MODE = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";
const BLIPOST_WEB_URL = "https://blipost.com";

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
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

    try {
      const error = await signIn(email, password);
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
      router.replace(destination);
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
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-background p-4 text-foreground sm:p-8">
      <div className="pointer-events-none absolute inset-0 bg-noise" />
      <div className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-primary/10 blur-[110px]" />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl lg:grid-cols-[1.15fr_0.85fr]">
        <section className="relative hidden min-h-[620px] overflow-hidden border-r border-border bg-sidebar p-10 lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute -left-24 top-20 size-72 rounded-full bg-primary/10 blur-[100px]" />
          <div className="relative">
            <Image
              src={blipostLogo}
              alt="Blipost"
              priority
              className="h-10 w-auto"
            />
            <h1 className="mt-16 max-w-md font-heading text-4xl font-semibold leading-tight tracking-tight">
              Your local editing studio, connected to your workspace.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
              Sign in to keep projects, voices, templates, and rendering settings tied to the right account.
            </p>
          </div>
          <div className="relative grid grid-cols-2 gap-3">
            {FEATURES.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-3 text-sm">
                <Icon className="size-4 text-lime" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </section>
      <Card className="w-full max-w-none rounded-none border-0 bg-card px-2 py-8 sm:px-6 lg:flex lg:flex-col lg:justify-center">
        <CardHeader className="space-y-1 text-center">
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
                <Button type="submit" variant="cta" className="w-full" disabled={loading}>
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
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      if (DESKTOP_MODE) {
                        window.open(`${BLIPOST_WEB_URL}/forgot-password`, "_blank", "noopener,noreferrer");
                      } else {
                        setForgotMode(true);
                      }
                    }}
                    className="text-xs font-medium text-foreground underline underline-offset-4"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="current-password"
                  className="pr-10"
                />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    disabled={loading}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" variant="cta" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
              <p className="text-sm text-muted-foreground text-center">
                Don&apos;t have an account?{" "}
                {DESKTOP_MODE ? (
                  <a
                    href={`${BLIPOST_WEB_URL}/signup`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground underline underline-offset-4"
                  >
                    Sign up on blipost.com
                  </a>
                ) : (
                  <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
                    Sign up
                  </Link>
                )}
              </p>
            </CardFooter>
          </form>
        )}
      </Card>
      </div>
    </div>
  );
}
