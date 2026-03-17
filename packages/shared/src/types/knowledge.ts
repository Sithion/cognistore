export enum KnowledgeType {
  DECISION = 'decision',
  PATTERN = 'pattern',
  FIX = 'fix',
  CONSTRAINT = 'constraint',
  GOTCHA = 'gotcha',
}

export interface KnowledgeEntry {
  id: string;
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
  database: { connected: boolean; error?: string };
  ollama: { connected: boolean; model?: string; error?: string };
  docker: { running: boolean; containers: { name: string; status: string }[] };
}
