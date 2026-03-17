-- AI Knowledge Base Schema
-- Auto-executed by PostgreSQL on first container start via /docker-entrypoint-initdb.d/

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding vector(384),
  tags TEXT[] NOT NULL DEFAULT '{}',
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  source TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ,
  confidence_score DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  related_ids UUID[],
  agent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tags ON knowledge_entries USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_type ON knowledge_entries (type);
CREATE INDEX IF NOT EXISTS idx_scope ON knowledge_entries (scope);
CREATE INDEX IF NOT EXISTS idx_embedding ON knowledge_entries USING hnsw (embedding vector_cosine_ops);
