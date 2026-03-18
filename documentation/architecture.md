# Architecture

## System Overview

AI Knowledge Base is a semantic knowledge management system for AI agents. It stores knowledge entries with content and tags, vectorizes them using a local Ollama embedding model, and enables semantic search via cosine similarity on SQLite with sqlite-vec.

## Component Diagram (C4 Level 2)

```mermaid
graph TB
    subgraph "User Interfaces"
        App[Tauri Desktop App]
        MCP[MCP Server]
        SDK_EXT[External SDK Usage]
    end

    subgraph "App Internals"
        Dashboard[React Dashboard]
        Sidecar[Fastify Sidecar]
        SetupWizard[Setup Wizard]
    end

    subgraph "Core Packages"
        SDK[@ai-knowledge/sdk]
        Core[@ai-knowledge/core]
        Embeddings[@ai-knowledge/embeddings]
        Shared[@ai-knowledge/shared]
        Config[@ai-knowledge/config]
    end

    subgraph "Infrastructure (Native)"
        SQLite[(SQLite + sqlite-vec)]
        Ollama[Ollama Embedding Server]
    end

    App --> Dashboard
    App --> Sidecar
    App --> SetupWizard
    MCP --> SDK
    SDK_EXT --> SDK
    Sidecar --> SDK

    SDK --> Core
    SDK --> Embeddings
    Core --> Shared
    Embeddings --> Shared
    Config --> Shared

    Core --> SQLite
    Embeddings --> Ollama
```

## Data Flow

### Adding Knowledge

```
User/Agent -> SDK.addKnowledge(content, tags, type, scope, source)
    -> EmbeddingProvider.embed(tags.join(' '))
    -> Ollama HTTP API -> vector[384]
    -> Repository.create(entry + embedding)
    -> SQLite INSERT (sqlite-vec for vector storage)
```

### Searching Knowledge

```
User/Agent -> SDK.getKnowledge(query, options?)
    -> EmbeddingProvider.embed(query)
    -> Ollama HTTP API -> vector[384]
    -> Repository.searchBySimilarity(queryVector, options)
    -> SQLite: cosine similarity via sqlite-vec
    -> Ranked results (threshold > 0.3)
```

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Embedding target | Tags (not content) | Tags are concise semantic anchors; content can be long and noisy |
| Embedding model | all-minilm (384d) | Small (23MB), fast, good quality for short text |
| Similarity threshold | 0.3 | Tags produce lower similarity scores than full sentences |
| Database | SQLite + sqlite-vec | Zero-config, single file, no daemon, native vector ops |
| Ollama install | brew (macOS), curl (Linux) | No sudo required on macOS via Homebrew |
| App framework | Tauri v2 | Native desktop app, small binary, Rust backend |
| MCP distribution | npm (tsup bundle) | Workspace packages inlined, only native deps external |
| Dashboard | React + Fastify sidecar | Bundled inside Tauri app as sidecar process |

## Installation Architecture

### Tauri App Setup Wizard

```
Open AI Knowledge Base app
    -> Setup Wizard detects missing components
    -> Install Ollama (brew install ollama / curl)
    -> Start ollama serve
    -> Pull embedding model (all-minilm)
    -> Create SQLite database (~/.ai-knowledge/knowledge.db)
    -> Inject MCP configs (~/.claude/, ~/.copilot/)
    -> Install skills (Claude Code, GitHub Copilot)
    -> Navigate to Dashboard
```

### MCP Server Distribution

The MCP server is published to npm as `@ai-knowledge/mcp-server`. All workspace packages are bundled inline via tsup — only native dependencies (better-sqlite3, sqlite-vec, drizzle-orm) are external.

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

### Dashboard UI Components

```
App (Tauri)
├── SetupPage (wizard: install Ollama, create DB, configure MCP)
├── HomePage
│   ├── Search Bar (query + filters)
│   ├── TagBar (clickable tag chips)
│   ├── KnowledgeCard[] (entries with clickable tags)
│   └── FloatingAddButton (FAB -> modal)
├── StatsPage (charts, heatmap, system metrics)
└── InfrastructurePage (service status, repair, uninstall)
```
