import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceRoot = join(root, "src");
const violations = [];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  }));
  return nested.flat();
}

function report(file, message) {
  violations.push(`${relative(root, file).replaceAll("\\", "/")}: ${message}`);
}

const files = (await collectFiles(sourceRoot)).filter((file) =>
  [".css", ".ts", ".tsx"].includes(extname(file)),
);

// Native form controls render an OS-native popup (broken dark-mode contrast).
// They are forbidden in application UI — use the shadcn Select primitive. The
// only exceptions are purpose-built media/canvas overlay controls (§5).
const NATIVE_SELECT_ALLOWLIST = new Set([
  "src/components/timeline-editor.tsx",
  "src/components/video-segment-player.tsx",
]);

// Dense editor inspector panels share one grammar (see DESIGN_SYSTEM §
// "Inspector forms"): h-8 controls, flush divider-separated sections, no inner
// boxed/muted surfaces. Source of the shared primitives: components/ui/inspector.tsx.
const INSPECTOR_FILES = new Set([
  "src/components/render-settings-panel.tsx",
  "src/components/video-processing/subtitle-editor.tsx",
  "src/app/pipeline/components/step3-preview.tsx",
  "src/app/pipeline/components/subtitle-template-rotation-panel.tsx",
]);

// subtitle-editor is excluded here only for its separate subtitle-lines list,
// which legitimately uses a muted row surface outside the inspector grammar.
const INSPECTOR_NO_BOX_FILES = new Set([
  "src/components/render-settings-panel.tsx",
  "src/app/pipeline/components/step3-preview.tsx",
  "src/app/pipeline/components/subtitle-template-rotation-panel.tsx",
]);

for (const file of files) {
  const path = relative(root, file).replaceAll("\\", "/");
  const source = await readFile(file, "utf8");

  if (/<select[\s>]/.test(source) && !NATIVE_SELECT_ALLOWLIST.has(path)) {
    report(file, "native <select> is forbidden; use the shadcn Select primitive (components/ui/select)");
  }

  if (INSPECTOR_FILES.has(path)) {
    if (/(?<![\w-])h-7(?![\w-])/.test(source)) {
      report(file, "inspector controls use h-8 (Select size=sm), not h-7");
    }
    if (/<SelectTrigger[^>]*\bh-9\b/.test(source)) {
      report(file, "inspector SelectTrigger uses size=sm, not an explicit h-9");
    }
    if (/rounded-md border bg-surface-panel/.test(source)) {
      report(file, "inspector sections are flush; no rounded-md border bg-surface-panel boxes");
    }
  }

  if (INSPECTOR_NO_BOX_FILES.has(path) && /bg-muted\/(?:30|50)/.test(source)) {
    report(file, "inspector panels must not use bg-muted/30 or bg-muted/50 fills");
  }

  if (path !== "src/app/globals.css" && /#(?:181818|202020)\b/i.test(source)) {
    report(file, "canonical surface hex values must be consumed through semantic tokens");
  }

  if (
    path.startsWith("src/app/")
    && path.endsWith("/page.tsx")
    && path !== "src/app/attention-templates/page.tsx"
    && /(?:bg|border)-\[#[0-9a-f]{6,8}\]/i.test(source)
  ) {
    report(file, "arbitrary opaque UI surface color in a route; use a semantic token");
  }

  if (path.endsWith("/page.tsx") && source.includes("<PageHeader")) {
    const ownsCanonicalShell = source.includes("<PageShell") || source.includes("<GeneratorShell");
    if (!ownsCanonicalShell) {
      report(file, "PageHeader routes must use PageShell or GeneratorShell");
    }
  }

  if (
    path.endsWith("/page.tsx")
    && source.includes("<PageShell")
    && !source.includes("<PageHeader")
  ) {
    report(file, "document routes using PageShell must use PageHeader");
  }

  if (
    path.startsWith("src/app/pipeline/")
    && /<Card[\s\S]{0,320}min-\[1280px\]:(?:rounded-none|border-0|bg-background)/.test(source)
  ) {
    report(file, "workspace Card styling must use the shared Card workspace variant");
  }

  if (source.includes("reorderable={false}")) {
    report(file, "named workspace panels must keep header reordering enabled");
  }
}

for (const generator of ["src/app/create-image/page.tsx", "src/app/create-video/page.tsx"]) {
  const source = await readFile(join(root, generator), "utf8");
  if (!source.includes("<GeneratorShell")) {
    report(join(root, generator), "AI generator routes must use GeneratorShell");
  }
}

const globals = await readFile(join(root, "src/app/globals.css"), "utf8");
for (const contract of ["--surface-canvas: #181818", "--surface-panel: #202020"]) {
  if (!globals.includes(contract)) {
    report(join(root, "src/app/globals.css"), `missing surface contract: ${contract}`);
  }
}

const workspacePanelHeaderPath = join(root, "src/components/workspace-panel-header.tsx");
const workspacePanelHeader = await readFile(workspacePanelHeaderPath, "utf8");
for (const contract of [
  'data-slot="workspace-panel-header"',
  "relative z-[60] flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2",
  'data-slot="workspace-panel-grip"',
  'data-slot="workspace-panel-title"',
]) {
  if (!workspacePanelHeader.includes(contract)) {
    report(workspacePanelHeaderPath, `missing canonical workspace panel-header contract: ${contract}`);
  }
}

const workspacePanelEndcapPath = join(root, "src/components/workspace-panel-endcap.tsx");
const workspacePanelEndcap = await readFile(workspacePanelEndcapPath, "utf8");
if (!workspacePanelEndcap.includes('data-slot="workspace-panel-endcap"')) {
  report(workspacePanelEndcapPath, "missing canonical workspace panel-endcap slot");
}

for (const contract of [
  '[data-workspace-pane]::after',
  '[data-slot="workspace-panel-endcap"]',
  "height: 0.75rem",
  "border-top: 1px solid var(--border)",
  "background: var(--surface-panel)",
  "position: absolute",
  "bottom: 0",
]) {
  if (!globals.includes(contract)) {
    report(join(root, "src/app/globals.css"), `missing workspace panel-endcap contract: ${contract}`);
  }
}
if (globals.includes(':has(> [data-slot="workspace-panel-header"])::after')) {
  report(
    join(root, "src/app/globals.css"),
    "workspace panel endcaps must be explicit; header-based pseudo-elements create internal separators",
  );
}

for (const file of files) {
  const path = relative(root, file).replaceAll("\\", "/");
  if (path === "src/components/workspace-panel-header.tsx") continue;
  const source = await readFile(file, "utf8");
  if (/(?<!\[)data-slot="workspace-panel-header"/.test(source)) {
    report(file, "workspace pane headers must come from components/workspace-panel-header");
  }
}

if (violations.length > 0) {
  console.error("Design-system contract violations:\n");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("Design-system contract passed.");
}
