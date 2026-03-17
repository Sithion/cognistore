import { eq, sql, and, arrayOverlaps, gt, or, isNull } from 'drizzle-orm';
import { type Database } from '../db/client.js';
import { knowledgeEntries } from '../db/schema/knowledge.js';
import type { CreateKnowledgeInput, UpdateKnowledgeInput, SearchOptions } from '@ai-knowledge/shared';
import { DEFAULT_SEARCH_LIMIT, DEFAULT_SIMILARITY_THRESHOLD } from '@ai-knowledge/shared';

export class KnowledgeRepository {
  constructor(private db: Database) {}

  async create(input: CreateKnowledgeInput & { embedding: number[] }) {
    const [entry] = await this.db
      .insert(knowledgeEntries)
      .values({
        content: input.content,
        embedding: input.embedding,
        tags: input.tags,
        type: input.type,
        scope: input.scope,
        source: input.source,
        confidenceScore: input.confidenceScore ?? 1.0,
        expiresAt: input.expiresAt ?? null,
        relatedIds: input.relatedIds ?? null,
        agentId: input.agentId ?? null,
      })
      .returning();
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
    const [entry] = await this.db
      .update(knowledgeEntries)
      .set({
        ...updates,
        version: sql`${knowledgeEntries.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeEntries.id, id))
      .returning();
    return entry ?? null;
  }

  async delete(id: string) {
    const [entry] = await this.db
      .delete(knowledgeEntries)
      .where(eq(knowledgeEntries.id, id))
      .returning();
    return entry ?? null;
  }

  /**
   * Semantic search using cosine similarity on embeddings.
   * IMPORTANT: When a specific scope is provided, global knowledge is ALWAYS included.
   * This means searching scope "workspace:api" returns results from both "workspace:api" AND "global".
   */
  async searchBySimilarity(queryEmbedding: number[], options?: SearchOptions) {
    const limit = options?.limit ?? DEFAULT_SEARCH_LIMIT;
    const threshold = options?.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    const conditions = [];

    // Scope filter: always include global + specific scope
    if (options?.scope) {
      conditions.push(
        or(
          eq(knowledgeEntries.scope, 'global'),
          eq(knowledgeEntries.scope, options.scope)
        )
      );
    }

    // Tag filter
    if (options?.tags && options.tags.length > 0) {
      conditions.push(arrayOverlaps(knowledgeEntries.tags, options.tags));
    }

    // Type filter
    if (options?.type) {
      conditions.push(eq(knowledgeEntries.type, options.type));
    }

    // Exclude expired entries
    conditions.push(
      or(
        isNull(knowledgeEntries.expiresAt),
        gt(knowledgeEntries.expiresAt, new Date())
      )
    );

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await this.db
      .select({
        entry: knowledgeEntries,
        similarity: sql<number>`1 - (${knowledgeEntries.embedding} <=> ${vectorStr}::vector)`.as('similarity'),
      })
      .from(knowledgeEntries)
      .where(whereClause)
      .orderBy(sql`${knowledgeEntries.embedding} <=> ${vectorStr}::vector`)
      .limit(limit);

    return results
      .filter((r) => r.similarity >= threshold)
      .map((r) => ({
        entry: r.entry,
        similarity: r.similarity,
      }));
  }

  async listRecent(limit = 20) {
    return this.db
      .select()
      .from(knowledgeEntries)
      .orderBy(sql`${knowledgeEntries.createdAt} DESC`)
      .limit(limit);
  }

  async listTags() {
    const result = await this.db
      .selectDistinct({ tag: sql<string>`unnest(${knowledgeEntries.tags})` })
      .from(knowledgeEntries);
    return result.map((r) => r.tag);
  }

  async count() {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(knowledgeEntries);
    return Number(result.count);
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
