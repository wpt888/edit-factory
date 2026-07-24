const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  mergeBundledDesktopEnv,
  parseEnvText,
} = require("../src/desktop-env");

test("parseEnvText ignores comments and reads values", () => {
  assert.deepEqual(
    parseEnvText("# comment\nSUPABASE_URL=https://example.test\nEMPTY=\n"),
    {
      SUPABASE_URL: "https://example.test",
      EMPTY: "",
    },
  );
});

test("merge adds missing public URL without overwriting existing config", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blipost-env-"));
  const target = path.join(directory, ".env");
  const source = path.join(directory, "credentials.env");

  fs.writeFileSync(
    target,
    "SUPABASE_URL=https://custom.test\nSUPABASE_KEY=custom-anon\n",
  );
  fs.writeFileSync(
    source,
    [
      "SUPABASE_URL=https://bundled.test",
      "SUPABASE_KEY=bundled-anon",
      "MINIO_PUBLIC_URL=https://media.test/s3/buffer-videos",
      "SUPABASE_SERVICE_ROLE_KEY=must-not-be-copied",
      "",
    ].join("\n"),
  );

  const updated = mergeBundledDesktopEnv(target, source);
  const result = fs.readFileSync(target, "utf-8");

  assert.deepEqual(updated, ["MINIO_PUBLIC_URL"]);
  assert.match(result, /SUPABASE_URL=https:\/\/custom\.test/);
  assert.match(result, /SUPABASE_KEY=custom-anon/);
  assert.match(
    result,
    /MINIO_PUBLIC_URL=https:\/\/media\.test\/s3\/buffer-videos/,
  );
  assert.doesNotMatch(result, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("merge fills an empty safe key and remains idempotent", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blipost-env-"));
  const target = path.join(directory, ".env");
  const source = path.join(directory, "credentials.env");

  fs.writeFileSync(
    target,
    "SUPABASE_URL=https://example.test\nSUPABASE_KEY=anon\nMINIO_PUBLIC_URL=\n",
  );
  fs.writeFileSync(
    source,
    "MINIO_PUBLIC_URL=https://media.test/s3/buffer-videos\n",
  );

  assert.deepEqual(mergeBundledDesktopEnv(target, source), [
    "MINIO_PUBLIC_URL",
  ]);
  assert.deepEqual(mergeBundledDesktopEnv(target, source), []);
});
