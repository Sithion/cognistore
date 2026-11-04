-- cognistore:atomic-script
ALTER TABLE knowledge_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'archived', 'trashed'));
ALTER TABLE knowledge_entries ADD COLUMN superseded_by TEXT;
ALTER TABLE knowledge_entries ADD COLUMN curated_at TEXT;
ALTER TABLE knowledge_entries ADD COLUMN trashed_at TEXT;

CREATE TABLE curation_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger TEXT NOT NULL,
  model TEXT NOT NULL,
  budget TEXT NOT NULL DEFAULT '{}',
  stats TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'paused', 'completed', 'failed')),
  cursor TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT
);

CREATE TABLE curation_actions (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  entry_ids TEXT NOT NULL DEFAULT '[]',
  before_snapshot TEXT NOT NULL DEFAULT '{}',
  after_snapshot TEXT NOT NULL DEFAULT '{}',
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed', 'applied', 'undone', 'rejected')),
  payload TEXT NOT NULL DEFAULT '{}',
  expected_versions TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  undo_expires_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE curation_verdicts (
  id TEXT PRIMARY KEY,
  entry_a_id TEXT NOT NULL,
  entry_b_id TEXT NOT NULL,
  entry_a_content_hash TEXT NOT NULL,
  entry_b_content_hash TEXT NOT NULL,
  entry_a_version INTEGER NOT NULL,
  entry_b_version INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  confidence REAL,
  reason TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  judged_at TEXT NOT NULL,
  CHECK(entry_a_id < entry_b_id),
  UNIQUE(entry_a_id, entry_b_id, entry_a_content_hash, entry_b_content_hash, entry_a_version, entry_b_version)
);

CREATE TABLE curation_activity (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  last_seen_at TEXT
);
INSERT INTO curation_activity(singleton, last_seen_at) VALUES (1, NULL);

CREATE INDEX idx_knowledge_active_scope_updated ON knowledge_entries(scope, updated_at, id) WHERE status = 'active';
CREATE INDEX idx_knowledge_active_scope_hash ON knowledge_entries(scope, content_hash, id) WHERE status = 'active';
CREATE INDEX idx_knowledge_status_trashed ON knowledge_entries(status, trashed_at, id);
CREATE INDEX idx_knowledge_status_curated ON knowledge_entries(status, curated_at, id);
CREATE INDEX idx_curation_actions_run ON curation_actions(run_id, created_at, id);
CREATE INDEX idx_curation_actions_status_created ON curation_actions(status, created_at, id);
CREATE INDEX idx_curation_runs_status_updated ON curation_runs(status, updated_at, id);
CREATE INDEX idx_curation_verdicts_pair ON curation_verdicts(entry_a_id, entry_b_id);
CREATE UNIQUE INDEX idx_curation_actions_idempotency ON curation_actions(idempotency_key) WHERE idempotency_key IS NOT NULL;

UPDATE knowledge_entries
SET status = 'superseded', superseded_by = substr(content, 16, instr(substr(content, 16), ']') - 1), curated_at = updated_at
WHERE substr(content, 1, 15) = '[SUPERSEDED by '
  AND instr(substr(content, 16), ']') > 0
  AND substr(content, 16, instr(substr(content, 16), ']') - 1) != id
  AND EXISTS (
    SELECT 1 FROM knowledge_entries target
    WHERE target.id = substr(knowledge_entries.content, 16, instr(substr(knowledge_entries.content, 16), ']') - 1)
      AND target.id != knowledge_entries.id AND target.type != 'system'
      AND NOT EXISTS (SELECT 1 FROM json_each(target.tags) WHERE value = 'keep')
  )
  AND type != 'system'
  AND NOT EXISTS (SELECT 1 FROM json_each(knowledge_entries.tags) WHERE value = 'keep');

-- Round 10: carry the pending legacy cleanup candidates into the curation queue.
-- Legacy rows have no entry snapshots, so they enter as informational flag
-- actions (the suggested change is kept in the payload); the next curation run
-- re-proposes executable actions. Idempotent through the unique idempotency key.
INSERT OR IGNORE INTO curation_actions(id, kind, actor, entry_ids, payload, status, idempotency_key, created_at, updated_at)
SELECT lower(hex(randomblob(16))), 'flag', 'legacy-cleanup', c.entry_ids,
  json_object('reason', 'Legacy cleanup candidate (' || c.category || ')',
              'suggestedKind', CASE c.category WHEN 'duplicate_group' THEN 'merge' ELSE 'trash' END,
              'legacy', json_object('candidateId', c.id, 'reportId', c.report_id, 'category', c.category)),
  'proposed', 'legacy-cleanup:' || c.id, c.updated_at, c.updated_at
FROM cleanup_candidates c
WHERE c.status = 'pending' AND json_valid(c.entry_ids) AND json_array_length(c.entry_ids) > 0;
