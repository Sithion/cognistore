#!/usr/bin/env node
/**
 * Bundle the Fastify server + dependencies for Tauri sidecar.
 *
 * Creates sidecar-bundle/ with:
 *   dist/             - Vite frontend (served by Fastify via @fastify/static)
 *   dist-server/      - Server plus worker entries, including jobs/ (tsup)
 *   node_modules/     - Only native addons (better-sqlite3, sqlite-vec)
 *
 * Usage:
 *   node bundle-sidecar.mjs              # Full bundle (default, for local dev)
 *   node bundle-sidecar.mjs --phase=web  # Platform-independent assets only (CI: runs once)
 *   node bundle-sidecar.mjs --phase=native # Native modules only (CI: runs per platform)
 */

import { execSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync as readDirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(__dirname, '..');
const bundleDir = resolve(dashboardRoot, 'sidecar-bundle');

// Parse --phase flag
const phaseArg = process.argv.find(a => a.startsWith('--phase='));
const phase = phaseArg ? phaseArg.split('=')[1] : 'all';

if (!['all', 'web', 'native'].includes(phase)) {
  console.error(`Unknown phase: ${phase}. Use --phase=web, --phase=native, or omit for full bundle.`);
  process.exit(1);
}

const runWeb = phase === 'all' || phase === 'web';
const runNative = phase === 'all' || phase === 'native';

console.log(`Bundling sidecar for Tauri (phase: ${phase})...\n`);

// ── Phase: web (platform-independent) ──────────────────────────────

if (runWeb) {
  // Clean previous bundle (only in web/all phase)
  if (existsSync(bundleDir)) {
    rmSync(bundleDir, { recursive: true });
  }
  mkdirSync(bundleDir, { recursive: true });

  // 1. Build the monorepo (frontend + server deps)
  console.log('[web 1/4] Building monorepo...');
  execSync('pnpm turbo build --filter=@cognistore/dashboard', {
    cwd: resolve(dashboardRoot, '..', '..'),
    stdio: 'inherit',
  });

  // 2. Bundle server into single file with tsup (externalize native modules)
  console.log('\n[web 2/4] Bundling server with tsup...');
  mkdirSync(resolve(bundleDir, 'dist-server'), { recursive: true });
  execSync(
    './node_modules/.bin/tsup --config tsup.sidecar.ts',
    {
      cwd: dashboardRoot,
      stdio: 'inherit',
    }
  );

  // 3. Copy Vite frontend
  console.log('\n[web 3/4] Copying frontend assets...');
  const distSrc = resolve(dashboardRoot, 'dist');
  if (!existsSync(distSrc)) {
    throw new Error('dist/ not found. Run `pnpm build` first.');
  }
  cpSync(distSrc, resolve(bundleDir, 'dist'), { recursive: true });

  // 4a. Compile platform instructions from base template
  console.log('\n[web 4/5] Compiling platform instructions...');
  execSync('node templates/configs/compile-instructions.mjs', {
    cwd: dashboardRoot,
    stdio: 'inherit',
  });

  // 4b. Copy templates (skills + configs)
  console.log('\n[web 5/5] Copying templates...');
  const templatesSrc = resolve(dashboardRoot, 'templates');
  if (existsSync(templatesSrc)) {
    cpSync(templatesSrc, resolve(bundleDir, 'templates'), { recursive: true });
    console.log('  Copied: templates/');
  } else {
    console.warn('  WARNING: templates/ not found');
  }

  console.log('\nWeb phase complete.');
}

// ── Phase: native (platform-specific) ──────────────────────────────

if (runNative) {
  if (!existsSync(bundleDir)) {
    mkdirSync(bundleDir, { recursive: true });
  }

  // 1. Copy native node_modules (better-sqlite3, sqlite-vec)
  console.log('\n[native 1/2] Copying native modules...');
  const nodeModulesDir = resolve(bundleDir, 'node_modules');
  mkdirSync(nodeModulesDir, { recursive: true });

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
    const hoisted = resolve(monorepoNodeModules, mod);
    const src = existsSync(hoisted) ? hoisted : findInPnpm(mod);

    if (src) {
      cpSync(src, resolve(nodeModulesDir, mod), { recursive: true });
      console.log(`  Copied: ${mod}`);
      if (mod === 'better-sqlite3') {
        const prebuilds = resolve(nodeModulesDir, mod, 'prebuilds');
        const target = `${platform}-${arch}.node`;
        if (existsSync(prebuilds)) {
          for (const entry of readDirSync(prebuilds)) {
            if (entry !== target) {
              rmSync(resolve(prebuilds, entry), { recursive: true, force: true });
            }
          }
          console.log(`  Kept better-sqlite3 prebuild: ${target}`);
        }
      }
    } else {
      console.warn(`  WARNING: Could not find ${mod}`);
    }
  }

  // better-sqlite3 13 ships N-API prebuilds. Keep the matching platform binary;
  // N-API lets it load across Node versions without a rebuild.
  console.log('\nNative modules copied from their prebuilt binaries.');
}

// ── Summary ────────────────────────────────────────────────────────

console.log(`\nSidecar bundle ready at: ${bundleDir}`);
console.log('Contents:');
execSync(`ls -la "${bundleDir}"`, { stdio: 'inherit' });
