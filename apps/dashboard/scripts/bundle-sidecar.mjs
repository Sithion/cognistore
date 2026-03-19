#!/usr/bin/env node
/**
 * Bundle the Fastify server + dependencies for Tauri sidecar.
 *
 * Creates sidecar-bundle/ with:
 *   dist/             - Vite frontend (served by Fastify via @fastify/static)
 *   dist-server/      - Single-file bundled Fastify server (tsup)
 *   node_modules/     - Only native addons (better-sqlite3, sqlite-vec)
 */

import { execSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync as readDirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(__dirname, '..');
const bundleDir = resolve(dashboardRoot, 'sidecar-bundle');

console.log('Bundling sidecar for Tauri...\n');

// 1. Clean previous bundle
if (existsSync(bundleDir)) {
  rmSync(bundleDir, { recursive: true });
}
mkdirSync(bundleDir, { recursive: true });

// 2. Build the monorepo (frontend + server deps)
console.log('[1/4] Building monorepo...');
execSync('pnpm turbo build --filter=@ai-knowledge/dashboard', {
  cwd: resolve(dashboardRoot, '..', '..'),
  stdio: 'inherit',
});

// 3. Bundle server into single file with tsup (externalize native modules)
console.log('\n[2/4] Bundling server with tsup...');
mkdirSync(resolve(bundleDir, 'dist-server'), { recursive: true });
execSync(
  './node_modules/.bin/tsup --config tsup.sidecar.ts',
  {
    cwd: dashboardRoot,
    stdio: 'inherit',
  }
);

// 4. Copy Vite frontend
console.log('\n[3/4] Copying frontend assets...');
const distSrc = resolve(dashboardRoot, 'dist');
if (!existsSync(distSrc)) {
  throw new Error('dist/ not found. Run `pnpm build` first.');
}
cpSync(distSrc, resolve(bundleDir, 'dist'), { recursive: true });

// 5. Copy native node_modules (better-sqlite3, sqlite-vec)
console.log('\n[4/4] Copying native modules...');
const nodeModulesDir = resolve(bundleDir, 'node_modules');
mkdirSync(nodeModulesDir, { recursive: true });

// Native modules + their transitive deps that must be copied
const requiredModules = [
  'better-sqlite3',
  'sqlite-vec',
  'bindings',
  'file-uri-to-path',
];

// Detect platform-specific sqlite-vec package
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const platform = process.platform;
const sqliteVecPlatform = `sqlite-vec-${platform}-${arch}`;
requiredModules.push(sqliteVecPlatform);

const monorepoNodeModules = resolve(dashboardRoot, '..', '..', 'node_modules');
const pnpmDir = resolve(monorepoNodeModules, '.pnpm');
const { readdirSync } = await import('node:fs');

function findInPnpm(modName) {
  // Search in .pnpm for the package
  if (!existsSync(pnpmDir)) return null;
  const entries = readdirSync(pnpmDir);
  const match = entries.find(e => e.startsWith(modName + '@'));
  if (match) {
    const fullPath = resolve(pnpmDir, match, 'node_modules', modName);
    if (existsSync(fullPath)) return fullPath;
  }
  return null;
}

for (const mod of requiredModules) {
  // Try hoisted first, then .pnpm
  const hoisted = resolve(monorepoNodeModules, mod);
  const src = existsSync(hoisted) ? hoisted : findInPnpm(mod);

  if (src) {
    cpSync(src, resolve(nodeModulesDir, mod), { recursive: true });
    console.log(`  Copied: ${mod}`);
  } else {
    console.warn(`  WARNING: Could not find ${mod}`);
  }
}

// 6. Rebuild better-sqlite3 with Node 20 (ensures MODULE_VERSION matches at runtime)
console.log('\n[5/7] Rebuilding better-sqlite3 for Node 20...');
const REQUIRED_NODE_MAJOR = 20;

function findNode20() {
  const nvmDir = resolve(homedir(), '.nvm', 'versions', 'node');
  if (existsSync(nvmDir)) {
    try {
      const versions = readDirSync(nvmDir)
        .filter(v => v.startsWith(`v${REQUIRED_NODE_MAJOR}.`))
        .sort();
      if (versions.length > 0) {
        const nodeBin = resolve(nvmDir, versions[versions.length - 1], 'bin', 'node');
        if (existsSync(nodeBin)) return nodeBin;
      }
    } catch { /* ignore */ }
  }
  return null;
}

const node20 = findNode20();
if (node20) {
  const node20Version = execSync(`"${node20}" --version`, { encoding: 'utf-8' }).trim();
  console.log(`  Using Node.js ${node20Version} at ${node20}`);
  const npmBin = resolve(dirname(node20), 'npm');
  try {
    execSync(`"${npmBin}" rebuild better-sqlite3 --build-from-source`, {
      cwd: bundleDir,
      stdio: 'inherit',
      env: { ...process.env, PATH: `${dirname(node20)}:${process.env.PATH}` },
    });
    console.log('  Rebuilt better-sqlite3 for Node 20');
  } catch (e) {
    console.warn(`  WARNING: Could not rebuild better-sqlite3: ${e.message}`);
    console.warn('  The app may fail if the user runs a different Node.js version');
  }
} else {
  console.warn(`  WARNING: Node.js v${REQUIRED_NODE_MAJOR} not found in nvm.`);
  console.warn('  Install it: nvm install 20');
  console.warn('  Skipping rebuild — native modules may not work at runtime.');
}

// 7. Copy templates (skills + configs)
console.log('\n[6/7] Copying templates...');
const templatesSrc = resolve(dashboardRoot, 'templates');
if (existsSync(templatesSrc)) {
  cpSync(templatesSrc, resolve(bundleDir, 'templates'), { recursive: true });
  console.log('  Copied: templates/');
} else {
  console.warn('  WARNING: templates/ not found');
}

console.log('\n[7/7] Done!');
console.log(`\nSidecar bundle ready at: ${bundleDir}`);
console.log('Contents:');
execSync(`ls -la "${bundleDir}"`, { stdio: 'inherit' });
