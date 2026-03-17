# Architecture

## System Overview

AI Knowledge Base is a semantic knowledge management system designed for AI agents. It stores knowledge entries with content and tags, vectorizes the tags using a local embedding model, and enables semantic search via cosine similarity.

## Component Diagram (C4 Level 2)

```mermaid
graph TB
    subgraph "User Interfaces"
        CLI[CLI Tool]
        MCP[MCP Server]
        Dashboard[Web Dashboard]
        SDK_EXT[External SDK Usage]
    end

    subgraph "Core Packages"
        SDK[@ai-knowledge/sdk]
        Core[@ai-knowledge/core]
        Embeddings[@ai-knowledge/embeddings]
        Shared[@ai-knowledge/shared]
    end

    subgraph "Infrastructure (Docker)"
        PG[(PostgreSQL + pgvector)]
        Ollama[Ollama Embedding Server]
    end

    CLI --> SDK
    MCP --> SDK
    Dashboard --> SDK
    SDK_EXT --> SDK

    SDK --> Core
    SDK --> Embeddings
    Core --> Shared
    Embeddings --> Shared

    Core --> PG
    Embeddings --> Ollama
```

## Data Flow

### Adding Knowledge

```
User/Agent → SDK.addKnowledge(content, tags, type, scope, source)
    → EmbeddingProvider.embed(tags.join(' '))
    → Ollama HTTP API → vector[384]
    → Repository.create(entry + embedding)
    → PostgreSQL INSERT
```

### Searching Knowledge

```
User/Agent → SDK.getKnowledge(query, options?)
    → EmbeddingProvider.embed(query)
    → Ollama HTTP API → vector[384]
    → Repository.searchBySimilarity(queryVector, options)
    → PostgreSQL: cosine similarity via pgvector
    → Ranked results (threshold > 0.3)
```

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Embedding target | Tags (not content) | Tags are concise semantic anchors; content can be long and noisy |
| Embedding model | all-minilm (384d) | Small (23MB), fast, good quality for short text |
| Similarity threshold | 0.3 | Tags produce lower similarity scores than full sentences; 0.3 balances recall vs precision |
| Database | PostgreSQL + pgvector | Mature, reliable, native vector operations |
| Container runtime | Colima (macOS) | Free, lightweight alternative to Docker Desktop |
| Dashboard port | 3847 | Avoids common dev ports (3000-3100, 5173, 8080) |
| Docker profiles | Dashboard optional | Core (PG + Ollama) always starts; dashboard only with `--profile dashboard` |
| Schema init | Raw SQL (not Drizzle) | drizzle-kit has CJS resolution bugs with .js imports in ESM projects |
