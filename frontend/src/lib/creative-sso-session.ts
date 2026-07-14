import type { Session, User } from "@supabase/supabase-js";

export const CREATIVE_SSO_SESSION_KEY = "blipstudio:creative-sso";

function creativeBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_BLIPCREATIVE_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  }

  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  ) {
    return "http://localhost:3000";
  }

  return "https://blipost.com";
}

export function creativeLoginUrl() {
  const url = new URL("/login", `${creativeBaseUrl()}/`);
  url.searchParams.set("callbackUrl", "/studio");
  return url.toString();
}

export function markCreativeSsoSession() {
  window.localStorage.setItem(CREATIVE_SSO_SESSION_KEY, "1");
}

export function clearCreativeSsoSession() {
  window.localStorage.removeItem(CREATIVE_SSO_SESSION_KEY);
}

export function hasCreativeSsoSession() {
  return window.localStorage.getItem(CREATIVE_SSO_SESSION_KEY) === "1";
}

function sessionUsesOtp(accessToken: string) {
  try {
    const segment = accessToken
      .split(".")[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = segment.padEnd(Math.ceil(segment.length / 4) * 4, "=");
    const payload = JSON.parse(window.atob(padded)) as {
      amr?: Array<string | { method?: unknown }>;
    };
    return (
      payload.amr?.some((entry) =>
        typeof entry === "string" ? entry === "otp" : entry.method === "otp",
      ) === true
    );
  } catch {
    return false;
  }
}

/** The JWT method keeps the binding enforceable if localStorage is tampered with. */
export function isCreativeBoundSession(session: Session) {
  return hasCreativeSsoSession() || sessionUsesOtp(session.access_token);
}

type CreativeSessionResponse = {
  authenticated?: unknown;
  email?: unknown;
};

/**
 * Checks the originating Creative cookie. Network/configuration failures are
 * intentionally treated as invalid: an SSO-bound Studio session fails closed.
 */
export async function isCreativeSessionActive(
  studioUser: User,
  fetcher: typeof fetch = fetch,
) {
  try {
    const response = await fetcher(`${creativeBaseUrl()}/api/studio/session`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return false;

    const body = (await response.json()) as CreativeSessionResponse;
    const creativeEmail =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    return (
      body.authenticated === true &&
      Boolean(studioUser.email) &&
      studioUser.email?.trim().toLowerCase() === creativeEmail
    );
  } catch {
    return false;
  }
}
