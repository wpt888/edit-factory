const fs = require("fs");
const path = require("path");

const SAFE_DESKTOP_ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "MINIO_PUBLIC_URL",
];

function parseEnvText(text) {
  const values = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim();
  }
  return values;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return parseEnvText(fs.readFileSync(filePath, "utf-8"));
}

function mergeBundledDesktopEnv(targetPath, sourcePath) {
  if (!fs.existsSync(sourcePath)) return [];

  const sourceValues = readEnvFile(sourcePath);
  const allowedValues = Object.fromEntries(
    SAFE_DESKTOP_ENV_KEYS.filter((key) => sourceValues[key]).map((key) => [
      key,
      sourceValues[key],
    ]),
  );
  const keys = Object.keys(allowedValues);
  if (keys.length === 0) return [];

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (!fs.existsSync(targetPath)) {
    const body =
      "# Blipost desktop cloud configuration.\n" +
      keys.map((key) => `${key}=${allowedValues[key]}`).join("\n") +
      "\n";
    fs.writeFileSync(targetPath, body, "utf-8");
    return keys;
  }

  let text = fs.readFileSync(targetPath, "utf-8");
  const existing = parseEnvText(text);
  const updated = [];

  for (const key of keys) {
    if (existing[key]) continue;
    const line = `${key}=${allowedValues[key]}`;
    const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
    if (pattern.test(text)) {
      text = text.replace(pattern, line);
    } else {
      if (text && !text.endsWith("\n")) text += "\n";
      text += `${line}\n`;
    }
    updated.push(key);
  }

  if (updated.length > 0) {
    fs.writeFileSync(targetPath, text, "utf-8");
  }
  return updated;
}

module.exports = {
  SAFE_DESKTOP_ENV_KEYS,
  mergeBundledDesktopEnv,
  parseEnvText,
  readEnvFile,
};
