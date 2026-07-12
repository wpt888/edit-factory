// Ensure the development Electron shell has a runnable Next.js standalone
// bundle. A normal `next dev` session must not make desktop startup fail.
//
// Compare a content fingerprint rather than mtimes. Git checkouts and branch
// switches can restore older timestamps while changing file contents, which
// previously allowed a stale desktop UI to be launched.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const frontendDir = path.resolve(__dirname, '..', '..', 'frontend');
const serverFile = path.join(frontendDir, '.next', 'standalone', 'server.js');
const fingerprintFile = path.join(frontendDir, '.next', 'standalone', '.blipost-source-hash');

function sourceFiles(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return [target];
  return fs.readdirSync(target, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => sourceFiles(path.join(target, entry.name)));
}

function sourceFingerprint() {
  const files = [
    ...sourceFiles(path.join(frontendDir, 'src')),
    ...sourceFiles(path.join(frontendDir, 'public')),
    ...['next.config.ts', 'package.json', 'package-lock.json', 'postcss.config.mjs', 'tsconfig.json']
      .map((file) => path.join(frontendDir, file))
      .filter((file) => fs.existsSync(file)),
  ].sort();

  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(frontendDir, file).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

const expectedFingerprint = sourceFingerprint();
const builtFingerprint = fs.existsSync(fingerprintFile)
  ? fs.readFileSync(fingerprintFile, 'utf8').trim()
  : '';

if (fs.existsSync(serverFile) && builtFingerprint === expectedFingerprint) {
  console.log('[desktop] Frontend standalone bundle is ready.');
  process.exit(0);
}

console.log(`[desktop] Frontend standalone bundle is ${fs.existsSync(serverFile) ? 'stale' : 'missing'}; building it now...`);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCommand, ['run', 'build'], {
  cwd: frontendDir,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
  // Windows cannot execute npm.cmd directly through spawnSync reliably.
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`[desktop] Could not start the frontend build: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0 || !fs.existsSync(serverFile)) {
  console.error('[desktop] Frontend build did not produce .next/standalone/server.js.');
  process.exit(result.status || 1);
}

fs.writeFileSync(fingerprintFile, `${expectedFingerprint}\n`, 'utf8');
console.log('[desktop] Frontend standalone bundle built successfully.');
