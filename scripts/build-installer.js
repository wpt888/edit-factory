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

/**
 * PORTABLE NODE.JS SETUP
 * ======================
 * The installer bundles a portable Node.js runtime for running the Next.js
 * frontend in production. This is downloaded automatically by Step 2 below.
 *
 * Manual setup (if automatic download fails):
 *   1. Download Node.js 22 LTS (win-x64) from:
 *      https://nodejs.org/dist/v22.22.0/node-v22.22.0-win-x64.zip
 *   2. Extract the zip contents
 *   3. Move the extracted folder to: electron/resources/node/
 *      (so that electron/resources/node/node.exe exists)
 *   4. The build script will detect the cached binary and skip download
 *
 * The portable Node.js is gitignored (electron/.gitignore) and NOT
 * committed to the repository. Each developer downloads it once.
 *
 * For macOS builds, replace with the darwin-x64 or darwin-arm64 variant:
 *   https://nodejs.org/dist/v22.22.0/node-v22.22.0-darwin-arm64.tar.gz
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

  // Estimate bundled venv size (excluding torch/whisper which are filtered by electron-builder)
  const HEAVY_DIRS = ['torch', 'torchaudio', 'torchvision', 'nvidia', 'triton', 'whisper', 'TTS', 'Cython'];
  const VENV_LIB = path.join(PROJECT_ROOT, 'venv', 'Lib', 'site-packages');
  if (fs.existsSync(VENV_LIB)) {
    let heavyFound = [];
    for (const dir of HEAVY_DIRS) {
      const dirPath = path.join(VENV_LIB, dir);
      if (fs.existsSync(dirPath)) {
        heavyFound.push(dir);
      }
    }
    if (heavyFound.length > 0) {
      console.log(`[build]   NOTE: Heavy packages found in venv (excluded from bundle by filter): ${heavyFound.join(', ')}`);
      console.log('[build]   These will NOT be included in the installer (electron-builder filter).');
    } else {
      console.log('[build]   OK: No heavy ML packages in venv (clean for bundling)');
    }
  }
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
  if (process.argv.includes('--help')) {
    console.log('Edit Factory Installer Build Script');
    console.log('===================================');
    console.log('Usage: node scripts/build-installer.js [--help]');
    console.log('');
    console.log('Steps:');
    console.log('  1. Builds Next.js frontend (standalone mode)');
    console.log('  2. Downloads portable Node.js 22 LTS to electron/resources/node/');
    console.log('  3. Verifies all prerequisites');
    console.log('  4. Runs electron-builder to produce NSIS installer');
    console.log('');
    console.log('Manual Node.js setup:');
    console.log('  Download: https://nodejs.org/dist/v22.22.0/node-v22.22.0-win-x64.zip');
    console.log('  Extract to: electron/resources/node/ (so node.exe exists there)');
    console.log('');
    console.log('Output: electron/dist/EditFactory-Setup-{version}.exe');
    process.exit(0);
  }

  console.log('[build] Edit Factory installer build starting...');
  console.log(`[build] Project root: ${PROJECT_ROOT}`);

  stepBuildFrontend();
  stepDownloadNode();
  verifyPrerequisites();
  stepRunElectronBuilder();

  console.log('\n[build] Complete! Installer at electron/dist/');
})();
