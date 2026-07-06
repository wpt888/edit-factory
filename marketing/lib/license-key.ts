import { randomBytes } from "node:crypto";

/**
 * Generate a Blipost v13 license key in the format EF13-XXXX-XXXX-XXXX-XXXX.
 *
 * Phase 91 — D-09 / D-23.
 *
 * Format derivation:
 *   - randomBytes(8) → 8 random bytes → 16 hex chars
 *   - .toString('hex') → 16 lowercase hex chars
 *   - .toUpperCase() → 16 uppercase hex chars (no ambiguity between 0/O, 1/I/l — hex excludes both)
 *   - .match(/.{4}/g) → 4 groups of 4 chars
 *   - .join('-') → XXXX-XXXX-XXXX-XXXX (19 chars)
 *   - prepend 'EF13-' → EF13-XXXX-XXXX-XXXX-XXXX (24 chars, 5 groups, 64 bits of entropy)
 *
 * The 'EF13' prefix lets operators recognize the cohort at a glance.
 * 64 bits of entropy means collision is astronomical (~1 in 2^64) — the DB
 * UNIQUE constraint on license_key (D-10) is the belt-and-suspenders catch.
 *
 * Acceptance regex (D-23): /^EF13(-[0-9A-F]{4}){4}$/
 */
export function generateLicenseKey(): string {
  const hex = randomBytes(8).toString("hex").toUpperCase();
  const groups = hex.match(/.{4}/g);
  if (!groups || groups.length !== 4) {
    // Defensive: randomBytes(8).toString('hex') always returns 16 chars, but TypeScript needs the guard.
    throw new Error("license-key generator: unexpected hex length (this should be unreachable)");
  }
  return `EF13-${groups.join("-")}`;
}
