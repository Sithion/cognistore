# AI Knowledge Base

[![CI](https://github.com/<OWNER>/knowledge-base/actions/workflows/ci.yml/badge.svg)](https://github.com/<OWNER>/knowledge-base/actions/workflows/ci.yml)

Semantic knowledge management system for AI agents. Works as an MCP plugin (Claude Code, Copilot) or as an npm package in any TypeScript project.

## Quick Start

### Option 1: npx (Recommended)

No clone required. Just run:

```bash
npx @ai-knowledge/cli install
```

This will:
1. Create `~/.ai-knowledge/` with Docker configuration
2. Start PostgreSQL (pgvector) and Ollama containers
3. Pull the embedding model (`all-minilm`)
4. Configure MCP servers for Claude Code and GitHub Copilot

### Option 2: Clone Repository

```bash
git clone https://github.com/<OWNER>/knowledge-base.git
cd knowledge-base
pnpm install && pnpm build
npx kb install
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Dashboard | `3847` | Web UI for browsing, searching, and managing knowledge |
| PostgreSQL | `5433` | Database with pgvector for semantic search |
| Ollama | `11435` | Local embedding model server |

## Dashboard

The web dashboard provides a central hub for managing knowledge entries:

- **Semantic search** with type and scope filters
- **Tag-based browsing** — clickable tag bar with toggle filtering
- **Add Knowledge modal** — quick entry creation from anywhere via the floating action button
- **Multi-language support** — English, Spanish, Portuguese (BR)
- **Statistics** — entry counts by type/scope, tag cloud

Access at `http://localhost:3847` after installation.

## Architecture

```
knowledge-base/
├── apps/
│   ├── cli/              # CLI tool (npx @ai-knowledge/cli)
│   ├── dashboard/        # Web dashboard (React + Fastify)
│   └── mcp-server/       # MCP server for Claude Code / Copilot
├── packages/
│   ├── shared/           # Types, constants, validation schemas
│   ├── core/             # Database, repositories, services
│   ├── embeddings/       # Ollama embedding client
│   └── sdk/              # Public SDK (main entry point)
├── docker/
│   ├── docker-compose.yml
│   └── init/             # SQL schema (runs on first start)
└── scripts/
    └── install.sh        # Legacy installer (use npx instead)
```

## Installation Details

### npx Installation Flow

```bash
npx @ai-knowledge/cli install [options]
```

**Options:**
- `--no-dashboard` — Skip dashboard container
- `--skip-config` — Skip agent config injection
- `--verbose` — Show full Docker output

**What happens:**
1. Creates `~/.ai-knowledge/` directory
2. Copies `docker-compose.yml`, init SQL, and `.env` to the install directory
3. Starts Docker services (PostgreSQL + Ollama)
4. Waits for health checks to pass
5. Pulls the `all-minilm` embedding model into Ollama
6. Configures MCP servers in:
   - `~/.claude/mcp-config.json` (Claude Code)
   - `~/.copilot/mcp-config.json` (GitHub Copilot)

**Uninstall:**
```bash
npx @ai-knowledge/cli uninstall
```

### Data Directory

All Docker configuration lives in `~/.ai-knowledge/`:

```
~/.ai-knowledge/
├── docker-compose.yml    # Docker services configuration
├── .env                  # Environment variables (ports, credentials)
└── init/
    └── 001-schema.sql    # Database schema
```

Docker volumes (`kb_pgdata`, `kb_ollama`) store persistent data independently.

## Usage

### As MCP Plugin (Claude Code)

After installation, the MCP server is automatically configured. It uses `npx` to run:

```json
{
  "mcpServers": {
    "ai-knowledge": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@ai-knowledge/mcp-server"],
      "env": {
        "DATABASE_URL": "postgresql://knowledge:knowledge_secret@localhost:5433/knowledge_base",
        "OLLAMA_HOST": "http://localhost:11435",
        "OLLAMA_MODEL": "all-minilm",
        "EMBEDDING_DIMENSIONS": "384"
      }
    }
  }
}
```

### As npm Package

```typescript
import { KnowledgeSDK } from '@ai-knowledge/sdk';

const sdk = new KnowledgeSDK({ autoStart: false });
await sdk.initialize();

// Add knowledge (tags are vectorized for semantic search)
await sdk.addKnowledge({
  content: 'Use parameterized queries to prevent SQL injection',
  tags: ['sql', 'security', 'postgresql'],
  type: 'pattern',
  scope: 'global',
  source: 'code-review',
});

// Semantic search (query is compared against tag embeddings)
const results = await sdk.getKnowledge('database security');

await sdk.close();
```

### CLI Commands

```bash
kb install          # Install infrastructure
kb uninstall        # Remove infrastructure
kb add              # Add a knowledge entry
kb search <query>   # Semantic search
kb tags             # List all tags
kb health           # Check service health
kb db:start         # Start Docker services
kb db:stop          # Stop Docker services
```

## How It Works

1. **Adding knowledge**: Content and tags are required. Tags are joined into a single string and vectorized using the local Ollama embedding model (`all-minilm`, 384 dimensions). The embedding is stored alongside the entry in PostgreSQL via pgvector.

2. **Searching knowledge**: The query text is vectorized with the same model and compared against stored tag embeddings using cosine similarity. Results are ranked by similarity score (threshold: 0.3).

3. **Everything is local**: No data leaves your machine. The embedding model runs locally via Ollama, and the database is a local PostgreSQL instance.

## Publishing

The CLI package (`@ai-knowledge/cli`) is automatically published to npm on every merge to `main`.

**Version management:** Edit `apps/cli/package.json` and increment the version number. The publish workflow will detect the change and publish it.

**Requirements:**
- All CI checks must pass (see [CI/CD Pipeline](documentation/ci-cd.md))
- npm organization and access token configured (see `.github/BRANCH_PROTECTION.md`)

For detailed CI/CD documentation, see [CI/CD and Publishing](documentation/ci-cd.md).

## Development

```bash
# Install dependencies
pnpm install

# Start infrastructure
docker compose -f docker/docker-compose.yml up -d

# Build all packages
pnpm build

# Run dashboard in dev mode
pnpm dev --filter @ai-knowledge/dashboard
```

## npm Packages

| Package | Description |
|---------|-------------|
| `@ai-knowledge/cli` | CLI tool — `npx @ai-knowledge/cli install` |
| `@ai-knowledge/mcp-server` | MCP server for Claude Code / Copilot |
| `@ai-knowledge/sdk` | TypeScript SDK for programmatic usage |

## Tech Stack

- **Monorepo**: Turborepo + pnpm
- **Language**: TypeScript (ESM)
- **Database**: PostgreSQL 17 + pgvector
- **Embeddings**: Ollama (all-minilm, 384 dimensions)
- **ORM**: Drizzle
- **Dashboard**: React 19 + Vite + Fastify
- **Validation**: Zod
- **i18n**: react-i18next (EN, ES, PT)
