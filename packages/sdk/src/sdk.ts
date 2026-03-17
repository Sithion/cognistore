import {
  createDbClient,
  KnowledgeRepository,
  KnowledgeService,
  DockerManager,
  type Database,
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
import { ConnectionError, EmbeddingError, ValidationError, DockerError } from './errors.js';

export class KnowledgeSDK {
  private config: SDKConfig;
  private db: Database | null = null;
  private queryClient: ReturnType<typeof createDbClient>['queryClient'] | null = null;
  private service: KnowledgeService | null = null;
  private dockerManager: DockerManager;
  private ollamaClient: OllamaEmbeddingClient;
  private initialized = false;

  constructor(config?: Partial<SDKConfig>) {
    this.config = resolveConfig(config);
    this.dockerManager = new DockerManager(this.config.dockerComposePath);
    this.ollamaClient = new OllamaEmbeddingClient({
      host: this.config.ollama.host,
      model: this.config.ollama.model,
      dimensions: this.config.ollama.dimensions,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Step 1: Ensure Docker containers are running (if autoStart enabled)
      if (this.config.autoStart) {
        try {
          await this.dockerManager.ensureRunning();
        } catch (error) {
          throw new DockerError(
            `Failed to start Docker containers: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Step 2: Connect to database
      try {
        const { db, queryClient } = createDbClient(this.config.database.url);
        this.db = db;
        this.queryClient = queryClient;
      } catch (error) {
        throw new ConnectionError(
          `Failed to connect to database: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Step 3: Ensure Ollama model is available
      try {
        await this.ollamaClient.ensureModel();
      } catch (error) {
        throw new EmbeddingError(
          `Failed to ensure embedding model: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Step 4: Create service
      const repository = new KnowledgeRepository(this.db);
      this.service = new KnowledgeService(repository, this.ollamaClient);

      this.initialized = true;
    } catch (error) {
      // Cleanup on failure
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

  async listRecent(limit = 20) {
    this.ensureInitialized();
    try {
      return await this.service!.listRecent(limit);
    } catch (error) {
      throw this.wrapError(error, 'Failed to list recent knowledge');
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
    if (this.queryClient) {
      try {
        await this.queryClient`SELECT 1`;
        dbConnected = true;
      } catch (error) {
        dbError = error instanceof Error ? error.message : String(error);
      }
    } else {
      dbError = 'Not initialized';
    }

    let dockerStatus;
    try {
      dockerStatus = {
        running: this.dockerManager.isDockerAvailable(),
        containers: [
          { name: 'kb-postgres', status: this.dockerManager.getContainerStatus('kb-postgres') ?? 'not found' },
          { name: 'kb-ollama', status: this.dockerManager.getContainerStatus('kb-ollama') ?? 'not found' },
        ],
      };
    } catch {
      dockerStatus = { running: false, containers: [] };
    }

    return {
      database: { connected: dbConnected, error: dbError },
      ollama: {
        connected: ollamaHealth.connected,
        model: ollamaHealth.model,
        error: ollamaHealth.error,
      },
      docker: dockerStatus,
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.service) {
      throw new ConnectionError('SDK not initialized. Call initialize() first.');
    }
  }

  private async cleanup(): Promise<void> {
    if (this.queryClient) {
      try {
        await this.queryClient.end();
      } catch {
        // Ignore cleanup errors
      }
      this.queryClient = null;
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
