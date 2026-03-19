<div align="center">

# AI Knowledge Base

**Semantic knowledge management for AI coding agents.**

Store, search, and retrieve knowledge using local vector embeddings — directly from your AI assistant.

[![CI](https://github.com/Sithion/knowledge-base/actions/workflows/ci.yml/badge.svg)](https://github.com/Sithion/knowledge-base/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ai-knowledge/mcp-server)](https://www.npmjs.com/package/@ai-knowledge/mcp-server)
[![GitHub Release](https://img.shields.io/github/v/release/Sithion/knowledge-base)](https://github.com/Sithion/knowledge-base/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Download](#quick-start) · [Features](#features) · [MCP Integration](#mcp-integration) · [Development](#development)

</div>

---

## Overview

AI Knowledge Base is a desktop application that gives your AI coding agents a persistent, searchable memory. It runs entirely on your machine — no cloud, no API keys, no data leaving your laptop.

The app acts as an [MCP](https://modelcontextprotocol.io/) server for **Claude Code** and **GitHub Copilot**, allowing your AI assistant to store and retrieve knowledge with semantic search powered by local embeddings.

## Features

- **Local-first** — All data stays on your machine. SQLite database with vector search via `sqlite-vec`.
- **Semantic search** — Find knowledge by meaning, not just keywords. Powered by Ollama embeddings running natively.
- **MCP integration** — Works as a plugin for Claude Code and GitHub Copilot out of the box.
- **Zero configuration** — The setup wizard handles everything: Ollama, database, model downloads, and MCP config injection.
- **Desktop dashboard** — Browse, search, and manage your knowledge base through the built-in UI.
- **Tagging system** — Organize entries with tags for structured retrieval.
- **Cross-platform** — macOS (`.dmg`) and Linux (`.AppImage`, `.deb`).

## Quick Start

### 1. Download

Grab the latest release for your platform from [GitHub Releases](https://github.com/Sithion/knowledge-base/releases).

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

1. Install [Ollama](https://ollama.com) (via Homebrew on macOS)
2. Create the local SQLite database at `~/.ai-knowledge/knowledge.db`
3. Pull the `all-minilm` embedding model
4. Configure MCP servers for Claude Code and GitHub Copilot
5. Install AI skills for knowledge capture and retrieval

Once complete, your AI assistant can immediately start storing and querying knowledge.

## MCP Integration

The MCP server is published to npm and configured automatically by the desktop app. If you prefer manual setup:

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

| Tool | Description |
|------|-------------|
| `addKnowledge` | Store a knowledge entry with automatic semantic embedding |
| `getKnowledge` | Search across entries using natural language queries |
| `updateKnowledge` | Update an existing entry (re-embeds if content changes) |
| `deleteKnowledge` | Remove an entry by ID |
| `listTags` | List all unique tags in the knowledge base |
| `healthCheck` | Verify database and Ollama connectivity |

## Architecture

```
knowledge-base/
├── apps/
│   ├── dashboard/          # Tauri v2 desktop app (React + Fastify sidecar)
│   └── mcp-server/         # MCP server (published to npm)
├── packages/
│   ├── shared/             # Types, constants, validation schemas
│   ├── core/               # SQLite + sqlite-vec, data repositories
│   ├── embeddings/         # Ollama embedding client
│   ├── sdk/                # Public SDK (main entry point for consumers)
│   └── config/             # Config injection (Claude, Copilot)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 (Rust + WebView) |
| Frontend | React 19 + Vite |
| Backend sidecar | Fastify |
| Database | SQLite + sqlite-vec |
| Embeddings | Ollama (native, auto-installed) |
| ORM | Drizzle |
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
git clone https://github.com/Sithion/knowledge-base.git
cd knowledge-base

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run the dashboard in dev mode
pnpm dev --filter @ai-knowledge/dashboard
```

### Publishing

On merge to `main`, the CI pipeline runs two jobs in parallel:

- **publish-mcp** — Publishes `@ai-knowledge/mcp-server` to npm
- **publish-tauri** — Builds platform binaries and uploads them to GitHub Releases

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Commit your changes
4. Push to the branch and open a Pull Request

## License

[MIT](LICENSE)
