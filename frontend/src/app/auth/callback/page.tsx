import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AuthCallbackClient } from "./auth-callback-client";

function CallbackLoading() {
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

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackLoading />}>
      <AuthCallbackClient />
    </Suspense>
  );
}
