export enum KnowledgeType {
  DECISION = 'decision',
  PATTERN = 'pattern',
  FIX = 'fix',
  CONSTRAINT = 'constraint',
  GOTCHA = 'gotcha',
}

export enum KnowledgeStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  embedding: number[];
  tags: string[];
  type: KnowledgeType;
  scope: string;
  source: string;
  version: number;
  expiresAt: Date | null;
  confidenceScore: number;
  relatedIds: string[] | null;
  agentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateKnowledgeInput {
  title: string;
  content: string;
  tags: string[];
  type: KnowledgeType;
  scope: string;
  source: string;
  confidenceScore?: number;
  expiresAt?: Date | null;
  relatedIds?: string[] | null;
  agentId?: string | null;
}

export interface UpdateKnowledgeInput {
  title?: string;
  content?: string;
  tags?: string[];
  type?: KnowledgeType;
  scope?: string;
  source?: string;
  confidenceScore?: number;
  expiresAt?: Date | null;
  relatedIds?: string[] | null;
  agentId?: string | null;
}

// ─── Plans (separate entity) ─────────────────────────────────

export interface Plan {
  id: string;
  title: string;
  content: string;
  tags: string[];
  scope: string;
  status: KnowledgeStatus;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlanInput {
  title: string;
  content: string;
  tags: string[];
  scope: string;
  source: string;
  status?: KnowledgeStatus;
}

export interface UpdatePlanInput {
  title?: string;
  content?: string;
  tags?: string[];
  scope?: string;
  status?: KnowledgeStatus;
  source?: string;
}

// ─── Plan Tasks ──────────────────────────────────────────────

export interface PlanTask {
  id: string;
  planId: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  notes: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlanTaskInput {
  planId: string;
  description: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  notes?: string | null;
  position?: number;
}

export interface UpdatePlanTaskInput {
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  notes?: string | null;
  position?: number;
}

// ─── Plan Relations ──────────────────────────────────────────

export interface PlanRelation {
  entry: KnowledgeEntry;
  relationType: 'input' | 'output';
}

// ─── Search ──────────────────────────────────────────────────

export interface SearchOptions {
  tags?: string[];
  type?: KnowledgeType;
  scope?: string;
  limit?: number;
  threshold?: number;
}

export interface SearchResult {
  entry: KnowledgeEntry;
  similarity: number;
}

export interface HealthStatus {
  database: { connected: boolean; path?: string; error?: string };
  ollama: { connected: boolean; model?: string; host?: string; error?: string };
}
