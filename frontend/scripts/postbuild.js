// frontend/scripts/postbuild.js
// Copies static assets into Next.js standalone output.
// Required for standalone server.js to serve CSS, JS, and public files.
const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const base = path.join(__dirname, '..');
const standaloneDir = path.join(base, '.next', 'standalone');

// Check standalone output exists
if (!fs.existsSync(standaloneDir)) {
  console.error('ERROR: .next/standalone/ not found. Run "next build" first.');
  process.exit(1);
}

// Copy .next/static -> .next/standalone/.next/static
const staticSrc = path.join(base, '.next', 'static');
const staticDest = path.join(standaloneDir, '.next', 'static');
if (fs.existsSync(staticSrc)) {
  copyDir(staticSrc, staticDest);
  console.log('Copied .next/static -> standalone/.next/static');
} else {
  console.warn('WARNING: .next/static/ not found — skipping');
}

// Copy public -> .next/standalone/public
const publicSrc = path.join(base, 'public');
const publicDest = path.join(standaloneDir, 'public');
if (fs.existsSync(publicSrc)) {
  copyDir(publicSrc, publicDest);
  console.log('Copied public/ -> standalone/public/');
} else {
  console.warn('WARNING: public/ not found — skipping');
}

console.log('Standalone assets copied successfully.');
