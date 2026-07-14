"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export default function Home() {
  useEffect(() => {
    // The desktop shell initially loads `/` while AuthProvider restores the
    // Supabase session. Throwing Next's server-side redirect at the same time
    // as that client state transition can leave the App Router rendering with
    // a different hook sequence (React error #310). A hard replacement keeps
    // the root route deterministic and also prevents `/` from remaining in
    // the browser history.
    window.location.replace("/pipeline");
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
