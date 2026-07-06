import { Resend } from "resend";
import type { LemonSqueezyTier } from "./lemon-squeezy";

/**
 * Send the Blipost license-key confirmation email via Resend.
 *
 * Phase 91 — D-12 (Resend over alternatives), D-13 (sole new npm dep),
 * D-14 (subject + body LOCKED verbatim).
 *
 * Throws specific named errors when RESEND_API_KEY or RESEND_FROM_EMAIL is unset
 * (per Pattern S1 env-var-throws — provisioned via M-prerequisite M3).
 *
 * The webhook handler at marketing/app/api/lemon-squeezy/webhook/route.ts catches
 * Resend SDK errors and returns 200 anyway per T-91-06 mitigation — the order row
 * is already persisted; operator handles re-sends manually via Resend dashboard.
 */

const TIER_DISPLAY_NAMES: Record<LemonSqueezyTier, string> = {
  starter: "Starter",
  pro: "Pro",
  cloud_sync: "Cloud Sync",
};

export async function sendLicenseEmail(args: {
  to: string;
  licenseKey: string;
  tier: LemonSqueezyTier;
}): Promise<{ data?: unknown; error?: unknown }> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set. " +
        "Provision a Resend account per M-prerequisite M3 in 91-CONTEXT.md " +
        "and add the API key to marketing/.env.local."
    );
  }
  if (!fromEmail) {
    throw new Error(
      "RESEND_FROM_EMAIL is not set. " +
        "Add the verified sender address from your Resend dashboard to marketing/.env.local. " +
        "For testing without a verified domain, use onboarding@resend.dev (see M3)."
    );
  }

  const repo = process.env.NEXT_PUBLIC_GITHUB_REPO ?? "obsidsrl/edit-factory";
  const tierDisplayName = TIER_DISPLAY_NAMES[args.tier];

  // Subject LOCKED verbatim per D-14.
  const subject = "Your Blipost license key";

  // Body LOCKED verbatim per D-14. Plain-text version:
  const text = `Thanks for buying Blipost!

Your license key:    ${args.licenseKey}
Your tier:           ${tierDisplayName}

Download Blipost:
  Windows:  https://github.com/${repo}/releases/latest/download/blipost-setup.exe
  macOS:    https://github.com/${repo}/releases/latest/download/Blipost.dmg

Activate by entering your license key in the desktop app on first launch.

Refund policy: 30-day no-questions refund. Reply to this email.

Thanks,
The Blipost team`;

  // HTML version: same content, <br> separators, <pre> wrap around the license key per D-14.
  const html = `<p>Thanks for buying Blipost!</p>
<p>Your license key:    <pre>${args.licenseKey}</pre><br />
Your tier:           ${tierDisplayName}</p>
<p>Download Blipost:<br />
&nbsp;&nbsp;Windows:  <a href="https://github.com/${repo}/releases/latest/download/blipost-setup.exe">blipost-setup.exe</a><br />
&nbsp;&nbsp;macOS:    <a href="https://github.com/${repo}/releases/latest/download/Blipost.dmg">Blipost.dmg</a></p>
<p>Activate by entering your license key in the desktop app on first launch.</p>
<p>Refund policy: 30-day no-questions refund. Reply to this email.</p>
<p>Thanks,<br />The Blipost team</p>`;

  const resend = new Resend(apiKey);
  return await resend.emails.send({
    from: fromEmail,
    to: args.to,
    subject,
    text,
    html,
  });
}
