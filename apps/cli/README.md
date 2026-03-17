# @ai-knowledge/cli

[![npm version](https://img.shields.io/npm/v/@ai-knowledge/cli.svg)](https://www.npmjs.com/package/@ai-knowledge/cli)

CLI tool for semantic knowledge management for AI agents. Installs and manages a local knowledge base powered by PostgreSQL (pgvector) and Ollama embeddings.

## Quick Start

```bash
npx @ai-knowledge/cli install
```

This will:
- Create `~/.ai-knowledge/` with Docker configuration
- Start PostgreSQL (pgvector) and Ollama containers
- Pull the embedding model (`all-minilm`)
- Configure MCP servers for Claude Code and GitHub Copilot

## Commands

| Command | Description |
|---------|-------------|
| `kb install` | Install infrastructure (Docker services, MCP config) |
| `kb uninstall` | Remove infrastructure and configuration |
| `kb add` | Add a knowledge entry |
| `kb search <query>` | Semantic search across knowledge |
| `kb update <id>` | Update a knowledge entry |
| `kb delete <id>` | Delete a knowledge entry |
| `kb tags` | List all tags |
| `kb health` | Check service health |
| `kb db:start` | Start Docker services |
| `kb db:stop` | Stop Docker services |

## Install Options

```bash
npx @ai-knowledge/cli install --no-dashboard   # Skip dashboard container
npx @ai-knowledge/cli install --skip-config     # Skip agent config injection
npx @ai-knowledge/cli install --verbose         # Show full Docker output
```

## Uninstall

```bash
npx @ai-knowledge/cli uninstall
```

## How It Works

Tags are vectorized with a local Ollama model (`all-minilm`), stored in PostgreSQL via pgvector, and searched by cosine similarity. Everything runs locally — no data leaves your machine.

## Links

- [GitHub Repository](https://github.com/Sithion/knowledge-base)

## License

MIT
