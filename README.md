# AI Knowledge Base

[![CI](https://github.com/Sithion/knowledge-base/actions/workflows/ci.yml/badge.svg)](https://github.com/Sithion/knowledge-base/actions/workflows/ci.yml)
[![Publish](https://github.com/Sithion/knowledge-base/actions/workflows/publish.yml/badge.svg)](https://github.com/Sithion/knowledge-base/actions/workflows/publish.yml)
[![npm](https://img.shields.io/npm/v/@ai-knowledge/mcp-server)](https://www.npmjs.com/package/@ai-knowledge/mcp-server)
[![GitHub Release](https://img.shields.io/github/v/release/Sithion/knowledge-base)](https://github.com/Sithion/knowledge-base/releases)

Semantic knowledge management system for AI agents. Desktop app with native Ollama + SQLite vector storage. Works as an MCP plugin for Claude Code and GitHub Copilot.

## Quick Start

1. Download the app from [GitHub Releases](https://github.com/Sithion/knowledge-base/releases)
2. Open the `.dmg` (macOS) or `.AppImage` (Linux) and install
3. The setup wizard will automatically:
   - Install Ollama (via Homebrew on macOS)
   - Create the SQLite database (`~/.ai-knowledge/knowledge.db`)
   - Pull the embedding model (`all-minilm`)
   - Configure MCP servers for Claude Code and GitHub Copilot
   - Install skills for knowledge capture and query

## Architecture (v0.6.0)

```
knowledge-base/
├── apps/
│   ├── dashboard/        # Tauri desktop app (React + Fastify sidecar)
│   └── mcp-server/       # MCP server (npm package)
├── packages/
│   ├── shared/           # Types, constants, validation schemas
│   ├── core/             # SQLite + sqlite-vec, repositories
│   ├── embeddings/       # Ollama embedding client
│   ├── sdk/              # Public SDK (main entry point)
│   └── config/           # Config injection (Claude, Copilot)
```

## Tech Stack

- **App**: Tauri v2 (Rust + WebView)
- **Frontend**: React 19 + Vite
- **Backend**: Fastify (bundled as sidecar)
- **Database**: SQLite + sqlite-vec (local file)
- **Embeddings**: Ollama (native, auto-installed)
- **ORM**: Drizzle
- **Monorepo**: Turborepo + pnpm

## MCP Server

The MCP server is published to npm and configured automatically by the app:

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

### MCP Tools

| Tool | Description |
|------|-------------|
| `addKnowledge` | Store knowledge with semantic embedding |
| `getKnowledge` | Semantic search across entries |
| `updateKnowledge` | Update entry (re-embeds if content changes) |
| `deleteKnowledge` | Delete by ID |
| `listTags` | List all unique tags |
| `healthCheck` | Check database + Ollama status |

## Development

```bash
pnpm install
pnpm build
pnpm dev --filter @ai-knowledge/dashboard
```

## Publishing

On merge to `main`, the publish pipeline runs two jobs in parallel:
- **publish-mcp**: Publishes `@ai-knowledge/mcp-server` to npm
- **publish-tauri**: Builds DMG (macOS arm64 + x64) and AppImage/deb (Linux) → GitHub Releases
