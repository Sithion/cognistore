<div align="center">

# AI Knowledge Base

**Semantic knowledge management for AI coding agents.**

Store, search, and retrieve knowledge using local vector embeddings — directly from your AI assistant.

[![CI](https://github.com/Sithion/ai-knowledge/actions/workflows/ci.yml/badge.svg)](https://github.com/Sithion/ai-knowledge/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ai-knowledge/mcp-server)](https://www.npmjs.com/package/@ai-knowledge/mcp-server)
[![GitHub Release](https://img.shields.io/github/v/release/Sithion/ai-knowledge)](https://github.com/Sithion/ai-knowledge/releases)
[![License: BSL 1.1](https://img.shields.io/badge/License-BSL_1.1-yellow.svg)](LICENSE)

[Download](#quick-start) · [Features](#features) · [MCP Integration](#mcp-integration) · [Dashboard](#dashboard) · [Development](#development)

![AI Knowledge Base Dashboard](screenshot.png)

</div>

---

## Overview

AI Knowledge Base is a desktop application that gives your AI coding agents a persistent, searchable memory. It runs entirely on your machine — no cloud, no API keys, no data leaving your laptop.

The app acts as an [MCP](https://modelcontextprotocol.io/) server for **Claude Code**, **GitHub Copilot**, and **OpenCode**, allowing your AI assistant to store and retrieve knowledge with semantic search powered by local embeddings.

## Features

- **Local-first** — All data stays on your machine. SQLite database with vector search via `sqlite-vec`.
- **Semantic search** — Find knowledge by meaning, not just keywords. Powered by Ollama embeddings running natively.
- **MCP integration** — Works as a plugin for Claude Code, GitHub Copilot, and OpenCode out of the box.
- **Zero configuration** — The setup wizard handles everything: Ollama, database, model downloads, MCP config injection, and AI skills installation.
- **Desktop dashboard** — Browse, search, filter, and manage your knowledge base through the built-in UI with stats and charts.
- **Auto-update** — The app checks for updates every 30 minutes and installs them automatically.
- **Multi-language** — Dashboard available in English, Spanish, and Portuguese.
- **Cross-platform** — macOS (`.dmg`) and Linux (`.AppImage`, `.deb`).

## Quick Start

### 1. Download

Grab the latest release for your platform from [GitHub Releases](https://github.com/Sithion/ai-knowledge/releases).

| Platform | Format |
|----------|--------|
| macOS (Apple Silicon) | `.dmg` (arm64) |
| macOS (Intel) | `.dmg` (x64) |
| Linux | `.AppImage`, `.deb` |

### 2. Install

Open the downloaded file and drag the app to your Applications folder (macOS) or run the AppImage (Linux).

> **macOS users:** The app is not yet code-signed. If macOS reports the app is damaged, run:
> ```bash
> xattr -cr "/Applications/AI Knowledge Base.app"
> ```

### 3. Run the Setup Wizard

On first launch, the setup wizard will automatically:

1. Check and install [Node.js](https://nodejs.org/) v20
2. Install [Ollama](https://ollama.com) (via Homebrew on macOS, curl on Linux)
3. Start the Ollama service
4. Create the local SQLite database at `~/.ai-knowledge/knowledge.db`
5. Pull the `all-minilm` embedding model
6. Configure MCP servers and install AI skills for Claude Code, GitHub Copilot, and OpenCode
7. Mark setup as complete and open the dashboard

Once complete, your AI assistant can immediately start storing and querying knowledge.

## MCP Integration

The MCP server is published to npm and configured automatically by the desktop app.

### Supported Clients

| Client | MCP Config | Instructions |
|--------|-----------|-------------|
| Claude Code | `~/.claude/mcp-config.json` | `~/.claude/CLAUDE.md` |
| GitHub Copilot | `~/.copilot/mcp-config.json` | `~/.github/copilot-instructions.md` |
| OpenCode | `~/.config/opencode/opencode.json` | — |

### Manual Setup

If you prefer to configure the MCP server manually:

```json
{
  "mcpServers": {
    "ai-knowledge": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@ai-knowledge/mcp-server"]
    }
  }
}
```

### Available Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `addKnowledge` | Store a knowledge entry with automatic semantic embedding | `content`, `tags`, `type`, `scope`, `source` |
| `getKnowledge` | Search across entries using natural language queries | `query`, `tags`, `type`, `scope`, `limit`, `threshold` |
| `updateKnowledge` | Update an existing entry (re-embeds if content changes) | `id`, `content`, `tags` |
| `deleteKnowledge` | Remove an entry by ID | `id` |
| `listTags` | List all unique tags in the knowledge base | — |
| `healthCheck` | Verify database and Ollama connectivity | — |

### Knowledge Types

Entries are categorized by type for structured retrieval:

| Type | Use Case |
|------|----------|
| `decision` | Architecture choices, approach trade-offs |
| `pattern` | Code patterns, conventions, reusable solutions |
| `fix` | Bug fixes, error resolutions |
| `constraint` | Tool limitations, version-specific workarounds |
| `gotcha` | Unexpected behaviors, non-obvious pitfalls |

### AI Skills

The setup wizard installs skills with lifecycle hooks that enforce knowledge base usage:

- **ai-knowledge-query** — Hooks into `PreToolUse` to remind agents to query before making changes
- **ai-knowledge-capture** — Hooks into `Stop` to remind agents to capture findings before ending a session

Hooks are non-blocking (system messages only) and skip automatically when the agent is already using ai-knowledge tools.

## Dashboard

The desktop app includes a full dashboard with three main pages:

### Knowledge (Home)

- Semantic search with natural language queries
- Filter by type, scope, and tags
- Add new knowledge entries via modal form
- Auto-refresh with polling for new entries

### Stats

- Type and scope distribution charts (pie + bar)
- 15-day activity trend (area chart)
- 90-day contribution heatmap
- Metric cards: total entries, 24h/7d activity, database size
- Tag cloud visualization
- Configurable auto-refresh interval (Off / 1s / 10s / 30s / 1m / 5m)

### Monitoring

- Service health monitoring (Database, Ollama)
- Real-time status polling every 5 seconds
- Uninstall wizard with 3-step confirmation (removes all data, configs, and dependencies)

## Architecture

```
ai-knowledge/
├── apps/
│   ├── dashboard/          # Tauri v2 desktop app (React + Fastify sidecar)
│   └── mcp-server/         # MCP server (published to npm)
├── packages/
│   ├── shared/             # Types, constants, validation schemas
│   ├── core/               # SQLite + sqlite-vec, data repositories
│   ├── embeddings/         # Ollama embedding client
│   ├── sdk/                # Public SDK (main entry point for consumers)
│   └── config/             # Config injection (Claude, Copilot, OpenCode)
└── scripts/
    └── bump-version.sh     # Version bump script for all packages
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 (Rust + WebView) |
| Frontend | React 19 + Vite + Tailwind CSS 4 |
| State management | Redux Toolkit |
| Backend sidecar | Fastify |
| Database | SQLite + sqlite-vec |
| Embeddings | Ollama (native, auto-installed) |
| ORM | Drizzle |
| i18n | react-i18next (EN, ES, PT) |
| Charts | Recharts |
| Monorepo | Turborepo + pnpm |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) 9.x
- [Rust](https://rustup.rs/) (for Tauri builds)
- [Ollama](https://ollama.com) (for embedding generation)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/Sithion/ai-knowledge.git
cd ai-knowledge

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run the dashboard in dev mode
pnpm dev --filter @ai-knowledge/dashboard

# Run the Tauri app in dev mode
pnpm tauri:dev --filter @ai-knowledge/dashboard
```

### Version Bump

To bump the version across all packages at once:

```bash
pnpm bump <new-version>
# Example: pnpm bump 0.8.0
```

This updates version in all `package.json` files, `Cargo.toml`, and the `LICENSE`.

### Publishing

On merge to `main`, the CI pipeline runs two jobs in parallel:

- **publish-mcp** — Publishes `@ai-knowledge/mcp-server` to npm
- **publish-tauri** — Builds platform binaries (macOS dmg, Linux AppImage/deb) and uploads them to GitHub Releases

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Commit your changes
4. Push to the branch and open a Pull Request

## License

[BSL 1.1](LICENSE) — Free for non-commercial use. Converts to Apache 2.0 on 2030-03-18.
