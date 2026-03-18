# CI/CD and Publishing

This document describes the continuous integration and continuous deployment pipeline for the AI Knowledge Base project.

## Overview

The project uses GitHub Actions to automate building, testing, and publishing the `@ai-knowledge/cli` package to npm.

Two workflows are configured:

1. **CI Workflow** (`ci.yml`) — Runs on every pull request to `main`
2. **Publish Workflow** (`publish.yml`) — Runs on push to `main` (after merge)

## CI Workflow

**Trigger:** Pull requests to the `main` branch

**Location:** `.github/workflows/ci.yml`

### Pipeline Steps

1. **Checkout code** — Fetch the repository
2. **Setup pnpm** — Install pnpm v9.15.0
3. **Setup Node.js** — Install Node.js v20 with pnpm cache enabled
4. **Install dependencies** — `pnpm install --frozen-lockfile`
5. **Build all packages** — `pnpm build` (triggers workspace builds via Turborepo)
6. **Run tests** — `pnpm test` (runs all test suites in the workspace)

### Acceptance Criteria

A pull request can only merge if:
- Build succeeds (`pnpm build`)
- All tests pass (`pnpm test`)
- (Optional) Branch protection rules are configured to require CI status checks — see [Branch Protection Setup](#branch-protection-setup)

## Publish Workflow

**Trigger:** Push to `main` branch (typically after PR merge) affecting:
- `apps/cli/**` (CLI package)
- `packages/**` (shared packages)
- `pnpm-lock.yaml` (dependency changes)

**Location:** `.github/workflows/publish.yml`

### Pipeline Steps

1. **Checkout code** — Fetch the repository
2. **Setup pnpm** — Install pnpm v9.15.0
3. **Setup Node.js** — Install Node.js v20 and configure npm registry authentication
4. **Install dependencies** — `pnpm install --frozen-lockfile`
5. **Build all packages** — `pnpm build`
6. **Version check** — Query npm registry to check if the current version already exists
7. **Conditional publish** — If version does not exist, publish `@ai-knowledge/cli` to npm with `--access public`

### What Gets Published

Only the **CLI package** is published to npm:

```json
{
  "name": "@ai-knowledge/cli",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "bin": { "kb": "./dist/index.js" }
}
```

**Package files included:**
- `dist/` — Bundled CLI executable
- `templates/` — Installation templates

### Bundling

The CLI is built with **tsup** (`apps/cli/tsup.config.ts`), which:

- Bundles the entry point (`src/index.ts`) into a single executable
- Inlines all workspace dependencies (`@ai-knowledge/*`) — they are NOT published separately
- Outputs to `dist/index.js`
- Sets the shebang (`#!/usr/bin/env node`) for direct command-line execution

The CLI can then be executed via:
```bash
npx @ai-knowledge/cli install
```

### Version Management

**Version checking:**

Before publishing, the workflow runs:

```bash
npm view @ai-knowledge/cli@$PACKAGE_VERSION version
```

This queries the npm registry for the current version. If it exists, publishing is skipped (idempotent).

**To bump the version:**

Edit `apps/cli/package.json` and increment the `version` field:

```json
{
  "version": "0.1.1"  // Was 0.1.0
}
```

Commit the change to `main`. On the next push, the publish workflow will detect the new version and publish it.

### Authentication

The publish step requires the `NPM_TOKEN` secret:

```yaml
env:
  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Setup:**

1. Generate an npm access token in your npm account settings (https://npmjs.com/settings/tokens)
2. Create a **public token** (recommended) or **automation token**
3. Add it as a GitHub Actions secret named `NPM_TOKEN` in the repository settings
4. Ensure the token has **publish** permissions for the `@ai-knowledge` organization scope

**Organization requirement:**

The package is published under the `@ai-knowledge` npm organization. Ensure:
- The npm organization exists and is public
- The user/CI token has publisher access to the organization
- The package name in `package.json` matches the organization scope: `@ai-knowledge/cli`

## Branch Protection Setup

To enforce CI checks before merging, configure branch protection on `main`:

**GitHub Repository Settings → Branches → Add Rule:**

1. **Branch name pattern:** `main`
2. **Require pull request reviews before merging:** 1 approval (from: CODEOWNERS or team lead)
3. **Require status checks to pass before merging:**
   - Check: `build-and-test` (from `.github/workflows/ci.yml`)
4. **Require branches to be up to date before merging:** Yes
5. **Include administrators:** Optional (recommended)

See `.github/BRANCH_PROTECTION.md` for detailed setup instructions.

## Troubleshooting

### Publish Workflow Skipped

If the publish workflow does not run after a merge to `main`:

1. **Check paths:** The workflow only triggers if `apps/cli/**`, `packages/**`, or `pnpm-lock.yaml` changed
2. **Check branch:** Only pushes directly to `main` trigger; PR merges may not if using squash
3. **Check status checks:** If CI fails, publish is skipped (as expected)

### Version Already Exists Error

If `npm publish` fails with "version already exists":

1. The version in `apps/cli/package.json` is already published
2. Increment the version number (patch/minor/major)
3. Commit and push to `main`
4. The workflow will publish the new version

### NPM_TOKEN Not Found

If the publish step fails with "cannot find NPM_TOKEN":

1. Navigate to **Settings → Secrets and variables → Actions**
2. Verify `NPM_TOKEN` exists
3. Verify it's a valid, non-expired npm access token
4. Test locally: `npm set //registry.npmjs.org/:_authToken=YOUR_TOKEN` then `npm view @ai-knowledge/cli`

### Build or Test Failures

1. Check the CI workflow logs in the PR
2. Run locally: `pnpm install && pnpm build && pnpm test`
3. Fix issues and push updates to the PR branch
4. The workflow will re-run automatically

## Local Development

### Simulating the CI Pipeline

```bash
# Install dependencies
pnpm install

# Build all packages (same as CI)
pnpm build

# Run all tests
pnpm test

# Test bundling (CLI build)
cd apps/cli
pnpm build
# Output is in ./dist/index.js
```

### Testing the CLI Locally

After building:

```bash
# Run the bundled CLI directly
node apps/cli/dist/index.js install --help

# Or use npm link for system-wide access
cd apps/cli
npm link
kb install --help
```

### Publishing Manually (Local)

**Not recommended, but for testing:**

```bash
cd apps/cli
npm publish --access public --dry-run  # Test without publishing
```

Requires npm to be logged in: `npm login`

## Related Files

- **CI Workflow:** `.github/workflows/ci.yml`
- **Publish Workflow:** `.github/workflows/publish.yml`
- **Branch Protection Guide:** `.github/BRANCH_PROTECTION.md`
- **CLI Bundler Config:** `apps/cli/tsup.config.ts`
- **CLI Package Config:** `apps/cli/package.json`
- **Root Build Script:** `pnpm build` (runs via Turborepo)
