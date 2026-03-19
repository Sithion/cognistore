-- v0.9.0: Separate plans table, plan tasks, title on knowledge_entries

-- New column on knowledge_entries
ALTER TABLE knowledge_entries ADD COLUMN title TEXT NOT NULL DEFAULT '';

-- Plans (separate entity from knowledge)
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'completed', 'archived')),
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_scope ON plans(scope);

-- Plan relations (links plans to knowledge entries)
CREATE TABLE IF NOT EXISTS plan_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK(relation_type IN ('input', 'output')),
  created_at TEXT NOT NULL,
  UNIQUE(plan_id, knowledge_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_plan_relations_plan ON plan_relations(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_relations_knowledge ON plan_relations(knowledge_id);

-- Plan tasks (todo list per plan)
CREATE TABLE IF NOT EXISTS plan_tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
  notes TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_plan ON plan_tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_status ON plan_tasks(status);
