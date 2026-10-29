# CI/CD Pipeline

## Overview

The project uses **GitHub Actions** with two workflows:

1. **CI** (`ci.yml`) — Validates pull requests
2. **Publish** (`publish.yml`) — Releases to npm and GitHub Releases on merge to main

## CI Workflow

**File:** `.github/workflows/ci.yml`
**Trigger:** Pull requests to `main`, pushes to `feature/**`, and a weekly schedule (OSV scan only)

| Job | What it does | Gate |
|---|---|---|
| `version-check`, `release-version-guard` | Version bumped vs `main`, release sources in sync, tag unpublished | PRs to `main`. Expected red on a WIP release PR that has not been bumped yet |
| `validate-dependencies` | External URLs (Ollama install script, Releases API) answer 200 | Required |
| `type-check` | `pnpm type-check`: dashboard frontend + server, MCP server, and the test package (`packages/tests`, since v2.6) | Required |
| `build-and-test` | Chromium for the browser e2e, then `pnpm verify --coverage` (below): lint, type-check, build, the Vitest unit layer and the Playwright suites under V8 coverage, and the coverage gate. Then `npm publish --dry-run`, which fails on any `npm warn publish` or error except "cannot publish over the previously published version": on an unbumped release branch that is expected, and `version-check` owns it | Required. Also fails when a package's coverage drops below the baseline |
| `sidecar-bundle` (v2.6) | Builds the packaged sidecar like `publish.yml` (`bundle-sidecar.mjs`: tsup single-file server, frontend, templates, native `better-sqlite3`/`sqlite-vec` rebuilt for Node 24) on `ubuntu-24.04`. Checks that the compiled agent instructions in `templates/configs/` match their base template, then runs `smoke-sidecar-bundle.mjs`: the bundle is copied to a temp `Resources/` layout and started with the env of `sidecar.rs`, except `COGNISTORE_MANAGED` (so the startup self-heal does not run) and with `OLLAMA_HOST` pointing at a stub, in a sandboxed HOME. It must print the ready marker, report the database connected on `/api/health`, and find an added entry by semantic search, which needs sqlite-vec. Same steps as `publish.yml`, but on `ubuntu-24.04`, while the release builds Linux on `ubuntu-22.04` | Required |
| `rust` (v2.6) | `cargo check --locked` + `cargo test --locked` in `apps/dashboard/src-tauri` on `ubuntu-24.04`, toolchain from `rust-toolchain.toml` (1.97.0, also passed to `dtolnay/rust-toolchain` — keep both in sync), the same Linux deps as `publish.yml`. The `sidecar-bundle/{dist,dist-server,node_modules}` resources `tauri_build` requires are empty stubs here; the `sidecar-bundle` job builds and runs the real one | Required |
| `perf` (v2.6) | The `@perf` suite on the cached 10k-entry fixture with `PERF_BUDGET_SCALE=3`. Its `PERF` lines go to the job summary for comparison with `packages/tests/src/performance/baseline.json` | Report only (`continue-on-error`) |
| `osv-scan` | OSV-Scanner over the npm and Cargo lockfiles, with the ignore list in `osv-scanner.toml`. Every ignore carries a `reason`, and ignores that no longer match are removed (to list them, run the scanner with an empty config) | Required. Weekly failures open/update a tracking issue |

All Linux jobs run on `ubuntu-24.04`, pinned rather than `ubuntu-latest`, so a runner image change is a deliberate edit. The exception is the Linux release build in `publish.yml`, which stays on `ubuntu-22.04` so the AppImage/deb link against an older glibc. Actions are pinned by commit SHA.

### `pnpm verify` (v2.6)

`scripts/verify.mjs` is the single gate, used both by CI's `build-and-test` and by the `pre-push` hook (`.husky/pre-push`). The hook skips pushes that send no new commits (branch deletions, tags only); skip any other push with `git push --no-verify`. It runs in order and stops at the first failure:

1. **lint:** `pnpm lint` = Biome over `apps/`, `packages/` and `scripts/` (see *Lint* below). Errors fail; warnings do not.
2. **type-check**
3. **build:** the suites spawn the built sidecar and MCP server. `turbo.json` declares `dist-server/**` as a build output, so a cached build restores the sidecar too.
4. **unit:** Vitest in `packages/core` and the sidecar's `auth.ts`/`settings.ts`.
5. **scripts:** `pnpm test:scripts`, `node:test` for the root tooling scripts (`scripts/test/`, e.g. the coverage normalizer). The root is not a workspace package, so these use Node's built-in runner instead of pulling Vitest in.
6. **integration:** the Playwright projects e2e, load and compat. This covers the API route inventory, the MCP contract, the MCP × database matrix and the upgrade matrix.
7. **knip:** `pnpm knip` against `knip.json` — unused files, exports and dependencies fail the step. `knip.json` declares the entries knip cannot see on its own (the sidecar's `tsup.sidecar.ts`, the instruction compiler, the OpenCode plugin template, the tooling scripts) and the MCP server's native dependencies, which its bundle keeps external. Exports used only inside their own file are not reported (`ignoreExportsUsedInFile`).
8. **coverage:** with `--coverage`, steps 4 and 6 run under V8 coverage and the gate below runs last. `--markdown <file>` also writes the table. When unit or integration fails, the table is still written from what ran, and verify still fails.

The `@perf` suite is not part of `pnpm verify`; it runs in the `perf` job.

### Lint (v2.6, B.7)

`biome.json` at the root, `@biomejs/biome` pinned to an exact version. Only the linter is on (no formatter, no import sorting), so adopting it changed no code.

**Why Biome and not ESLint + typescript-eslint + react-hooks:** one binary with no plugin tree (a much smaller supply-chain surface for a public repo, and one devDependency to pin and audit), fast enough for the pre-push hook (≈60 ms for the whole repo), and it ships the React hooks rules natively (`useHookAtTopLevel`, `useExhaustiveDependencies`). It does not type-check rules; `pnpm type-check` already covers that.

**Baseline without rewriting the code:** the `recommended` preset, except:

| Rule | Level | Findings at adoption | Why |
|---|---|---:|---|
| `a11y/useButtonType` | warn | 89 | Dashboard buttons without `type`; fix with the UI work (Fase U) |
| `correctness/useExhaustiveDependencies` | warn | 31 | Each needs a behaviour check; fix one by one |
| `a11y/useKeyWithClickEvents`, `a11y/noStaticElementInteractions` | warn | 28, 27 | Clickable `div`s; Fase U |
| `a11y/noLabelWithoutControl` | warn | 20 | Fase U |
| `a11y/noSvgWithoutTitle`, `a11y/noAutofocus` | warn | 6, 2 | Fase U |
| `suspicious/noArrayIndexKey`, `noImplicitAnyLet`, `useIterableCallbackReturn`, `noAssignInExpressions`, `noControlCharactersInRegex` | warn | 6, 6, 6, 4, 2 | Real but low risk; fix when touching the file |
| `correctness/noComponentHookFactories` | warn | 1 | Same |
| `suspicious/noExplicitAny` | off | 297 | Too noisy to be useful as warnings; revisit with stricter types |
| `style/noNonNullAssertion` | off | 257 | Same |
| `style/useTemplate`, `complexity/useLiteralKeys` | off | 65, 12 | Style only |

Every other recommended rule is an error, so new code cannot add, for example, a conditional hook (`useHookAtTopLevel`), an unreachable branch or a duplicate key. To tighten the baseline, fix a rule's findings and delete its line from `biome.json`.

### Coverage

Both test layers run under V8 coverage in `build-and-test`:

- **Unit:** `pnpm coverage:unit` runs Vitest with `@vitest/coverage-v8` in `packages/core` and `apps/dashboard` (`auth.ts`, `settings.ts`).
- **Integration:** `pnpm coverage:integration` wraps the Playwright suites in `c8` (`.c8rc.json`). The sidecar and MCP processes the tests spawn inherit `NODE_V8_COVERAGE`, so their code is measured too. c8 filters on the built `dist` files and maps them back to `src`. The MCP server is a single tsup bundle and is reported as one row, `mcp-server (bundle)`, which also contains the code it inlines.
- **Report and gate:** `pnpm coverage:report` (`scripts/coverage-report.mjs`) prints lines and branches per package and layer. With `--markdown <file>` it also writes the table, plus the reasons when the gate fails, to a file that CI appends to the job summary. It fails when any row drops more than 1 pt below `coverage-baseline.json`, when a baseline row was not measured or measured under half its recorded lines (a source map that did not load), or when the baseline file is missing. The raw reports are uploaded as the `coverage` artifact.
- **Normalizing the integration dumps (v2.6, B.6):** before reading the integration numbers, the report runs `scripts/coverage-normalize.mjs` on `coverage/integration/.v8` and then `c8 report` again. Why: the Playwright runner and worker processes load `packages/*/dist` through Playwright's transforming loader, so their V8 dumps carry the line lengths of the transformed code, not of the file on disk. c8 merges the `source-map-cache` of all dumps with `Object.assign` in directory order, so the last dump wins, and dump names start with the process id. When a Playwright dump won, every file of that package was remapped to a single line (`only N lines measured`), depending on nothing but PIDs: green in CI, red on another machine. The normalizer drops every cache entry whose line lengths differ from the file on disk, together with that dump's coverage of the same URL; it is idempotent. Consequence: code the Playwright tests run in-process (not in a spawned sidecar or MCP server) is not counted in the integration layer; it was being mapped onto the wrong lines anyway, and the Vitest layer covers it.
- **Raising the bar:** after a change that adds tests, run `pnpm coverage` locally (or take the numbers from the CI artifact) and commit the result of `node scripts/coverage-report.mjs --write-baseline`. The baseline only moves up on purpose; a drop has to be explained in the PR. Take the numbers from CI when they differ: a test that reads something only a developer machine has (e.g. real agent logs) inflates a local run.

**Why not the AppImage/deb in CI (decision, v2.6):** the bundle smoke covers what breaks the desktop app at runtime: the single-file server, the native ABI and sqlite-vec's loadable extension. The `rust` job compiles and tests the shell. Building the AppImage/deb as well would add the full Tauri bundling (about 15 minutes cold, plus linuxdeploy) to every PR, only to check the packaging step that `publish.yml` already runs on each release, and a packaging failure there leaves the release a draft (`verify-release`), so nothing broken reaches users. Revisit if a release fails at packaging.

The perf fixture cache key is the hash of `packages/tests/src/performance/fixtures/generate-fixture.ts`, so a generator change (or a `FIXTURE_VERSION` bump) rebuilds it.

## Publish Workflow

**File:** `.github/workflows/publish.yml`
**Trigger:** Push to `main` affecting `apps/**`, `packages/**`, `.github/workflows/**`, or `pnpm-lock.yaml`. Also supports `workflow_dispatch` for manual runs.

The pipeline builds each release as a **draft**, verifies its updater manifest is complete, then promotes it to public — so updater clients never see a half-built release:

`publish-mcp` → `create-release` (draft) → `build-web` → `publish-tauri` → `verify-release` → `promote-release`.

When any of these fails on `main`, `alert-on-failure` opens an issue titled "Publish workflow is failing on main", or comments on the open one, with a link to the run (v2.6).

### Job 1: publish-mcp

Publishes `@cognistore/mcp-server` to npm.

```
Steps:
1. Build all packages
2. Run tests
3. Check if version exists on npm (npm view)
4. If new version → npm publish --provenance --access public
```

The `--provenance` flag enables npm provenance attestation, linking the published package to this GitHub repository.

### Job 2: create-release

Creates a **draft** GitHub Release with release notes, then clears any stale updater assets once (before the build matrix).

```
Steps:
1. Read version from apps/dashboard/package.json
2. Check if release v{version} already exists
3. If not → create DRAFT release with:
   - Download table (macOS Apple Silicon, Linux)
   - macOS gatekeeper workaround instructions
   - Feature highlights
4. Clean stale release assets (*.tar.gz / *.sig / latest.json) — runs here,
   once, so no build job deletes another platform's updater artifacts
```

### Job 3: build-web

Builds the platform-independent web/sidecar assets once and uploads them as an artifact the `publish-tauri` matrix downloads.

### Job 4: publish-tauri

Builds desktop binaries. macOS is **Apple Silicon only** — the Intel (`macos-13`, `x86_64-apple-darwin`) job never got a runner (hung in "queued" → 24h cancel every release) and no Intel `.dmg` ever shipped, so it was removed. The two targets run **serially** (`max-parallel: 1`) so `tauri-action`'s read-merge-write of `latest.json` accumulates both platforms deterministically instead of racing; a `timeout-minutes` guards against a stuck runner.

| Platform | Runner | Target | Output |
|----------|--------|--------|--------|
| macOS (Apple Silicon) | `macos-latest` | `aarch64-apple-darwin` | `.dmg` |
| Linux | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `.AppImage`, `.deb` |

```
Steps per platform:
1. Install system deps (Linux: webkit2gtk, appindicator, etc.)
2. Install Rust stable toolchain
3. Setup pnpm + Node.js 24
4. pnpm install --frozen-lockfile
5. Download the sidecar web assets, bundle native modules
6. tauri-action → build + upload to the draft GitHub Release
```

Binaries are signed with `TAURI_SIGNING_PRIVATE_KEY` for auto-update verification. `tauri-action` generates `latest.json` automatically (`updaterJsonKeepUniversal: true` — now inert with a single macOS arch); there is no separate `generate-updater` job.

### Job 5: verify-release

Fetches the still-draft release by id and asserts `latest.json` is **complete** — it contains every expected platform (`darwin-aarch64`, `linux-x86_64`) with a non-empty signature and URL, and every installer asset exists. Fails the run otherwise, so an incomplete release can never be promoted.

### Job 6: promote-release

Flips the verified draft to a public (`--draft=false`) release, making it the "latest" that the updater endpoint serves.

## npm authentication (trusted publishing)

`publish-mcp` publishes `@cognistore/mcp-server` with **npm trusted publishing (OIDC)** — there is no npm token to store or rotate. The job's `id-token: write` permission lets GitHub mint a short-lived OIDC token for the run, and npm exchanges it for publish rights because the package's Trusted Publisher on npmjs.com is set to `Sithion/cognistore` + workflow `publish.yml` with "npm publish" allowed.

Keep in mind:
- Renaming `publish.yml`, renaming/transferring the repository, or publishing from another workflow breaks the trust — update the Trusted Publisher on npmjs.com first.
- It needs npm >= 11.5.1 on a GitHub-hosted runner (the job checks the npm version). `pnpm publish` (pnpm 9) delegates to the npm CLI, so the exchange happens there.
- Provenance is attached automatically.

## Secrets

| Secret | Used By | Purpose |
|--------|---------|---------|
| `GITHUB_TOKEN` | create-release, publish-tauri | Auto-provided, creates releases |
| `TAURI_SIGNING_PRIVATE_KEY` | publish-tauri | Sign binaries for auto-update |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | publish-tauri | Key password (empty if unset) |

## Version Management

### Bumping Versions

Use the version bump script:

```bash
pnpm bump 1.0.0
```

This updates:
- All 8 `package.json` files (root + apps + packages)
- `apps/dashboard/src-tauri/Cargo.toml`

### Release Flow

```
1. pnpm bump <version>
2. Commit + push to feature branch
3. Open PR → CI validates
4. Merge to main → Publish workflow:
   a. npm publish (if version is new)
   b. Create GitHub Release
   c. Build + upload binaries (macOS dmg, Linux AppImage/deb)
```

### Idempotent Publishing

Both npm publish and GitHub Release creation check if the version already exists before attempting to create. Re-running the workflow on the same version is safe — it will skip already-published artifacts.

## Agent Test Battery

**File:** `scripts/test-agents.sh`

An end-to-end test script that validates MCP tool behavior across all supported AI clients. This is a local test — not part of CI — used to verify that tool changes work correctly before release.

### What It Does

```
1. Build all packages locally (pnpm build)
2. Spin up a Docker-based Ollama instance for isolated embedding generation
3. Create a temporary local SQLite database
4. Swap MCP configs for Claude Code, Copilot, and OpenCode to point at the local build
5. Run tool-level tests (addKnowledge, getKnowledge, updateKnowledge, deleteKnowledge, plans, etc.)
6. Validate similarity scores and response correctness
7. Restore all original MCP configurations on completion (cleanup runs even on failure)
```

### Usage

```bash
./scripts/test-agents.sh
```

### Requirements

- Docker (for Ollama container)
- pnpm and Node.js 24
- Claude Code, Copilot, or OpenCode CLI installed (tests only the clients found on the system)

### Cleanup

The script traps EXIT and restores original MCP configs from backups, ensuring that even if tests fail, the user's environment is not left in a broken state.

## Related Files

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | PR validation |
| `.github/workflows/publish.yml` | Release pipeline |
| `apps/mcp-server/tsup.config.ts` | MCP server bundler config |
| `apps/dashboard/scripts/bundle-sidecar.mjs` | Sidecar preparation for Tauri build (runs instruction compiler, copies templates + plugins) |
| `apps/dashboard/templates/configs/compile-instructions.mjs` | Compiles `_base-instructions.md` to platform-specific instruction files |
| `scripts/bump-version.sh` | Cross-package version bump |
| `scripts/test-agents.sh` | Agent test battery (local, Docker-based) |
| `scripts/repair-embeddings.mjs` | Offline embedding-index repair — see [Recovery](./recovery.md) |
