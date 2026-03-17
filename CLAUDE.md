# AI Knowledge Base - Agent Rules

## Architecture (v0.6.0 — App-first, Docker-free)

- **Entry point**: Tauri desktop app (macOS .dmg, Linux .AppImage/.deb)
- **Database**: SQLite + sqlite-vec (file at `~/.ai-knowledge/knowledge.db`)
- **Embeddings**: Ollama native (auto-installed by app on first launch)
- **Dashboard**: Tauri app (webview + Fastify sidecar)
- **MCP Server**: `@ai-knowledge/mcp-server` npm package (only npm package remaining)
- **CLI**: Deprecated (removed in v0.6.0)
- **Docker**: Removed entirely

## Setup / Uninstall Symmetry (MANDATORY)

The Tauri app's setup wizard creates resources; the uninstall button must remove them.

**Rule:** If setup creates, copies, injects, or modifies anything, uninstall MUST remove or revert it.

| Setup action | Uninstall action |
|---|---|
| Create `~/.ai-knowledge/` directory | Remove directory recursively |
| Create `~/.ai-knowledge/knowledge.db` (SQLite + schema) | Removed with directory |
| Install Ollama via brew/curl | Uninstall Ollama via brew uninstall or remove binary |
| Start `ollama serve` | Stop `ollama serve` via pkill |
| Pull embedding model via Ollama API | Remove model via `ollama rm` |
| Inject `~/.claude/CLAUDE.md` markers | Remove markers via ConfigManager |
| Inject `~/.github/copilot-instructions.md` markers | Remove markers via ConfigManager |
| Inject `~/.copilot/copilot-instructions.md` markers | Remove markers via ConfigManager |
| Add `ai-knowledge` to `~/.claude/mcp-config.json` | Remove entry via ConfigManager |
| Add `ai-knowledge` to `~/.claude.json` | Remove entry via ConfigManager |
| Add `ai-knowledge` to `~/.copilot/mcp-config.json` | Remove entry via ConfigManager |
| Copy Claude skills to `~/.claude/skills/ai-knowledge-*/` | Remove skill directories |
| Copy Copilot skills to `~/.copilot/skills/ai-knowledge-*.md` | Remove skill files |
| App installed in /Applications/ (macOS) | Self-delete via rmSync |

## Path Resolution

The Tauri sidecar sets environment variables for the Fastify server:
- `SQLITE_PATH` — path to SQLite database
- `OLLAMA_HOST` — Ollama API endpoint
- `DASHBOARD_DIST_PATH` — path to bundled frontend assets
- `TEMPLATES_PATH` — path to bundled skills/config templates
