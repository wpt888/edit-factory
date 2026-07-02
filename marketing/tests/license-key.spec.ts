import { test, expect } from "@playwright/test";
import { generateLicenseKey } from "../lib/license-key";

// Pure-function tests — no webServer / no env-var deps. Runs unconditionally.
test.describe("Phase 91-02: license-key generator (D-09 / D-23)", () => {
  test("Test 1: generates a key matching /^EF13(-[0-9A-F]{4}){4}$/ across 100 invocations", () => {
    const KEY_REGEX = /^EF13(-[0-9A-F]{4}){4}$/;
    for (let i = 0; i < 100; i++) {
      const key = generateLicenseKey();
      expect(key, `iteration ${i}: ${key} must match EF13-XXXX-XXXX-XXXX-XXXX`).toMatch(KEY_REGEX);
    }
  });

  test("Test 2: 100 consecutive generations produce 100 distinct keys (no duplicates)", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      keys.add(generateLicenseKey());
    }
    expect(keys.size, "100 generated keys must be distinct").toBe(100);
  });

  test("Test 3: every generated key is exactly 24 characters", () => {
    for (let i = 0; i < 20; i++) {
      const key = generateLicenseKey();
      expect(key.length, `${key} must be 24 chars (4 EF13 + 4 dashes + 16 hex)`).toBe(24);
    }
  });
});
