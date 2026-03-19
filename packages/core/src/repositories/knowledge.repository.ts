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
}
