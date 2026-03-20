import { KnowledgeRepository } from '../repositories/knowledge.repository.js';
import type {
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
  SearchOptions,
  KnowledgeEntry,
  SearchResult,
  Plan,
  CreatePlanInput,
  UpdatePlanInput,
  PlanTask,
} from '@cognistore/shared';

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export class KnowledgeService {
  constructor(
    private repository: KnowledgeRepository,
    private embeddingProvider: EmbeddingProvider
  ) {}

  private logOp(op: 'read' | 'write') {
    try { this.repository.logOperation(op); } catch { /* silent */ }
  }

  async add(input: CreateKnowledgeInput): Promise<KnowledgeEntry> {
    const tagsText = input.tags.join(' ');
    const embedding = await this.embeddingProvider.embed(tagsText);
    const entry = await this.repository.create({ ...input, embedding });
    this.logOp('write');
    return this.toKnowledgeEntry(entry);
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddingProvider.embed(query);
    const results = await this.repository.searchBySimilarity(queryEmbedding, options);
    this.logOp('read');
    return results.map((r) => ({
      entry: this.toKnowledgeEntry(r.entry),
      similarity: r.similarity,
    }));
  }

  async getById(id: string): Promise<KnowledgeEntry | null> {
    const entry = await this.repository.findById(id);
    return entry ? this.toKnowledgeEntry(entry) : null;
  }

  async update(id: string, updates: UpdateKnowledgeInput): Promise<KnowledgeEntry | null> {
    let embedding: number[] | undefined;
    if (updates.tags && updates.tags.length > 0) {
      embedding = await this.embeddingProvider.embed(updates.tags.join(' '));
    }
    const entry = await this.repository.update(id, { ...updates, embedding });
    if (entry) this.logOp('write');
    return entry ? this.toKnowledgeEntry(entry) : null;
  }

  async delete(id: string): Promise<boolean> {
    const entry = await this.repository.delete(id);
    if (entry) this.logOp('write');
    return entry !== null;
  }

  async listAll() {
    const entries = await this.repository.listAll();
    return entries.map((e) => this.toKnowledgeEntry(e));
  }

  async listScopes(): Promise<string[]> {
    return this.repository.listScopes();
  }

  async bulkDelete(ids: string[]): Promise<{ deleted: number; errors: string[] }> {
    let deleted = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        // Guard: skip system knowledge entries
        const entry = await this.repository.findById(id);
        if (entry?.type === 'system') {
          errors.push(`Skipped ${id}: system knowledge cannot be deleted`);
          continue;
        }
        const result = await this.repository.delete(id);
        if (result) {
          deleted++;
          this.logOp('write');
        }
      } catch (err) {
        errors.push(`Failed to delete ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { deleted, errors };
  }

  async importKnowledge(entries: CreateKnowledgeInput[]): Promise<{ imported: number; skipped: number; errors: string[] }> {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Build hash set of existing entries for duplicate detection
    const existing = await this.repository.listAll();
    const existingHashes = new Set<string>();
    for (const e of existing) {
      const hash = this.hashContent((e.title ?? '') + e.content);
      existingHashes.add(hash);
    }

    for (const entry of entries) {
      try {
        const hash = this.hashContent((entry.title ?? '') + entry.content);
        if (existingHashes.has(hash)) {
          skipped++;
          continue;
        }
        const tagsText = entry.tags.join(' ');
        const embedding = await this.embeddingProvider.embed(tagsText);
        await this.repository.create({ ...entry, embedding });
        existingHashes.add(hash);
        imported++;
        this.logOp('write');
      } catch (err) {
        errors.push(`Failed to import "${entry.title}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { imported, skipped, errors };
  }

  private hashContent(text: string): string {
    // Simple hash for duplicate detection (no crypto.subtle needed — sync)
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  async listRecent(limit = 20, filters?: { type?: string; scope?: string }) {
    const entries = await this.repository.listRecent(limit, filters);
    return entries.map((e) => this.toKnowledgeEntry(e));
  }

  async topTags(limit = 10) {
    return this.repository.topTags(limit);
  }

  async listTags(): Promise<string[]> {
    return this.repository.listTags();
  }

  async getStats() {
    const [count, byType, byScope, lastUpdatedAt] = await Promise.all([
      this.repository.count(),
      this.repository.countByType(),
      this.repository.countByScope(),
      this.repository.lastUpdatedAt(),
    ]);
    return { total: count, byType, byScope, lastUpdatedAt };
  }

  // ─── Plans (separate entity) ────────────────────────────────

  async createPlan(input: CreatePlanInput & { tasks?: { description: string; priority?: string }[] }): Promise<Plan> {
    const { tasks, ...planInput } = input;
    const embedding = await this.embeddingProvider.embed(input.tags.join(' '));
    const row = this.repository.createPlan({ ...planInput, embedding });
    const plan = this.toPlan(row);

    if (tasks && tasks.length > 0) {
      try {
        for (let i = 0; i < tasks.length; i++) {
          this.repository.createPlanTask({ planId: plan.id, description: tasks[i].description, priority: tasks[i].priority, position: i });
        }
      } catch (err) {
        // Rollback: delete the plan if task creation fails
        this.repository.deletePlan(plan.id);
        throw err;
      }
    }

    return plan;
  }

  getPlanById(id: string): Plan | null {
    const row = this.repository.getPlanById(id);
    return row ? this.toPlan(row) : null;
  }

  updatePlan(id: string, updates: UpdatePlanInput): Plan | null {
    const row = this.repository.updatePlan(id, updates as Record<string, unknown>);
    return row ? this.toPlan(row) : null;
  }

  deletePlan(id: string): boolean {
    return this.repository.deletePlan(id);
  }

  listAllPlans(): Plan[] {
    const rows = this.repository.listAllPlans();
    return rows.map((r) => this.toPlan(r));
  }

  listPlans(limit = 20, status?: string): Plan[] {
    const rows = this.repository.listPlans(limit, status);
    return rows.map((r) => this.toPlan(r));
  }

  async importPlans(plans: (CreatePlanInput & { tasks?: { description: string; status?: string; priority?: string; notes?: string | null }[] })[]): Promise<{ imported: number; skipped: number; errors: string[] }> {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    const existing = this.repository.listAllPlans();
    const existingHashes = new Set<string>();
    for (const p of existing) {
      existingHashes.add(this.hashContent(p.title + p.content));
    }

    for (const plan of plans) {
      try {
        const hash = this.hashContent(plan.title + plan.content);
        if (existingHashes.has(hash)) {
          skipped++;
          continue;
        }
        const { tasks, ...planInput } = plan;
        const embedding = await this.embeddingProvider.embed(planInput.tags.join(' '));
        const row = this.repository.createPlan({ ...planInput, embedding });
        const createdPlan = this.toPlan(row);

        if (tasks && tasks.length > 0) {
          for (let i = 0; i < tasks.length; i++) {
            this.repository.createPlanTask({
              planId: createdPlan.id,
              description: tasks[i].description,
              status: tasks[i].status,
              priority: tasks[i].priority,
              notes: tasks[i].notes,
              position: i,
            });
          }
        }
        existingHashes.add(hash);
        imported++;
      } catch (err) {
        errors.push(`Failed to import plan "${plan.title}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { imported, skipped, errors };
  }

  // ─── Plan Relations ─────────────────────────────────────────

  addPlanRelation(planId: string, knowledgeId: string, relationType: 'input' | 'output') {
    this.repository.addPlanRelation(planId, knowledgeId, relationType);
  }

  async getPlanRelations(planId: string) {
    const relations = this.repository.getPlanRelations(planId);
    const results: { entry: KnowledgeEntry; relationType: string }[] = [];
    for (const rel of relations) {
      const entry = await this.repository.findById(rel.id);
      if (entry) results.push({ entry: this.toKnowledgeEntry(entry), relationType: rel.relationType });
    }
    return results;
  }

  getPlansForKnowledge(knowledgeId: string) {
    return this.repository.getPlansForKnowledge(knowledgeId);
  }

  // ─── Plan Tasks ─────────────────────────────────────────────

  createPlanTask(input: { planId: string; description: string; status?: string; priority?: string; notes?: string | null; position?: number }): PlanTask {
    return this.toPlanTask(this.repository.createPlanTask(input));
  }

  updatePlanTask(id: string, updates: { description?: string; status?: string; priority?: string; notes?: string | null; position?: number }): PlanTask | null {
    const row = this.repository.updatePlanTask(id, updates);
    return row ? this.toPlanTask(row) : null;
  }

  deletePlanTask(id: string): boolean {
    return this.repository.deletePlanTask(id);
  }

  listPlanTasks(planId: string): PlanTask[] {
    return this.repository.listPlanTasks(planId).map((r) => this.toPlanTask(r));
  }

  getPlanTaskStats() {
    return this.repository.getPlanTaskStats();
  }

  // ─── Operations ─────────────────────────────────────────────

  getOperationCounts() {
    return this.repository.getOperationCounts();
  }

  getOperationsByDay(days: number = 15) {
    return this.repository.getOperationsByDay(days);
  }

  cleanupOldOperations() {
    return this.repository.cleanupOldOperations();
  }

  // ─── Converters ─────────────────────────────────────────────

  private toKnowledgeEntry(row: any): KnowledgeEntry {
    return {
      id: row.id,
      title: row.title ?? '',
      content: row.content,
      embedding: [],
      tags: Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags ?? '[]'),
      type: row.type,
      scope: row.scope,
      source: row.source,
      version: row.version,
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
      confidenceScore: row.confidenceScore,
      relatedIds: row.relatedIds
        ? Array.isArray(row.relatedIds)
          ? row.relatedIds
          : JSON.parse(row.relatedIds)
        : null,
      agentId: row.agentId,
      createdAt: new Date(row.createdAt ?? row.created_at),
      updatedAt: new Date(row.updatedAt ?? row.updated_at),
    };
  }

  private toPlan(row: any): Plan {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      tags: Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags ?? '[]'),
      scope: row.scope,
      status: row.status,
      source: row.source ?? '',
      createdAt: new Date(row.created_at ?? row.createdAt),
      updatedAt: new Date(row.updated_at ?? row.updatedAt),
    };
  }

  private toPlanTask(row: any): PlanTask {
    return {
      id: row.id,
      planId: row.plan_id ?? row.planId,
      description: row.description,
      status: row.status,
      priority: row.priority,
      notes: row.notes ?? null,
      position: row.position,
      createdAt: new Date(row.created_at ?? row.createdAt),
      updatedAt: new Date(row.updated_at ?? row.updatedAt),
    };
  }
}
