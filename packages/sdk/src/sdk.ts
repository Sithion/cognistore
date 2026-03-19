import {
  createDbClient,
  KnowledgeRepository,
  KnowledgeService,
  type Database,
  type SQLiteDatabase,
} from '@ai-knowledge/core';
import { OllamaEmbeddingClient, checkOllamaHealth } from '@ai-knowledge/embeddings';
import {
  createKnowledgeSchema,
  updateKnowledgeSchema,
  searchOptionsSchema,
  type CreateKnowledgeInput,
  type UpdateKnowledgeInput,
  type SearchOptions,
  type SearchResult,
  type KnowledgeEntry,
  type HealthStatus,
  type SDKConfig,
} from '@ai-knowledge/shared';
import { resolveConfig } from './config.js';
import { ConnectionError, EmbeddingError, ValidationError } from './errors.js';

export class KnowledgeSDK {
  private config: SDKConfig;
  private db: Database | null = null;
  private sqlite: SQLiteDatabase | null = null;
  private service: KnowledgeService | null = null;
  private ollamaClient: OllamaEmbeddingClient;
  private initialized = false;

  constructor(config?: Partial<SDKConfig>) {
    this.config = resolveConfig(config);
    this.ollamaClient = new OllamaEmbeddingClient({
      host: this.config.ollama.host,
      model: this.config.ollama.model,
      dimensions: this.config.ollama.dimensions,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Step 1: Connect to SQLite database
      try {
        const { db, sqlite } = createDbClient(this.config.database.path);
        this.db = db;
        this.sqlite = sqlite;
      } catch (error) {
        throw new ConnectionError(
          `Failed to open database: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Step 2: Ensure Ollama model is available
      try {
        await this.ollamaClient.ensureModel();
      } catch (error) {
        throw new EmbeddingError(
          `Failed to ensure embedding model: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Step 3: Create service
      const repository = new KnowledgeRepository(this.db, this.sqlite);
      this.service = new KnowledgeService(repository, this.ollamaClient);

      this.initialized = true;
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.cleanup();
    this.initialized = false;
  }

  async addKnowledge(input: CreateKnowledgeInput): Promise<KnowledgeEntry> {
    this.ensureInitialized();
    const parsed = createKnowledgeSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(`Invalid input: ${parsed.error.message}`);
    }
    try {
      return await this.service!.add(parsed.data as CreateKnowledgeInput);
    } catch (error) {
      throw this.wrapError(error, 'Failed to add knowledge');
    }
  }

  async getKnowledge(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    this.ensureInitialized();
    if (!query || query.trim().length === 0) {
      throw new ValidationError('Query cannot be empty');
    }
    const parsedOptions = options ? searchOptionsSchema.parse(options) : undefined;
    try {
      return await this.service!.search(query, parsedOptions as SearchOptions | undefined);
    } catch (error) {
      throw this.wrapError(error, 'Failed to search knowledge');
    }
  }

  async getKnowledgeById(id: string): Promise<KnowledgeEntry | null> {
    this.ensureInitialized();
    try {
      return await this.service!.getById(id);
    } catch (error) {
      throw this.wrapError(error, 'Failed to get knowledge');
    }
  }

  async updateKnowledge(id: string, updates: UpdateKnowledgeInput): Promise<KnowledgeEntry | null> {
    this.ensureInitialized();
    const parsed = updateKnowledgeSchema.safeParse(updates);
    if (!parsed.success) {
      throw new ValidationError(`Invalid updates: ${parsed.error.message}`);
    }
    try {
      return await this.service!.update(id, parsed.data as UpdateKnowledgeInput);
    } catch (error) {
      throw this.wrapError(error, 'Failed to update knowledge');
    }
  }

  async deleteKnowledge(id: string): Promise<boolean> {
    this.ensureInitialized();
    try {
      return await this.service!.delete(id);
    } catch (error) {
      throw this.wrapError(error, 'Failed to delete knowledge');
    }
  }

  async listRecent(limit = 20, filters?: { type?: string; scope?: string }) {
    this.ensureInitialized();
    try {
      return await this.service!.listRecent(limit, filters);
    } catch (error) {
      throw this.wrapError(error, 'Failed to list recent knowledge');
    }
  }

  async getTopTags(limit = 10) {
    this.ensureInitialized();
    try {
      return await this.service!.topTags(limit);
    } catch (error) {
      throw this.wrapError(error, 'Failed to get top tags');
    }
  }

  async listTags(): Promise<string[]> {
    this.ensureInitialized();
    try {
      return await this.service!.listTags();
    } catch (error) {
      throw this.wrapError(error, 'Failed to list tags');
    }
  }

  async getStats() {
    this.ensureInitialized();
    try {
      return await this.service!.getStats();
    } catch (error) {
      throw this.wrapError(error, 'Failed to get stats');
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const ollamaHealth = await checkOllamaHealth(this.ollamaClient);

    let dbConnected = false;
    let dbError: string | undefined;
    if (this.sqlite) {
      try {
        this.sqlite.prepare('SELECT 1').get();
        dbConnected = true;
      } catch (error) {
        dbError = error instanceof Error ? error.message : String(error);
      }
    } else {
      dbError = 'Not initialized';
    }

    return {
      database: {
        connected: dbConnected,
        path: this.config.database.path,
        error: dbError,
      },
      ollama: {
        connected: ollamaHealth.connected,
        model: ollamaHealth.model,
        host: this.config.ollama.host,
        error: ollamaHealth.error,
      },
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.service) {
      throw new ConnectionError('SDK not initialized. Call initialize() first.');
    }
  }

  private async cleanup(): Promise<void> {
    if (this.sqlite) {
      try {
        this.sqlite.close();
      } catch {
        // Ignore cleanup errors
      }
      this.sqlite = null;
    }
    this.db = null;
    this.service = null;
  }

  private wrapError(error: unknown, context: string): Error {
    if (error instanceof Error && error.name.endsWith('Error')) {
      return error;
    }
    return new ConnectionError(`${context}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
