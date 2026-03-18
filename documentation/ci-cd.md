# CI/CD and Publishing

## Overview

The project uses GitHub Actions for building, testing, and publishing. Two workflows:

1. **CI** (`ci.yml`) — Runs on pull requests to `main`
2. **Publish** (`publish.yml`) — Runs on push to `main` (after merge)

## CI Workflow

**Trigger:** Pull requests to `main`

**Steps:**
1. Setup pnpm (version from `packageManager` field in `package.json`)
2. Setup Node.js 20
3. `pnpm install --frozen-lockfile`
4. `pnpm build` (all workspace packages via Turborepo)
5. `pnpm test`
6. Validate MCP server package (`npm publish --dry-run`)

## Publish Workflow

**Trigger:** Push to `main` affecting `apps/**`, `packages/**`, `.github/workflows/**`, or `pnpm-lock.yaml`. Also supports `workflow_dispatch` for manual runs.

Two jobs run **in parallel**:

### Job 1: publish-mcp

Publishes `@ai-knowledge/mcp-server` to npm.

**Steps:**
1. Build all packages
2. Run tests
3. Check if version already exists on npm
4. If new version: `npm publish --provenance --access public`

**Bundling:** The MCP server uses **tsup** to bundle all workspace packages (`@ai-knowledge/sdk`, `core`, `embeddings`, `shared`) inline. Only native dependencies (`better-sqlite3`, `sqlite-vec`, `drizzle-orm`) and npm packages (`@modelcontextprotocol/sdk`, `zod`) remain external.

### Job 2: publish-tauri

Builds the Tauri desktop app for 3 platforms:

| Platform | Runner | Target | Output |
|----------|--------|--------|--------|
| macOS (Apple Silicon) | `macos-latest` | `aarch64-apple-darwin` | `.dmg` |
| macOS (Intel) | `macos-13` | `x86_64-apple-darwin` | `.dmg` |
| Linux | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `.AppImage`, `.deb` |

**Steps:**
1. Install system deps (Linux: webkit2gtk, appindicator, etc.)
2. Install Rust stable
3. Build monorepo (`pnpm turbo build --filter=@ai-knowledge/dashboard`)
4. Bundle Fastify sidecar
5. Build Tauri app → upload to GitHub Releases

The release tag is auto-generated from `apps/dashboard/package.json` version.

## Version Management

**To release a new version:**

1. Bump version in `apps/mcp-server/package.json` (for npm) and/or `apps/dashboard/package.json` (for app)
2. Merge to `main`
3. Publish workflow runs automatically

The workflow checks npm registry before publishing — if version exists, publish is skipped (idempotent).

## Authentication

- **NPM_TOKEN** — Required for npm publish. Set as GitHub Actions secret.
- **GITHUB_TOKEN** — Auto-provided. Used by tauri-action to create releases.

## Branch Protection

| Rule | Value |
|------|-------|
| CI required | `build-and-test` must pass |
| Reviews required | 1 (code owner) |
| Code owners | `@Sithion` (via `.github/CODEOWNERS`) |
| Enforce admins | Yes |
| Force push | Blocked |

## Related Files

- **CI:** `.github/workflows/ci.yml`
- **Publish:** `.github/workflows/publish.yml`
- **Code Owners:** `.github/CODEOWNERS`
- **MCP Bundler:** `apps/mcp-server/tsup.config.ts`
- **Sidecar Bundler:** `apps/dashboard/scripts/bundle-sidecar.mjs`
