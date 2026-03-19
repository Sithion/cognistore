-- v0.8.0: Base schema
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  source TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  confidence_score REAL NOT NULL DEFAULT 1.0,
  related_ids TEXT,
  agent_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_type ON knowledge_entries(type);
CREATE INDEX IF NOT EXISTS idx_scope ON knowledge_entries(scope);

CREATE TABLE IF NOT EXISTS operations_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL CHECK(operation IN ('read', 'write')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_created_at ON operations_log(created_at);
CREATE INDEX IF NOT EXISTS idx_ops_operation ON operations_log(operation);
