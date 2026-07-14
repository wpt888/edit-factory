import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error Node's strip-types runner requires an explicit TypeScript extension.
import { completeStudioAuth } from "../src/lib/studio-auth.ts";
import type { StudioAuthClient } from "../src/lib/studio-auth.ts";

function client(calls: string[], error: unknown = null): StudioAuthClient {
  return {
    auth: {
      async exchangeCodeForSession(code) {
        calls.push(`code:${code}`);
        return { error };
      },
      async verifyOtp(params) {
        calls.push(`otp:${params.type}:${params.token_hash}`);
        return { error };
      },
    },
  };
}

{
  const calls: string[] = [];
  const result = await completeStudioAuth(client(calls), {
    code: "pkce-code",
    tokenHash: "ignored-token-hash",
    verificationType: "magiclink",
  });
  assert.deepEqual(result, { handled: true, error: null });
  assert.deepEqual(calls, ["code:pkce-code"], "PKCE must retain precedence");
}

{
  const calls: string[] = [];
  const result = await completeStudioAuth(client(calls), {
    code: null,
    tokenHash: "single-use-token-hash",
    verificationType: "magiclink",
  });
  assert.deepEqual(result, { handled: true, error: null });
  assert.deepEqual(calls, ["otp:magiclink:single-use-token-hash"]);
}

{
  const calls: string[] = [];
  const result = await completeStudioAuth(client(calls), {
    code: null,
    tokenHash: "untrusted-token",
    verificationType: "recovery",
  });
  assert.deepEqual(result, { handled: false, error: null });
  assert.deepEqual(calls, [], "unsupported token types must not be consumed");
}

const callbackRoute = new URL(
  "../src/app/auth/callback/route.ts",
  import.meta.url,
);
const callbackClient = readFileSync(
  new URL("../src/app/auth/callback/auth-callback-client.tsx", import.meta.url),
  "utf8",
);
const titlebar = readFileSync(
  new URL("../src/components/desktop-titlebar.tsx", import.meta.url),
  "utf8",
);
const callbackSource = callbackClient;
const authProvider = readFileSync(
  new URL("../src/components/auth-provider.tsx", import.meta.url),
  "utf8",
);
const creativeBinding = readFileSync(
  new URL("../src/lib/creative-sso-session.ts", import.meta.url),
  "utf8",
);
assert.equal(
  existsSync(callbackRoute),
  false,
  "Studio auth must not be consumed by a server route",
);
assert.match(
  callbackClient,
  /@\/lib\/supabase\/client/,
  "the callback must use the browser Supabase client so Electron persists localStorage",
);
assert.match(
  callbackClient,
  /window\.location\.replace/,
  "the callback must reload protected UI from the persisted browser session",
);
assert.match(
  titlebar,
  /window\.editFactory\?\.isDesktop/,
  "native titlebar controls must be gated by the runtime Electron bridge",
);
assert.match(
  callbackSource,
  /markCreativeSsoSession\(\)/,
  "Creative magic-link callbacks must mark Studio sessions as SSO-bound",
);
assert.match(
  creativeBinding,
  /credentials:\s*"include"/,
  "the Creative session check must send the originating Auth.js cookie",
);
assert.match(
  creativeBinding,
  /body\.authenticated === true/,
  "the binding must require an authenticated Creative response",
);
assert.match(
  creativeBinding,
  /entry\.method === "otp"/,
  "the OTP claim must preserve the SSO binding even if localStorage is changed",
);
assert.match(
  authProvider,
  /supabase\.auth\.signOut\(\{ scope: "local" \}\)/,
  "an invalid Creative session must remove the local Studio session",
);
assert.match(
  authProvider,
  /window\.addEventListener\("focus", verifyCreativeSession\)/,
  "Studio must re-check Creative after the user returns from another tab",
);
assert.match(
  authProvider,
  /setInterval\(verifyCreativeSession, 30_000\)/,
  "an open Studio tab must periodically re-check the Creative session",
);
assert.match(
  authProvider,
  /window\.location\.replace\(creativeLoginUrl\(\)\)/,
  "an expired SSO binding must return to the single Creative login",
);

console.log("Studio auth callback verification passed.");
