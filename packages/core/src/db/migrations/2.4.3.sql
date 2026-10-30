-- cognistore:atomic-script
CREATE TABLE IF NOT EXISTS token_usage_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
INSERT OR IGNORE INTO token_usage_meta(key, value)
VALUES ('pruned_before', '');

CREATE TABLE IF NOT EXISTS token_usage_daily (
  day TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT '',
  project_is_null INTEGER NOT NULL CHECK(project_is_null IN (0, 1)),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, source, model, project, project_is_null)
) WITHOUT ROWID;

INSERT INTO token_usage_daily (
  day, source, model, project, project_is_null,
  input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, messages
)
SELECT substr(occurred_at, 1, 10), source, model, COALESCE(project, ''),
       project IS NULL,
       SUM(input_tokens), SUM(output_tokens),
       SUM(cache_creation_tokens), SUM(cache_read_tokens), COUNT(*)
FROM token_usage
GROUP BY substr(occurred_at, 1, 10), source, model,
         COALESCE(project, ''), project IS NULL;

CREATE TRIGGER IF NOT EXISTS token_usage_daily_insert
AFTER INSERT ON token_usage
WHEN NEW.occurred_at >= COALESCE(
  (SELECT value FROM token_usage_meta WHERE key = 'pruned_before'), ''
)
BEGIN
  INSERT INTO token_usage_daily (
    day, source, model, project, project_is_null,
    input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, messages
  )
  VALUES (
    substr(NEW.occurred_at, 1, 10), NEW.source, NEW.model,
    COALESCE(NEW.project, ''), NEW.project IS NULL,
    NEW.input_tokens, NEW.output_tokens,
    NEW.cache_creation_tokens, NEW.cache_read_tokens, 1
  )
  ON CONFLICT(day, source, model, project, project_is_null) DO UPDATE SET
    input_tokens = input_tokens + excluded.input_tokens,
    output_tokens = output_tokens + excluded.output_tokens,
    cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
    cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
    messages = messages + 1;
END;

CREATE INDEX IF NOT EXISTS idx_knowledge_updated_at
ON knowledge_entries(updated_at);
