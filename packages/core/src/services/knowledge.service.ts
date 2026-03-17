import { KnowledgeRepository } from '../repositories/knowledge.repository.js';
import type {
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
  SearchOptions,
  KnowledgeEntry,
  SearchResult,
} from '@ai-knowledge/shared';

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export class KnowledgeService {
  constructor(
    private repository: KnowledgeRepository,
    private embeddingProvider: EmbeddingProvider
  ) {}

  async add(input: CreateKnowledgeInput): Promise<KnowledgeEntry> {
    const tagsText = input.tags.join(' ');
    const embedding = await this.embeddingProvider.embed(tagsText);
    const entry = await this.repository.create({ ...input, embedding });
    return this.toKnowledgeEntry(entry);
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddingProvider.embed(query);
    const results = await this.repository.searchBySimilarity(queryEmbedding, options);
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
    return entry ? this.toKnowledgeEntry(entry) : null;
  }

  async delete(id: string): Promise<boolean> {
    const entry = await this.repository.delete(id);
    return entry !== null;
  }

  async listRecent(limit = 20) {
    const entries = await this.repository.listRecent(limit);
    return entries.map((e) => this.toKnowledgeEntry(e));
  }

  async listTags(): Promise<string[]> {
    return this.repository.listTags();
  }

  async getStats() {
    const [count, byType, byScope] = await Promise.all([
      this.repository.count(),
      this.repository.countByType(),
      this.repository.countByScope(),
    ]);
    return { total: count, byType, byScope };
  }

  private toKnowledgeEntry(row: any): KnowledgeEntry {
    return {
      id: row.id,
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
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }
}
