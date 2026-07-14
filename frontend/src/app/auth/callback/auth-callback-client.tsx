"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { completeStudioAuth } from "@/lib/studio-auth";
import {
  clearCreativeSsoSession,
  markCreativeSsoSession,
} from "@/lib/creative-sso-session";

function safeNextPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//")
    ? value
    : "/librarie";
}

function creativeReturnUrl() {
  const configured = process.env.NEXT_PUBLIC_BLIPCREATIVE_URL;
  if (configured) return configured.replace(/\/dashboard\/?$/, "/studio");
  return window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000/studio"
    : "https://blipost.com/studio";
}

export function AuthCallbackClient() {
  const searchParams = useSearchParams();
  const startedRef = useRef(false);
  const [error, setError] = useState(false);
  const fromCreative = searchParams.get("source") === "blipcreative";

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const complete = async () => {
      const supabase = createClient();
      const completion = await completeStudioAuth(supabase, {
        code: searchParams.get("code"),
        tokenHash: searchParams.get("token_hash"),
        verificationType: searchParams.get("type"),
      });

      if (!completion.handled || completion.error) {
        console.error(
          "Studio authentication callback failed",
          completion.error,
        );
        setError(true);
        return;
      }

      if (fromCreative) markCreativeSsoSession();
      else clearCreativeSsoSession();

      // A full navigation proves the browser client persisted the session in
      // its configured storage and removes the single-use token from history.
      window.location.replace(safeNextPath(searchParams.get("next")));
    };

    void complete().catch((callbackError) => {
      console.error("Studio authentication callback failed", callbackError);
      setError(true);
    });
  }, [fromCreative, searchParams]);

  if (error) {
    const href = fromCreative ? creativeReturnUrl() : "/login";
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <section className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
          <AlertCircle className="mx-auto size-9 text-destructive" />
          <h1 className="mt-4 font-heading text-2xl font-bold">
            Could not connect BlipStudio
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {fromCreative
              ? "Your BlipCreative session is still active. Return there and try opening BlipStudio again."
              : "The authentication link is invalid or expired. Please try again."}
          </p>
          <a
            href={href}
            className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-lime px-5 text-sm font-semibold text-black"
          >
            {fromCreative ? "Return to BlipCreative" : "Return to login"}
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-lime" />
        <p className="mt-3 text-sm text-muted-foreground">
          Connecting your BlipStudio session…
        </p>
      </div>
    </main>
  );
}
