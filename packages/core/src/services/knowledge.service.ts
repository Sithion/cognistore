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
    // Embed tags (joined as space-separated text) for semantic search
    // Tags are the primary semantic index per project spec
    const tagsText = input.tags.join(' ');
    const embedding = await this.embeddingProvider.embed(tagsText);
    const entry = await this.repository.create({ ...input, embedding });
    return this.toKnowledgeEntry(entry);
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    // Query embedding is compared against tag embeddings via cosine similarity
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
    // Re-embed when tags change (tags are the semantic index)
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
    return this.repository.listRecent(limit);
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
      embedding: row.embedding ?? [],
      tags: row.tags ?? [],
      type: row.type,
      scope: row.scope,
      source: row.source,
      version: row.version,
      expiresAt: row.expiresAt,
      confidenceScore: row.confidenceScore,
      relatedIds: row.relatedIds,
      agentId: row.agentId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
