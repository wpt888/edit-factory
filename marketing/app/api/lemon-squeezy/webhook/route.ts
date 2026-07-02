import { createHmac, timingSafeEqual } from "node:crypto";
import { getMarketingSupabaseServiceClient } from "@/lib/supabase-service";
import { generateLicenseKey } from "@/lib/license-key";
import { sendLicenseEmail } from "@/lib/email";
import { variantIdToTier } from "@/lib/lemon-squeezy";

/**
 * Lemon Squeezy webhook handler.
 *
 * Phase 91 — MARK-04.
 *
 * Routes accepted (D-domain line 36):
 *   - order_created (Starter + Pro one-time purchases)
 *   - subscription_created (Cloud Sync recurring subscription)
 * Other event types (subscription_updated, subscription_payment_success, etc.)
 * acknowledge with 200 + 'event_type_ignored_in_phase_91' so Lemon Squeezy does
 * NOT retry — they are deferred to v13.x.
 *
 * Security:
 *   - D-06: signature verification via node:crypto.timingSafeEqual (timing-attack safe)
 *   - D-07: fail-closed when LEMON_SQUEEZY_WEBHOOK_SECRET is unset (returns 500, never 200)
 *   - D-08: idempotency via X-Event-Id header → orders.lemon_squeezy_event_id UNIQUE constraint
 *   - D-10: license-key collision retry up to 3 times (catches PG 23505 unique violation)
 *   - T-91-06: Resend send-error caught + logged + handler returns 200 (order is persisted)
 */
export async function POST(request: Request): Promise<Response> {
  // D-07 — fail-closed on missing secret. NEVER return 200 here; attacker-controlled
  // unsigned payloads MUST be rejected even when the operator forgot to set the secret.
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "webhook_secret_not_configured" }, { status: 500 });
  }

  // Read RAW body BEFORE JSON.parse — HMAC is computed over the raw bytes (D-06).
  const rawBody = await request.text();
  const signatureHex = request.headers.get("x-signature") ?? "";
  const eventId = request.headers.get("x-event-id") ?? "";

  if (!eventId) {
    return Response.json({ error: "missing_event_id" }, { status: 400 });
  }
  if (!signatureHex) {
    return Response.json({ error: "missing_signature" }, { status: 401 });
  }

  // D-06 — timing-safe HMAC comparison.
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signatureHex, "hex");
  } catch {
    return Response.json({ error: "invalid_signature_format" }, { status: 401 });
  }
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  // Signature verified — safe to JSON.parse.
  let payload: {
    meta?: { event_name?: string };
    data?: {
      id?: string;
      attributes?: {
        customer_id?: number | string;
        user_email?: string;
        first_order_item?: { variant_id?: number | string };
        variant_id?: number | string;
        total?: number;
        tax?: number;
      };
    };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const eventType = payload?.meta?.event_name;
  if (eventType !== "order_created" && eventType !== "subscription_created") {
    // 200 — Lemon Squeezy must not retry for events we deliberately ignore.
    return Response.json({ acknowledged: true, note: "event_type_ignored_in_phase_91" }, { status: 200 });
  }

  // Variant ID extraction — `order_created` has it under first_order_item; `subscription_created` has it at top level.
  const rawVariantId =
    payload?.data?.attributes?.first_order_item?.variant_id ?? payload?.data?.attributes?.variant_id;
  if (rawVariantId === undefined || rawVariantId === null) {
    return Response.json({ error: "missing_variant_id" }, { status: 400 });
  }
  const variantId = String(rawVariantId);

  let tier: ReturnType<typeof variantIdToTier>;
  try {
    tier = variantIdToTier(variantId);
  } catch (err) {
    // variantIdToTier throws if any LEMON_SQUEEZY_*_VARIANT_ID server env var is unset.
    // This is a configuration failure (M-prerequisite M2 not done) — surface as 500.
    console.error("[webhook] variantIdToTier configuration error:", err);
    return Response.json({ error: "variant_lookup_misconfigured" }, { status: 500 });
  }
  if (!tier) {
    // Unknown variant (e.g., operator created a 4th product not in our 3-tier scope).
    // 200 — LS must not retry.
    return Response.json({ acknowledged: true, note: "unknown_variant", variantId }, { status: 200 });
  }

  const buyerEmail = payload?.data?.attributes?.user_email;
  const customerId = String(payload?.data?.attributes?.customer_id ?? "");
  const orderId = String(payload?.data?.id ?? "");
  const totalCents = Number(payload?.data?.attributes?.total ?? 0);
  const taxCents = Number(payload?.data?.attributes?.tax ?? 0);
  if (!buyerEmail || !orderId) {
    return Response.json({ error: "incomplete_payload" }, { status: 400 });
  }

  const supabase = getMarketingSupabaseServiceClient();

  // D-10 license-key collision retry: up to 3 attempts.
  let inserted: { id: string; license_key: string } | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const licenseKey = generateLicenseKey();
    // D-08 idempotency — try INSERT and rely on UNIQUE constraints:
    //   - lemon_squeezy_event_id UNIQUE → duplicate webhook returns no row + we treat as success
    //   - license_key UNIQUE → astronomical collision → retry with new key
    const { data, error } = await supabase
      .from("orders")
      .insert({
        lemon_squeezy_event_id: eventId,
        lemon_squeezy_order_id: orderId,
        lemon_squeezy_customer_id: customerId,
        lemon_squeezy_variant_id: variantId,
        buyer_email: buyerEmail,
        subscription_tier: tier,
        license_key: licenseKey,
        total_usd_cents: totalCents,
        tax_usd_cents: taxCents,
        event_type: eventType,
        raw_payload: payload,
      })
      .select("id, license_key")
      .single();

    if (!error) {
      inserted = { id: data.id, license_key: data.license_key };
      break;
    }

    // Distinguish event-id duplicate (idempotency hit — return 200 without retry) from license-key duplicate (retry).
    // PostgREST returns code '23505' (unique_violation) with details indicating the constraint name.
    const pgCode = (error as { code?: string }).code;
    const details = (error as { details?: string }).details ?? "";
    if (pgCode === "23505") {
      if (details.includes("lemon_squeezy_event_id")) {
        // D-08 — replay of an already-processed webhook. Return 200 WITHOUT re-sending email.
        console.log("[webhook] idempotency hit on event_id", eventId);
        return Response.json({ acknowledged: true, note: "duplicate_event_id" }, { status: 200 });
      }
      if (details.includes("license_key")) {
        // Astronomical collision — retry with a new generated key (D-10).
        lastError = error;
        continue;
      }
    }
    // Any other DB error — abort.
    lastError = error;
    break;
  }

  if (!inserted) {
    console.error("[webhook] INSERT failed after retries:", lastError);
    return Response.json({ error: "db_insert_failed" }, { status: 500 });
  }

  // Email send — conditional on the INSERT having written a NEW row (D-08 semantics).
  // T-91-06 — Resend failure does NOT fail the webhook; operator handles re-sends.
  try {
    await sendLicenseEmail({
      to: buyerEmail,
      licenseKey: inserted.license_key,
      tier,
    });
    console.log("[webhook] license_email_sent", { to: buyerEmail, license_key: inserted.license_key });
  } catch (err) {
    // Order row is persisted; manual re-send via Resend dashboard.
    console.error("[webhook] resend_error (order row persisted, manual re-send required):", err);
  }

  return Response.json(
    {
      acknowledged: true,
      order_id: inserted.id,
      license_key: inserted.license_key,
      tier,
      event_type: eventType,
    },
    { status: 200 }
  );
}
