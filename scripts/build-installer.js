#!/usr/bin/env node
'use strict';

/**
 * build-installer.js
 *
 * Orchestrates the full Edit Factory Windows installer build:
 *   Step 1: Build Next.js frontend standalone
 *   Step 2: Download and extract portable Node.js 22 LTS
 *   Step 3: Run electron-builder to produce the NSIS installer
 *
 * Usage: node scripts/build-installer.js
 * Requirements: Windows (or WSL with PowerShell available), Node.js 18+
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Resolve project root (one level above scripts/)
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Portable Node.js 22 LTS config
const NODE_VERSION = '22.22.0';
const NODE_DIRNAME = `node-v${NODE_VERSION}-win-x64`; // e.g. node-v22.22.0-win-x64
const NODE_ZIP_NAME = `${NODE_DIRNAME}.zip`;
const NODE_ZIP_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP_NAME}`;
const NODE_INNER_DIR = NODE_DIRNAME;

// Paths (all absolute)
const ELECTRON_DIR = path.join(PROJECT_ROOT, 'electron');
const FRONTEND_DIR = path.join(PROJECT_ROOT, 'frontend');
const RESOURCES_DIR = path.join(ELECTRON_DIR, 'resources');
const NODE_ZIP = path.join(RESOURCES_DIR, NODE_ZIP_NAME);
const NODE_DEST = path.join(RESOURCES_DIR, 'node');
const NODE_EXE = path.join(NODE_DEST, 'node.exe');

// Prerequisites verification paths
const STANDALONE_SERVER = path.join(FRONTEND_DIR, '.next', 'standalone', 'server.js');
const VENV_PYTHON = path.join(PROJECT_ROOT, 'venv', 'Scripts', 'python.exe');

// ──────────────────────────────────────────────
// Step 1: Build Next.js frontend standalone
// ──────────────────────────────────────────────
function stepBuildFrontend() {
  console.log('\n[build] Step 1: Building frontend (Next.js standalone)...');
  try {
    execSync('npm run build', {
      cwd: FRONTEND_DIR,
      stdio: 'inherit',
      timeout: 300000 // 5 minutes
    });
    console.log('[build] Step 1: Frontend build complete.');
  } catch (err) {
    console.error('[build] Step 1 FAILED: Frontend build error.');
    console.error(err.message);
    process.exit(1);
  }
}

// ──────────────────────────────────────────────
// Step 2: Download and extract portable Node.js 22
// ──────────────────────────────────────────────
function stepDownloadNode() {
  console.log('\n[build] Step 2: Downloading portable Node.js...');

  // Skip if already cached
  if (fs.existsSync(NODE_EXE)) {
    console.log(`[build] Step 2: Skipped — node.exe already exists at:\n  ${NODE_EXE}`);
    return;
  }

  // Ensure resources/ directory exists
  if (!fs.existsSync(RESOURCES_DIR)) {
    fs.mkdirSync(RESOURCES_DIR, { recursive: true });
    console.log(`[build] Created directory: ${RESOURCES_DIR}`);
  }

  // Download using PowerShell Invoke-WebRequest (handles redirects automatically)
  console.log(`[build] Downloading ${NODE_ZIP_URL}...`);
  try {
    execSync(
      `powershell -command "Invoke-WebRequest -Uri '${NODE_ZIP_URL}' -OutFile '${NODE_ZIP}'"`,
      { stdio: 'inherit', timeout: 300000 }
    );
  } catch (err) {
    console.error('[build] Step 2 FAILED: Could not download Node.js zip.');
    console.error(err.message);
    process.exit(1);
  }

  if (!fs.existsSync(NODE_ZIP)) {
    console.error(`[build] Step 2 FAILED: Zip not found after download: ${NODE_ZIP}`);
    process.exit(1);
  }

  // Extract zip to a temp directory inside resources/
  const TEMP_EXTRACT = path.join(RESOURCES_DIR, 'node-temp-extract');
  console.log('[build] Extracting Node.js zip...');
  try {
    execSync(
      `powershell -command "Expand-Archive -Path '${NODE_ZIP}' -DestinationPath '${TEMP_EXTRACT}' -Force"`,
      { stdio: 'inherit', timeout: 120000 }
    );
  } catch (err) {
    console.error('[build] Step 2 FAILED: Could not extract Node.js zip.');
    console.error(err.message);
    process.exit(1);
  }

  // Move inner directory (node-v22.x.x-win-x64/) up to resources/node/
  const INNER_DIR = path.join(TEMP_EXTRACT, NODE_INNER_DIR);
  if (!fs.existsSync(INNER_DIR)) {
    console.error(`[build] Step 2 FAILED: Expected inner directory not found: ${INNER_DIR}`);
    process.exit(1);
  }

  // Remove existing node/ destination if present
  if (fs.existsSync(NODE_DEST)) {
    fs.rmSync(NODE_DEST, { recursive: true, force: true });
  }

  fs.renameSync(INNER_DIR, NODE_DEST);

  // Clean up temp directory and zip
  if (fs.existsSync(TEMP_EXTRACT)) {
    fs.rmSync(TEMP_EXTRACT, { recursive: true, force: true });
  }
  if (fs.existsSync(NODE_ZIP)) {
    fs.rmSync(NODE_ZIP, { force: true });
  }

  // Verify node.exe was extracted successfully
  if (!fs.existsSync(NODE_EXE)) {
    console.error(`[build] Step 2 FAILED: node.exe not found after extraction: ${NODE_EXE}`);
    process.exit(1);
  }

  console.log('[build] Step 2: Portable Node.js ready at:', NODE_DEST);
}

// ──────────────────────────────────────────────
// Pre-Step 3: Verify all required resources exist
// ──────────────────────────────────────────────
function verifyPrerequisites() {
  console.log('\n[build] Verifying prerequisites before packaging...');
  const required = [
    { path: NODE_EXE, label: 'Portable Node.js (electron/resources/node/node.exe)' },
    { path: STANDALONE_SERVER, label: 'Next.js standalone (frontend/.next/standalone/server.js)' },
    { path: VENV_PYTHON, label: 'Python venv (venv/Scripts/python.exe)' }
  ];

  let allOk = true;
  for (const item of required) {
    if (fs.existsSync(item.path)) {
      console.log(`[build]   OK: ${item.label}`);
    } else {
      console.error(`[build]   MISSING: ${item.label}`);
      console.error(`          Expected at: ${item.path}`);
      allOk = false;
    }
  }

  if (!allOk) {
    console.error('\n[build] Prerequisites check FAILED. Aborting electron-builder.');
    process.exit(1);
  }

  console.log('[build] All prerequisites verified.');
}

// ──────────────────────────────────────────────
// Step 3: Run electron-builder
// ──────────────────────────────────────────────
function stepRunElectronBuilder() {
  console.log('\n[build] Step 3: Running electron-builder --win...');
  try {
    execSync('npx electron-builder --win', {
      cwd: ELECTRON_DIR,
      stdio: 'inherit',
      timeout: 600000 // 10 minutes (packaging large resources takes time)
    });
    console.log('[build] Step 3: electron-builder complete.');
  } catch (err) {
    console.error('[build] Step 3 FAILED: electron-builder error.');
    console.error(err.message);
    process.exit(1);
  }
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
(function main() {
  console.log('[build] Edit Factory installer build starting...');
  console.log(`[build] Project root: ${PROJECT_ROOT}`);

  stepBuildFrontend();
  stepDownloadNode();
  verifyPrerequisites();
  stepRunElectronBuilder();

  console.log('\n[build] Complete! Installer at electron/dist/');
})();
