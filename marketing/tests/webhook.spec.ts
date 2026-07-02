import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// D-17: All tests that touch Supabase or HMAC verification skip when env vars
// are absent (autonomous CI without M-prerequisites must not fail the build).
// D-21: Use Playwright's built-in { request } fixture for HTTP-driven tests.
// D-22: Do NOT make real Resend API calls in CI — the route handler catches
// Resend errors and returns 200 anyway (T-91-06 mitigation). Tests set
// RESEND_API_KEY to a known-invalid value and assert the resilience path.

const WEBHOOK_PATH = "/api/lemon-squeezy/webhook";

function buildMockPayload(args: {
  eventName: "order_created" | "subscription_created";
  variantId: string;
  email: string;
  orderId: string;
}) {
  return {
    meta: { event_name: args.eventName, custom_data: {} },
    data: {
      type: args.eventName === "order_created" ? "orders" : "subscriptions",
      id: args.orderId,
      attributes: {
        store_id: 99999,
        customer_id: 77777,
        user_email: args.email,
        first_order_item: { variant_id: Number(args.variantId), product_id: 22222 },
        variant_id: Number(args.variantId), // also at top level for subscription_created shape
        total: 7900,
        tax: 0,
        currency: "USD",
      },
    },
  };
}

function signBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

test.describe("Phase 91-02: Lemon Squeezy webhook handler (MARK-04)", () => {
  test.beforeAll(() => {
    test.skip(
      !process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,
      "M-prerequisite M2: LEMON_SQUEEZY_WEBHOOK_SECRET not set. See 91-CONTEXT.md M2."
    );
    test.skip(
      !process.env.MARKETING_SUPABASE_URL,
      "M-prerequisite M1: MARKETING_SUPABASE_URL not set. See 91-CONTEXT.md M1."
    );
    test.skip(
      !process.env.MARKETING_SUPABASE_KEY,
      "M-prerequisite M1: MARKETING_SUPABASE_KEY not set. See 91-CONTEXT.md M1."
    );
    test.skip(
      !process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID,
      "M-prerequisite M2: LEMON_SQUEEZY_STARTER_VARIANT_ID not set. See 91-CONTEXT.md M2."
    );
  });

  test("Test 1: valid HMAC + new X-Event-Id → 200 + order persisted + proof artifact written", async ({ request }) => {
    const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET!;
    const variantId = process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID!;
    const eventId = `phase-91-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = buildMockPayload({
      eventName: "order_created",
      variantId,
      email: `test-${Date.now()}@example.com`,
      orderId: `test-${Date.now()}`,
    });
    const rawBody = JSON.stringify(payload);
    const signature = signBody(rawBody, secret);

    const res = await request.post(WEBHOOK_PATH, {
      headers: {
        "X-Signature": signature,
        "X-Event-Id": eventId,
        "Content-Type": "application/json",
      },
      data: rawBody,
    });

    expect(res.status(), `expected 200, got ${res.status()}: ${await res.text()}`).toBe(200);
    const body = await res.json();
    expect(body.acknowledged).toBe(true);
    expect(body.license_key).toMatch(/^EF13(-[0-9A-F]{4}){4}$/);
    expect(body.tier).toBe("starter");
    expect(body.event_type).toBe("order_created");
    expect(body.order_id).toBeTruthy();

    // Write proof-of-execution artifact per CLAUDE.md gap-closure prevention.
    // Path matches the .gitignore exception added in Plan 91-01 Task 2.
    const artifactPath = path.resolve(process.cwd(), "screenshots/phase-91-webhook-success.json");
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(
      artifactPath,
      JSON.stringify(
        {
          phase: "91-02",
          test: "Test 1: valid HMAC + new X-Event-Id → 200",
          timestamp: new Date().toISOString(),
          response: body,
          requestHeaders: { "X-Event-Id": eventId, "X-Signature": signature.slice(0, 16) + "..." },
        },
        null,
        2
      )
    );
    expect(fs.existsSync(artifactPath)).toBe(true);
    expect(fs.statSync(artifactPath).size).toBeGreaterThan(100);
  });

  test("Test 2: duplicate X-Event-Id → 200 + 'duplicate_event_id' (D-08 idempotency)", async ({ request }) => {
    const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET!;
    const variantId = process.env.LEMON_SQUEEZY_PRO_VARIANT_ID!;
    const eventId = `phase-91-idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = buildMockPayload({
      eventName: "order_created",
      variantId,
      email: `idem-${Date.now()}@example.com`,
      orderId: `idem-${Date.now()}`,
    });
    const rawBody = JSON.stringify(payload);
    const signature = signBody(rawBody, secret);
    const headers = { "X-Signature": signature, "X-Event-Id": eventId, "Content-Type": "application/json" };

    // First call: inserts.
    const res1 = await request.post(WEBHOOK_PATH, { headers, data: rawBody });
    expect(res1.status()).toBe(200);
    const body1 = await res1.json();
    expect(body1.acknowledged).toBe(true);

    // Second call with SAME event_id: should hit idempotency.
    const res2 = await request.post(WEBHOOK_PATH, { headers, data: rawBody });
    expect(res2.status()).toBe(200);
    const body2 = await res2.json();
    expect(body2.note).toBe("duplicate_event_id");
  });

  test("Test 3: invalid HMAC → 401 'invalid_signature' (D-06)", async ({ request }) => {
    const payload = buildMockPayload({ eventName: "order_created", variantId: "99999", email: "x@example.com", orderId: "x" });
    const rawBody = JSON.stringify(payload);
    const wrongSignature = signBody(rawBody, "wrong-secret-XYZ");

    const res = await request.post(WEBHOOK_PATH, {
      headers: {
        "X-Signature": wrongSignature,
        "X-Event-Id": `wrong-sig-${Date.now()}`,
        "Content-Type": "application/json",
      },
      data: rawBody,
    });

    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_signature");
  });

  test("Test 4: missing X-Signature header → 401 'missing_signature'", async ({ request }) => {
    const res = await request.post(WEBHOOK_PATH, {
      headers: { "X-Event-Id": `no-sig-${Date.now()}`, "Content-Type": "application/json" },
      data: "{}",
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("missing_signature");
  });

  test("Test 5: missing X-Event-Id header → 400 'missing_event_id'", async ({ request }) => {
    const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET!;
    const rawBody = "{}";
    const res = await request.post(WEBHOOK_PATH, {
      headers: { "X-Signature": signBody(rawBody, secret), "Content-Type": "application/json" },
      data: rawBody,
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("missing_event_id");
  });

  test("Test 6: unknown event_name → 200 + 'event_type_ignored_in_phase_91' (no retry)", async ({ request }) => {
    const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET!;
    const payload = { meta: { event_name: "subscription_payment_success" }, data: { id: "x", attributes: {} } };
    const rawBody = JSON.stringify(payload);
    const res = await request.post(WEBHOOK_PATH, {
      headers: {
        "X-Signature": signBody(rawBody, secret),
        "X-Event-Id": `ignored-${Date.now()}`,
        "Content-Type": "application/json",
      },
      data: rawBody,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.note).toBe("event_type_ignored_in_phase_91");
  });

  test("Test 7: unknown variant_id → 200 + 'unknown_variant' (no retry)", async ({ request }) => {
    const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET!;
    const payload = buildMockPayload({
      eventName: "order_created",
      variantId: "0000000", // 7-digit ID that does not match any of the 3 configured variants
      email: "unknown@example.com",
      orderId: `unknown-${Date.now()}`,
    });
    const rawBody = JSON.stringify(payload);
    const res = await request.post(WEBHOOK_PATH, {
      headers: {
        "X-Signature": signBody(rawBody, secret),
        "X-Event-Id": `unknown-variant-${Date.now()}`,
        "Content-Type": "application/json",
      },
      data: rawBody,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.note).toBe("unknown_variant");
  });

  test("Test 8: subscription_created event (Cloud Sync tier) → 200 + correct tier", async ({ request }) => {
    const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET!;
    const variantId = process.env.LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID!;
    test.skip(!variantId, "LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID not set");
    const payload = buildMockPayload({
      eventName: "subscription_created",
      variantId,
      email: `sub-${Date.now()}@example.com`,
      orderId: `sub-${Date.now()}`,
    });
    const rawBody = JSON.stringify(payload);
    const res = await request.post(WEBHOOK_PATH, {
      headers: {
        "X-Signature": signBody(rawBody, secret),
        "X-Event-Id": `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        "Content-Type": "application/json",
      },
      data: rawBody,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe("cloud_sync"); // D-19 underscore
    expect(body.event_type).toBe("subscription_created");
  });
});

// Separate describe — runs without LEMON_SQUEEZY_WEBHOOK_SECRET to verify D-07 fail-closed.
// This is the ONLY test that explicitly runs with the secret UNSET.
test.describe("Phase 91-02 (fail-closed branch): webhook secret missing → 500 (D-07)", () => {
  test("Test 9: env-absent LEMON_SQUEEZY_WEBHOOK_SECRET → 500 'webhook_secret_not_configured'", async ({ request }) => {
    test.skip(
      !!process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,
      "This test runs in env-ABSENT mode only. Invoke via `npm run test:webhook:no-secret` (with the secret env var explicitly unset)."
    );
    const res = await request.post(WEBHOOK_PATH, {
      headers: { "X-Signature": "00", "X-Event-Id": "x", "Content-Type": "application/json" },
      data: "{}",
    });
    expect(res.status()).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("webhook_secret_not_configured");
  });
});
