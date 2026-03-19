import { eq, sql, and, or, isNull } from 'drizzle-orm';
import { type Database, type SQLiteDatabase } from '../db/client.js';
import { knowledgeEntries } from '../db/schema/knowledge.js';
import {
  insertEmbedding,
  updateEmbedding,
  deleteEmbedding,
  searchKnn,
} from '../db/schema/sqlite-vec.js';
import type { CreateKnowledgeInput, UpdateKnowledgeInput, SearchOptions } from '@ai-knowledge/shared';
import { DEFAULT_SEARCH_LIMIT, DEFAULT_SIMILARITY_THRESHOLD } from '@ai-knowledge/shared';

export class KnowledgeRepository {
  constructor(
    private db: Database,
    private sqlite: SQLiteDatabase
  ) {}

  async create(input: CreateKnowledgeInput & { embedding: number[] }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const [entry] = await this.db
      .insert(knowledgeEntries)
      .values({
        id,
        title: input.title,
        content: input.content,
        tags: input.tags,
        type: input.type,
        scope: input.scope,
        source: input.source,
        confidenceScore: input.confidenceScore ?? 1.0,
        expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
        relatedIds: input.relatedIds ?? null,
        agentId: input.agentId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Insert embedding into the sqlite-vec virtual table
    insertEmbedding(this.sqlite, id, input.embedding);

    return entry;
  }

  async findById(id: string) {
    const [entry] = await this.db
      .select()
      .from(knowledgeEntries)
      .where(eq(knowledgeEntries.id, id));
    return entry ?? null;
  }

  async update(id: string, updates: UpdateKnowledgeInput & { embedding?: number[] }) {
    const { embedding, ...rest } = updates;

    const values: Record<string, unknown> = {
      ...rest,
      updatedAt: new Date().toISOString(),
    };

    // Convert Date to ISO string for SQLite
    if (rest.expiresAt !== undefined) {
      values.expiresAt = rest.expiresAt ? rest.expiresAt.toISOString() : null;
    }

    const [entry] = await this.db
      .update(knowledgeEntries)
      .set({
        ...values,
        version: sql`${knowledgeEntries.version} + 1`,
      })
      .where(eq(knowledgeEntries.id, id))
      .returning();

    // Update embedding in virtual table if provided
    if (embedding) {
      updateEmbedding(this.sqlite, id, embedding);
    }

    return entry ?? null;
  }

  async delete(id: string) {
    const [entry] = await this.db
      .delete(knowledgeEntries)
      .where(eq(knowledgeEntries.id, id))
      .returning();

    if (entry) {
      deleteEmbedding(this.sqlite, id);
    }

    return entry ?? null;
  }

  /**
   * Semantic search using cosine similarity on embeddings.
   * Uses sqlite-vec KNN search on the virtual table, then filters by metadata.
   * IMPORTANT: When a specific scope is provided, global knowledge is ALWAYS included.
   */
  async searchBySimilarity(queryEmbedding: number[], options?: SearchOptions) {
    const limit = options?.limit ?? DEFAULT_SEARCH_LIMIT;
    const threshold = options?.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;

    // Fetch more candidates than needed to account for metadata filtering
    const candidateLimit = limit * 5;
    const knnResults = searchKnn(this.sqlite, queryEmbedding, candidateLimit);

    if (knnResults.length === 0) {
      return [];
    }

    // Get the candidate IDs
    const candidateIds = knnResults.map((r) => r.id);
    // Build a distance lookup map (cosine distance from sqlite-vec)
    const distanceMap = new Map(knnResults.map((r) => [r.id, r.distance]));

    // Fetch full entries for candidates
    const conditions = [];

    // Filter to only candidates from KNN
    conditions.push(
      sql`${knowledgeEntries.id} IN (${sql.join(
        candidateIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    );

    // Scope filter: always include global + specific scope
    if (options?.scope) {
      conditions.push(
        or(
          eq(knowledgeEntries.scope, 'global'),
          eq(knowledgeEntries.scope, options.scope)
        )
      );
    }

    // Tag filter: check if any requested tag is in the JSON tags array
    if (options?.tags && options.tags.length > 0) {
      const tagConditions = options.tags.map(
        (tag) => sql`EXISTS (SELECT 1 FROM json_each(${knowledgeEntries.tags}) WHERE value = ${tag})`
      );
      conditions.push(or(...tagConditions));
    }

    // Type filter
    if (options?.type) {
      conditions.push(eq(knowledgeEntries.type, options.type));
    }

    // Exclude expired entries
    conditions.push(
      or(
        isNull(knowledgeEntries.expiresAt),
        sql`${knowledgeEntries.expiresAt} > ${new Date().toISOString()}`
      )
    );

    const whereClause = and(...conditions);

    const entries = await this.db
      .select()
      .from(knowledgeEntries)
      .where(whereClause);

    // Convert cosine distance to similarity (similarity = 1 - distance)
    // and filter by threshold, then sort and limit
    return entries
      .map((entry) => ({
        entry,
        similarity: 1 - (distanceMap.get(entry.id) ?? 1),
      }))
      .filter((r) => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async listRecent(limit = 20, filters?: { type?: string; scope?: string }) {
    const conditions: any[] = [];
    if (filters?.type) conditions.push(sql`${knowledgeEntries.type} = ${filters.type}`);
    if (filters?.scope) conditions.push(sql`${knowledgeEntries.scope} = ${filters.scope}`);

    if (conditions.length === 0) {
      return this.db
        .select()
        .from(knowledgeEntries)
        .orderBy(sql`${knowledgeEntries.createdAt} DESC`)
        .limit(limit);
    }

    const where = conditions.length === 1
      ? conditions[0]
      : sql`${conditions[0]} AND ${conditions[1]}`;

    return this.db
      .select()
      .from(knowledgeEntries)
      .where(where)
      .orderBy(sql`${knowledgeEntries.createdAt} DESC`)
      .limit(limit);
  }

  async listTags() {
    const result = await this.db.all<{ value: string }>(
      sql`SELECT DISTINCT value FROM knowledge_entries, json_each(knowledge_entries.tags)`
    );
    return result.map((r) => r.value);
  }

  async topTags(limit = 10) {
    const result = await this.db.all<{ tag: string; count: number }>(
      sql`SELECT value as tag, COUNT(*) as count FROM knowledge_entries, json_each(knowledge_entries.tags) GROUP BY value ORDER BY count DESC LIMIT ${limit}`
    );
    return result;
  }

  async count() {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(knowledgeEntries);
    return Number(result.count);
  }

  async lastUpdatedAt(): Promise<string | null> {
    const result = await this.db.all<{ latest: string }>(
      sql`SELECT MAX(updated_at) as latest FROM knowledge_entries`
    );
    return result[0]?.latest ?? null;
  }

  async countByType() {
    const results = await this.db
      .select({
        type: knowledgeEntries.type,
        count: sql<number>`count(*)`,
      })
      .from(knowledgeEntries)
      .groupBy(knowledgeEntries.type);
    return results.map((r) => ({ type: r.type, count: Number(r.count) }));
  }

  async countByScope() {
    const results = await this.db
      .select({
        scope: knowledgeEntries.scope,
        count: sql<number>`count(*)`,
      })
      .from(knowledgeEntries)
      .groupBy(knowledgeEntries.scope);
    return results.map((r) => ({ scope: r.scope, count: Number(r.count) }));
  }

  // ─── Plans (separate table) ──────────────────────────────────

  createPlan(input: { title: string; content: string; tags: string[]; scope: string; source: string; status?: string; embedding: number[] }): any {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.sqlite.prepare(
      'INSERT INTO plans (id, title, content, tags, scope, status, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, input.title, input.content, JSON.stringify(input.tags), input.scope, input.status ?? 'draft', input.source, now, now);

    // Insert embedding into plans_embeddings
    try {
      this.sqlite.prepare('INSERT INTO plans_embeddings (id, embedding) VALUES (?, ?)').run(
        id, new Float32Array(input.embedding).buffer
      );
    } catch { /* vec table may not exist yet */ }

    return this.getPlanById(id);
  }

  getPlanById(id: string): any | null {
    return this.sqlite.prepare('SELECT * FROM plans WHERE id = ?').get(id) ?? null;
  }

  updatePlan(id: string, updates: Record<string, unknown>): any | null {
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      const col = key === 'tags' ? 'tags' : key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
      setClauses.push(`${col} = ?`);
      values.push(key === 'tags' ? JSON.stringify(value) : value);
    }
    if (setClauses.length === 0) return this.getPlanById(id);

    setClauses.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.sqlite.prepare(`UPDATE plans SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    return this.getPlanById(id);
  }

  deletePlan(id: string): boolean {
    // Cascade deletes plan_relations and plan_tasks via FK
    const result = this.sqlite.prepare('DELETE FROM plans WHERE id = ?').run(id);
    try { this.sqlite.prepare('DELETE FROM plans_embeddings WHERE id = ?').run(id); } catch { /* silent */ }
    return result.changes > 0;
  }

  listPlans(limit = 20, status?: string): any[] {
    if (status) {
      return this.sqlite.prepare('SELECT * FROM plans WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit) as any[];
    }
    return this.sqlite.prepare('SELECT * FROM plans ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
  }

  // ─── Plan Relations ─────────────────────────────────────────

  addPlanRelation(planId: string, knowledgeId: string, relationType: 'input' | 'output'): void {
    this.sqlite
      .prepare('INSERT OR IGNORE INTO plan_relations (plan_id, knowledge_id, relation_type, created_at) VALUES (?, ?, ?, ?)')
      .run(planId, knowledgeId, relationType, new Date().toISOString());
  }

  getPlanRelations(planId: string): { id: string; relationType: string }[] {
    return this.sqlite
      .prepare('SELECT knowledge_id as id, relation_type as relationType FROM plan_relations WHERE plan_id = ? ORDER BY created_at')
      .all(planId) as { id: string; relationType: string }[];
  }

  deletePlanRelations(planId: string): number {
    return this.sqlite.prepare('DELETE FROM plan_relations WHERE plan_id = ?').run(planId).changes;
  }

  // ─── Plan Tasks ─────────────────────────────────────────────

  createPlanTask(input: { planId: string; description: string; status?: string; priority?: string; notes?: string | null; position?: number }): any {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const maxPos = this.sqlite.prepare('SELECT MAX(position) as max FROM plan_tasks WHERE plan_id = ?').get(input.planId) as any;
    const position = input.position ?? ((maxPos?.max ?? -1) + 1);

    this.sqlite.prepare(
      'INSERT INTO plan_tasks (id, plan_id, description, status, priority, notes, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, input.planId, input.description, input.status ?? 'pending', input.priority ?? 'medium', input.notes ?? null, position, now, now);

    return this.getPlanTaskById(id);
  }

  updatePlanTask(id: string, updates: { description?: string; status?: string; priority?: string; notes?: string | null; position?: number }): any | null {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.description !== undefined) { setClauses.push('description = ?'); values.push(updates.description); }
    if (updates.status !== undefined) { setClauses.push('status = ?'); values.push(updates.status); }
    if (updates.priority !== undefined) { setClauses.push('priority = ?'); values.push(updates.priority); }
    if (updates.notes !== undefined) { setClauses.push('notes = ?'); values.push(updates.notes); }
    if (updates.position !== undefined) { setClauses.push('position = ?'); values.push(updates.position); }

    if (setClauses.length === 0) return this.getPlanTaskById(id);

    setClauses.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.sqlite.prepare(`UPDATE plan_tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    return this.getPlanTaskById(id);
  }

  deletePlanTask(id: string): boolean {
    return this.sqlite.prepare('DELETE FROM plan_tasks WHERE id = ?').run(id).changes > 0;
  }

  listPlanTasks(planId: string): any[] {
    return this.sqlite.prepare('SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY position ASC').all(planId) as any[];
  }

  getPlanTaskById(id: string): any | null {
    return this.sqlite.prepare('SELECT * FROM plan_tasks WHERE id = ?').get(id) ?? null;
  }

  getPlanTaskStats(): { total: number; pending: number; inProgress: number; completed: number } {
    const result = this.sqlite.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM plan_tasks
    `).get() as any;
    return { total: result?.total ?? 0, pending: result?.pending ?? 0, inProgress: result?.in_progress ?? 0, completed: result?.completed ?? 0 };
  }

  // ─── Operations Log ────────────────────────────────────────────

  logOperation(operation: 'read' | 'write'): void {
    this.sqlite
      .prepare('INSERT INTO operations_log (operation, created_at) VALUES (?, ?)')
      .run(operation, new Date().toISOString());
  }

  getOperationCounts(): {
    readsLastHour: number;
    readsLastDay: number;
    writesLastHour: number;
    writesLastDay: number;
  } {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const result = this.sqlite
      .prepare(
        `SELECT
          SUM(CASE WHEN operation = 'read'  AND created_at >= ? THEN 1 ELSE 0 END) as reads_1h,
          SUM(CASE WHEN operation = 'read'  AND created_at >= ? THEN 1 ELSE 0 END) as reads_24h,
          SUM(CASE WHEN operation = 'write' AND created_at >= ? THEN 1 ELSE 0 END) as writes_1h,
          SUM(CASE WHEN operation = 'write' AND created_at >= ? THEN 1 ELSE 0 END) as writes_24h
        FROM operations_log
        WHERE created_at >= ?`
      )
      .get(oneHourAgo, oneDayAgo, oneHourAgo, oneDayAgo, oneDayAgo) as any;

    return {
      readsLastHour: result?.reads_1h ?? 0,
      readsLastDay: result?.reads_24h ?? 0,
      writesLastHour: result?.writes_1h ?? 0,
      writesLastDay: result?.writes_24h ?? 0,
    };
  }

  cleanupOldOperations(): number {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return this.sqlite.prepare('DELETE FROM operations_log WHERE created_at < ?').run(cutoff).changes;
  }
}
