-- cognistore:atomic-script
ALTER TABLE knowledge_entries ADD COLUMN content_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_knowledge_content_hash
ON knowledge_entries(content_hash, id);

CREATE TRIGGER IF NOT EXISTS knowledge_content_hash_invalidate
AFTER UPDATE OF title, content ON knowledge_entries
WHEN NEW.content_hash IS OLD.content_hash AND OLD.content_hash IS NOT NULL
BEGIN
  UPDATE knowledge_entries SET content_hash = NULL WHERE id = NEW.id;
END;
