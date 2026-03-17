# AI Knowledge Base

Semantic knowledge management system for AI agents. Works as an MCP plugin (Claude Code, Copilot) or as an npm package in any TypeScript project.

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/knowledge-base.git
cd knowledge-base
./scripts/install.sh
```

The install script automatically:
1. Detects your OS (macOS/Linux)
2. Installs Docker if not present (Colima on macOS, Docker Engine on Linux)
3. Starts PostgreSQL (pgvector), Ollama, and the Dashboard
4. Pulls the embedding model (`all-minilm`)
5. Prints service URLs when ready

## Services

| Service | Port | Description |
|---------|------|-------------|
| Dashboard | `3847` | Web UI for browsing, searching, and managing knowledge |
| PostgreSQL | `5433` | Database with pgvector for semantic search |
| Ollama | `11435` | Local embedding model server |

## Architecture

```
knowledge-base/
├── apps/
│   ├── cli/              # CLI tool
│   ├── dashboard/        # Web dashboard (React + Fastify)
│   └── mcp-server/       # MCP server for Claude Code / Copilot
├── packages/
│   ├── shared/           # Types, constants, validation schemas
│   ├── core/             # Database, repositories, services
│   ├── embeddings/       # Ollama embedding client
│   └── sdk/              # Public SDK (main entry point)
├── docker/
│   ├── docker-compose.yml
│   ├── init/             # SQL schema (runs on first start)
│   └── ollama/           # Model pull scripts
└── scripts/
    └── install.sh        # Automated installer
```

## Usage

### As MCP Plugin (Claude Code)

Add to `~/.claude/mcp-config.json`:

```json
{
  "mcpServers": {
    "ai-knowledge": {
      "type": "stdio",
      "command": "node",
      "args": ["path/to/knowledge-base/apps/mcp-server/dist/index.js"],
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
// Returns entries ranked by cosine similarity

await sdk.close();
```

## How It Works

1. **Adding knowledge**: Content and tags are required. Tags are joined into a single string and vectorized using the local Ollama embedding model (`all-minilm`, 384 dimensions). The embedding is stored alongside the entry in PostgreSQL via pgvector.

2. **Searching knowledge**: The query text is vectorized with the same model and compared against stored tag embeddings using cosine similarity. Results are ranked by similarity score (threshold: 0.3).

3. **Everything is local**: No data leaves your machine. The embedding model runs locally via Ollama, and the database is a local PostgreSQL instance.

## Development

```bash
# Install dependencies
pnpm install

# Start infrastructure
docker-compose -f docker/docker-compose.yml up -d

# Build all packages
pnpm build

# Run dashboard in dev mode
pnpm dev --filter @ai-knowledge/dashboard
```

## Docker Profiles

```bash
# Core only (PostgreSQL + Ollama)
docker-compose -f docker/docker-compose.yml up -d

# Full stack (+ Dashboard)
docker-compose -f docker/docker-compose.yml --profile dashboard up -d
```

## Tech Stack

- **Monorepo**: Turborepo + pnpm
- **Language**: TypeScript (ESM)
- **Database**: PostgreSQL 17 + pgvector
- **Embeddings**: Ollama (all-minilm, 384 dimensions)
- **ORM**: Drizzle
- **Dashboard**: React 19 + Vite + Fastify
- **Validation**: Zod
- **i18n**: react-i18next (EN, ES, PT)

