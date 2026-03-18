# AI Knowledge Base - Agent Rules

## Install/Uninstall Symmetry (MANDATORY)

Every change to the installation process (`apps/cli/src/services/installer.ts`) MUST be reviewed for its uninstall counterpart (`apps/cli/src/services/uninstaller.ts`), and vice-versa.

**Rule:** If the installer creates, copies, injects, or modifies anything, the uninstaller MUST remove or revert it. If the uninstaller is updated to clean something new, verify the installer actually creates it.

**Checklist — apply on every PR that touches install or uninstall:**

- [ ] Every file/directory created by install has a corresponding removal in uninstall
- [ ] Every config injection (markers, MCP entries, skills) has a corresponding cleanup
- [ ] Every Docker resource (container, volume, network, image) is stopped/removed
- [ ] The `composePath` in uninstaller matches the path used by the installer to start containers
- [ ] New installer steps are reflected in the uninstaller's `TOTAL_STEPS` count
- [ ] Backup files (`.bak.*`) created during install/uninstall are cleaned up

**Reference mapping (keep updated):**

| Installer action | Uninstaller action |
|---|---|
| Create `~/.ai-knowledge/` (compose, .env, init/) | Remove directory recursively |
| Start containers (kb-postgres, kb-ollama, kb-dashboard, kb-traefik) | `docker compose down` with correct compose path |
| Create volumes (kb_pgdata, kb_ollama) | Remove with `-v` flag (unless `--keep-data`) |
| Pull `pgvector/pgvector:pg17` image | `docker rmi` in DOCKER_IMAGES array |
| Pull `ollama/ollama:latest` image | `docker rmi` in DOCKER_IMAGES array |
| Pull `traefik:v3.3` image | `docker rmi` in DOCKER_IMAGES array |
| Pull `ghcr.io/sithion/kb-dashboard:latest` image | `docker rmi` in DOCKER_IMAGES array |
| Inject `~/.claude/CLAUDE.md` markers | Remove markers via `configManager.removeConfig` |
| Inject `~/.github/copilot-instructions.md` markers | Remove markers via `configManager.removeConfig` |
| Inject `~/.copilot/copilot-instructions.md` markers | Remove markers via `configManager.removeConfig` |
| Add `ai-knowledge` to `~/.claude/mcp-config.json` | Remove entry via `configManager.removeMcpEntry` |
| Add `ai-knowledge` to `~/.claude.json` | Remove entry via `configManager.removeMcpEntry` |
| Add `ai-knowledge` to `~/.copilot/mcp-config.json` | Remove entry via `configManager.removeMcpEntry` |
| Copy Claude skills to `~/.claude/skills/ai-knowledge-*/` | Remove skill directories |
| Copy Copilot skills to `~/.copilot/skills/ai-knowledge-*.md` | Remove skill files |

## Path Resolution (Key Architecture)

Both `install` and `uninstall` commands use `apps/cli/src/utils/resolve-root.ts` to detect context:

| Function | Purpose |
|---|---|
| `resolvePackageRoot()` | Walks up from `import.meta.url` to find `package.json` with `@ai-knowledge/cli` |
| `resolveProjectRoot()` | Returns monorepo root if `docker/docker-compose.yml` exists, `undefined` for npx |
| `resolveTemplatesDir()` | Returns `<repo>/apps/cli/templates/` in repo, `<package>/templates/` via npx |

**Why:** tsup bundles all source into `dist/index.js`, making relative path traversals (`../../..`) unreliable. This utility finds paths by marker files instead of counting directory levels.
