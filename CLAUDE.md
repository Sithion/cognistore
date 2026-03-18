# AI Knowledge Base - Agent Rules

## Install/Uninstall Symmetry (MANDATORY)

Every change to the installation process (`apps/cli/src/services/installer.ts`) MUST be reviewed for its uninstall counterpart (`apps/cli/src/services/uninstaller.ts`), and vice-versa.

**Rule:** If the installer creates, copies, injects, or modifies anything, the uninstaller MUST remove or revert it. If the uninstaller is updated to clean something new, verify the installer actually creates it.

**Checklist — apply on every PR that touches install or uninstall:**

- [ ] Every file/directory created by install has a corresponding removal in uninstall
- [ ] Every config injection (markers, MCP entries, skills) has a corresponding cleanup
- [ ] New installer steps are reflected in the uninstaller's `TOTAL_STEPS` count
- [ ] Backup files (`.bak.*`) created during install/uninstall are cleaned up

**Reference mapping (keep updated):**

| Installer action | Uninstaller action |
|---|---|
| Create `~/.ai-knowledge/` directory | Remove directory recursively |
| Create `~/.ai-knowledge/knowledge.db` (SQLite + schema) | Removed with directory (or preserved with `--keep-data`) |
| Install Ollama via brew/curl (if missing) | Uninstall Ollama via `brew uninstall` or remove binary (prompted) |
| Start `ollama serve` (if not running) | Stop `ollama serve` via pkill (during uninstall) |
| Pull embedding model via Ollama API | Remove model via `ollama rm` (prompted) |
| Inject `~/.claude/CLAUDE.md` markers | Remove markers via `configManager.removeConfig` |
| Inject `~/.github/copilot-instructions.md` markers | Remove markers via `configManager.removeConfig` |
| Inject `~/.copilot/copilot-instructions.md` markers | Remove markers via `configManager.removeConfig` |
| Add `ai-knowledge` to `~/.claude/mcp-config.json` | Remove entry via `configManager.removeMcpEntry` |
| Add `ai-knowledge` to `~/.claude.json` | Remove entry via `configManager.removeMcpEntry` |
| Add `ai-knowledge` to `~/.copilot/mcp-config.json` | Remove entry via `configManager.removeMcpEntry` |
| Copy Claude skills to `~/.claude/skills/ai-knowledge-*/` | Remove skill directories |
| Copy Copilot skills to `~/.copilot/skills/ai-knowledge-*.md` | Remove skill files |
| Download + install Tauri .app to `/Applications/` + `xattr -cr` | Remove .app from `/Applications/` |

## Architecture (v0.5.0 — Docker-free + Tauri Dashboard)

- **Database**: SQLite + sqlite-vec (file at `~/.ai-knowledge/knowledge.db`)
- **Embeddings**: Ollama native (auto-installed via brew/curl)
- **Dashboard**: Tauri desktop app (webview + Fastify sidecar) or `kb dashboard` browser fallback
- **No Docker dependency**

## Path Resolution (Key Architecture)

Both `install` and `uninstall` commands use `apps/cli/src/utils/resolve-root.ts` to detect context:

| Function | Purpose |
|---|---|
| `resolvePackageRoot()` | Walks up from `import.meta.url` to find `package.json` with `@ai-knowledge/cli` |
| `resolveProjectRoot()` | Returns monorepo root if `docker/docker-compose.yml` exists, `undefined` for npx |
| `resolveTemplatesDir()` | Returns `<repo>/apps/cli/templates/` in repo, `<package>/templates/` via npx |

**Why:** tsup bundles all source into `dist/index.js`, making relative path traversals (`../../..`) unreliable. This utility finds paths by marker files instead of counting directory levels.
