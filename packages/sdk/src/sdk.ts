import {
  createDbClient,
  createEmbeddingsTable,
  KnowledgeRepository,
  KnowledgeService,
  TokenUsageRepository,
  TokenUsageService,
  type Database,
  type SQLiteDatabase,
  type TokenUsageAggregates,
  type TokenUsageFilter,
  type ScanResult,
  type CleanupReport,
  type CleanupCandidate,
  type JobKind,
  type JobPayloads,
  type JobResults,
  JobRunner,
  type DuplicateJobOptions,
  duplicateFingerprint,
} from '@cognistore/core';
import { OllamaEmbeddingClient, checkOllamaHealth } from '@cognistore/embeddings';
import {
  createKnowledgeSchema,
  updateKnowledgeSchema,
  searchOptionsSchema,
  createPlanSchema,
  type CreateKnowledgeInput,
  type UpdateKnowledgeInput,
  type SearchOptions,
  type SearchResult,
  type KnowledgeEntry,
  type Plan,
  type CreatePlanInput,
  type UpdatePlanInput,
  type PlanChain,
  type PlanTask,
  type HealthStatus,
  type SDKConfig,
  type FederatedSearchResult,
} from '@cognistore/shared';
import { loadProviders, type ProviderManager, EnvSecretStore, FileTokenStore, resolveProviderPolicy } from '@cognistore/providers';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { resolveConfig } from './config.js';
import { ConnectionError, EmbeddingError, ValidationError } from './errors.js';

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export class KnowledgeSDK {
  static maintenanceRunning = false;
  private config: SDKConfig;
  private db: Database | null = null;
  private sqlite: SQLiteDatabase | null = null;
  private service: KnowledgeService | null = null;
  private tokenService: TokenUsageService | null = null;
  private ollamaClient: OllamaEmbeddingClient;
  private providerManager: ProviderManager | null = null;
  private alwaysExternal = false;
  private initialized = false;
  private jobs?: JobRunner;
  private duplicateCache = new Map<string, { fingerprint: string; result: unknown[] }>();
  private duplicateInFlight = new Map<string, Promise<any[]>>();

  private getJobRunner(): JobRunner {
    if (this.jobs) return this.jobs;
    this.jobs = new JobRunner({
      workerUrl: new URL('./jobs/worker.js', import.meta.url),
      databasePath: this.getDatabasePath(),
      embeddingConfig: { host: this.config.ollama.host, model: this.config.ollama.model, dimensions: this.config.ollama.dimensions },
    });
    return this.jobs;
  }

  run<K extends JobKind>(kind: K, payload: JobPayloads[K], options?: { signal?: AbortSignal; onProgress?: (progress: unknown) => void | Promise<void> }): Promise<JobResults[K]> {
    return this.getJobRunner().run(kind, payload, options);
  }

  constructor(config?: Partial<SDKConfig>) {
    this.config = resolveConfig(config);
    this.ollamaClient = new OllamaEmbeddingClient({
      host: this.config.ollama.host,
      model: this.config.ollama.model,
      dimensions: this.config.ollama.dimensions,
    });
  }

  getDatabasePath(): string {
    const path = expandHome(this.config.database.path);
    return isAbsolute(path) ? path : resolve(path);
  }

  async enableIncrementalVacuum(workerUrl: URL): Promise<{ alreadyIncremental: boolean; checkpointBusy: boolean }> {
    return KnowledgeSDK.runMaintenanceWorker(workerUrl, { databasePath: this.getDatabasePath(), operation: 'enable' });
  }

  async incrementalVacuum(workerUrl: URL, budgetMs = 2000): Promise<void> {
    if (!Number.isFinite(budgetMs) || budgetMs < 1) throw new ValidationError('budgetMs must be a positive number');
    await KnowledgeSDK.runMaintenanceWorker(workerUrl, { databasePath: this.getDatabasePath(), operation: 'reclaim', budgetMs });
  }

  private static async runMaintenanceWorker(workerUrl: URL, data: { databasePath: string; operation: 'enable' | 'reclaim'; budgetMs?: number }): Promise<{ alreadyIncremental: boolean; checkpointBusy: boolean }> {
    if (KnowledgeSDK.maintenanceRunning) {
      const error = new Error('Database maintenance is already running; retry shortly.') as Error & { code: string };
      error.code = 'DATABASE_LOCKED';
      throw error;
    }
    KnowledgeSDK.maintenanceRunning = true;
    try {
      const worker = new Worker(workerUrl, { workerData: data });
      const result = await new Promise<{ ok: boolean; code?: string; message?: string; retryable?: boolean; alreadyIncremental?: boolean; checkpointBusy?: boolean }>((resolve, reject) => {
        let receivedMessage = false;
        worker.once('message', (message) => { receivedMessage = true; resolve(message); });
        worker.once('error', reject);
        worker.once('exit', (code) => {
          if (code !== 0 || !receivedMessage) reject(new Error('Vacuum worker exited unexpectedly'));
        });
      });
      await worker.terminate();
      if (!result.ok) {
        const error = new Error(result.message ?? 'Vacuum failed') as Error & { code?: string; retryable?: boolean };
        error.code = result.code; error.retryable = result.retryable; throw error;
      }
      return { alreadyIncremental: result.alreadyIncremental === true, checkpointBusy: result.checkpointBusy === true };
    } finally { KnowledgeSDK.maintenanceRunning = false; }
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
        const wrapped = new ConnectionError(
          `Failed to open database: ${error instanceof Error ? error.message : String(error)}`
        );
        Object.defineProperty(wrapped, 'cause', { value: error, configurable: true });
        throw wrapped;
      }

      // Step 2: Ensure Ollama model is available
      try {
        await this.ollamaClient.ensureModel();
      } catch (error) {
        throw new EmbeddingError(
          `Failed to ensure embedding model: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Step 3: Detect embedding dimension mismatch (Matryoshka migration)
      await this.detectAndMigrateDimensions();

      // Step 4: Create service
      const repository = new KnowledgeRepository(this.db!, this.sqlite!);
      this.service = new KnowledgeService(repository, this.ollamaClient);

      // Step 5: Token usage tracking (purely additive — no embedding needed).
      const tokenRepo = new TokenUsageRepository(this.sqlite!);
      this.tokenService = new TokenUsageService(tokenRepo);

      // Step 6: External knowledge providers (federated search — opt-in, off by default).
      this.reloadProviders();

      this.initialized = true;
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  async close(): Promise<void> {
    const jobs = this.jobs;
    this.jobs = undefined;
    await jobs?.close();
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

  /**
   * Federated search: local results + one section per enabled external provider.
   * Use when the caller opted in (param) or the global always-on setting is true.
   * `getKnowledge` stays local-only and backward-compatible.
   */
  async getKnowledgeFederated(
    query: string,
    options?: SearchOptions,
    opts?: { providers?: string[]; perProviderTimeoutMs?: number },
  ): Promise<FederatedSearchResult> {
    this.ensureInitialized();
    if (!query || query.trim().length === 0) {
      throw new ValidationError('Query cannot be empty');
    }
    const parsedOptions = options ? (searchOptionsSchema.parse(options) as SearchOptions) : undefined;
    const source = this.providerManager
      ? (opts?.providers ? this.providerManager.subset(opts.providers) : this.providerManager)
      : undefined;
    try {
      return await this.service!.searchFederated(query, parsedOptions, source, {
        perProviderTimeoutMs: opts?.perProviderTimeoutMs,
      });
    } catch (error) {
      throw this.wrapError(error, 'Failed to search knowledge (federated)');
    }
  }

  /** Whether the global "always search external providers" setting is on. */
  get alwaysSearchExternalProviders(): boolean {
    return this.alwaysExternal;
  }

  /**
   * Re-read providers.json + the alwaysSearchExternalProviders setting. Call after
   * the dashboard mutates either, so federated search reflects changes without a
   * restart. Never throws (a bad config keeps the previous state).
   */
  reloadProviders(): void {
    try {
      const dir = dirname(expandHome(this.config.database.path));
      const tokenStore = new FileTokenStore(join(dir, 'oauth-tokens.json'));
      const settingsPath = join(dir, 'settings.json');
      const settings = existsSync(settingsPath)
        ? (JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
            alwaysSearchExternalProviders?: boolean;
            allowStdioProviders?: boolean;
            allowInsecureProviderUrls?: boolean;
          })
        : null;
      // The policy comes from settings.json rather than env so that this process
      // and the MCP server — which load the same providers.json — agree on which
      // entries exist. See packages/providers/src/policy.ts.
      this.providerManager = loadProviders(
        join(dir, 'providers.json'),
        new EnvSecretStore(),
        tokenStore,
        resolveProviderPolicy(settings),
      );
      this.alwaysExternal = settings?.alwaysSearchExternalProviders === true;
    } catch (e) {
      console.error('[CogniStore] reloadProviders failed:', e instanceof Error ? e.message : String(e));
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
      const existing = await this.service!.getById(id);
      if (existing?.type === 'system' && updates.type && updates.type !== 'system') {
        throw new ValidationError('System knowledge type cannot be changed');
      }
      const updated = await this.service!.update(id, parsed.data as UpdateKnowledgeInput);
      this.duplicateCache.clear();
      return updated;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw this.wrapError(error, 'Failed to update knowledge');
    }
  }

  async deleteKnowledge(id: string): Promise<boolean> {
    this.ensureInitialized();
    try {
      const existing = await this.service!.getById(id);
      if (existing?.type === 'system') {
        throw new ValidationError('System knowledge cannot be deleted');
      }
      return await this.service!.delete(id);
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw this.wrapError(error, 'Failed to delete knowledge');
    }
  }

  async listRecent(limit = 20, filters?: { type?: string; scope?: string; tags?: string[]; agent?: string; platform?: string }, offset = 0) {
    this.ensureInitialized();
    try {
      return await this.service!.listRecent(limit, filters, offset);
    } catch (error) {
      throw this.wrapError(error, 'Failed to list recent knowledge');
    }
  }

  async getTopTags(limit = 10, opts: { from?: string; to?: string } = {}) {
    this.ensureInitialized();
    try {
      return await this.service!.topTags(limit, opts);
    } catch (error) {
      throw this.wrapError(error, 'Failed to get top tags');
    }
  }

  async listTags(opts: { from?: string; to?: string } = {}): Promise<string[]> {
    this.ensureInitialized();
    try {
      return await this.service!.listTags(opts);
    } catch (error) {
      throw this.wrapError(error, 'Failed to list tags');
    }
  }

  async suggestTagMerges(threshold = 0.82) {
    this.ensureInitialized();
    try {
      return await this.service!.suggestTagMerges(threshold);
    } catch (error) {
      throw this.wrapError(error, 'Failed to suggest tag merges');
    }
  }

  async mergeTags(from: string, to: string) {
    this.ensureInitialized();
    try {
      return await this.service!.mergeTag(from, to);
    } catch (error) {
      throw this.wrapError(error, 'Failed to merge tags');
    }
  }

  async mergeTagsBatch(merges: { from: string; to: string }[]) {
    this.ensureInitialized();
    try {
      return await this.service!.mergeTagsBatch(merges);
    } catch (error) {
      // CONFLICT errors carry a user-actionable message — pass them through
      // unwrapped so the server can map them to a 400.
      if (error instanceof Error && error.message.startsWith('CONFLICT:')) throw error;
      throw this.wrapError(error, 'Failed to merge tags');
    }
  }

  async findStaleEntries(opts: { days?: number; minConfidence?: number; limit?: number } = {}) {
    this.ensureInitialized();
    try {
      return await this.service!.findStaleEntries(opts);
    } catch (error) {
      throw this.wrapError(error, 'Failed to find stale entries');
    }
  }

  async findDuplicatePairs(opts: { threshold?: number; limit?: number; signal?: AbortSignal; onProgress?: (progress: unknown) => void | Promise<void> } = {}) {
    this.ensureInitialized();
    try {
      return await this.findDuplicates('duplicates.pairs', opts);
    } catch (error) {
      throw this.wrapError(error, 'Failed to find duplicate pairs');
    }
  }

  // ─── Cleanup cycle ──────────────────────────────────────────
  //
  // The SDK owns the process's single KnowledgeService instance, so every
  // consumer must come through here — a route constructing its own service
  // would give the sidecar two instances on one database file.

  async generateCleanupReport(
    opts: { unreadDays?: number; dupThreshold?: number; signal?: AbortSignal } = {},
  ): Promise<{ report: CleanupReport; created: boolean }> {
    this.ensureInitialized();
    try {
      const groups = await this.findDuplicates('duplicates.groups', { threshold: opts.dupThreshold, signal: opts.signal });
      return await this.service!.generateCleanupReport(opts, groups);
    } catch (error) {
      throw this.wrapError(error, 'Failed to generate cleanup report');
    }
  }

  getLatestCleanupReport(): { report: CleanupReport; candidates: CleanupCandidate[] } | null {
    this.ensureInitialized();
    try {
      return this.service!.getLatestCleanupReport();
    } catch (error) {
      throw this.wrapError(error, 'Failed to read cleanup report');
    }
  }

  countPendingCleanupCandidates(): number {
    this.ensureInitialized();
    try {
      return this.service!.countPendingCleanupCandidates();
    } catch (error) {
      throw this.wrapError(error, 'Failed to count pending cleanup candidates');
    }
  }

  getCleanupCandidate(id: string): CleanupCandidate | null {
    this.ensureInitialized();
    try {
      return this.service!.getCleanupCandidate(id);
    } catch (error) {
      throw this.wrapError(error, 'Failed to read cleanup candidate');
    }
  }

  getEntriesForCleanupCandidate(candidateId: string) {
    this.ensureInitialized();
    try {
      return this.service!.getEntriesForCleanupCandidate(candidateId);
    } catch (error) {
      throw this.wrapError(error, 'Failed to read cleanup candidate entries');
    }
  }

  previewMergedTags(members: { tags: string[] }[]): string[] {
    this.ensureInitialized();
    return this.service!.previewMergedTags(members);
  }

  async applyRemovalCandidate(candidateId: string) {
    this.ensureInitialized();
    try {
      return await this.service!.applyRemovalCandidate(candidateId);
    } catch (error) {
      throw this.wrapError(error, 'Failed to apply cleanup removal');
    }
  }

  async applyConsolidationCandidate(candidateId: string, draft: unknown, usedLlm = false) {
    this.ensureInitialized();
    try {
      return await this.service!.applyConsolidationCandidate(candidateId, draft, usedLlm);
    } catch (error) {
      throw this.wrapError(error, 'Failed to apply cleanup consolidation');
    }
  }

  dismissCleanupCandidate(candidateId: string): void {
    this.ensureInitialized();
    try {
      this.service!.dismissCleanupCandidate(candidateId);
    } catch (error) {
      throw this.wrapError(error, 'Failed to dismiss cleanup candidate');
    }
  }

  closeCleanupReport(reportId: string, extraStats: Record<string, unknown> = {}) {
    this.ensureInitialized();
    try {
      return this.service!.closeCleanupReport(reportId, extraStats);
    } catch (error) {
      throw this.wrapError(error, 'Failed to close cleanup report');
    }
  }

  async findDuplicateGroups(opts: { threshold?: number; limit?: number; signal?: AbortSignal; onProgress?: (progress: unknown) => void | Promise<void> } = {}) {
    this.ensureInitialized();
    try {
      return await this.findDuplicates('duplicates.groups', opts);
    } catch (error) {
      throw this.wrapError(error, 'Failed to find duplicate groups');
    }
  }

  private async findDuplicates(kind: 'duplicates.pairs' | 'duplicates.groups', opts: DuplicateJobOptions & { signal?: AbortSignal; onProgress?: (progress: unknown) => void | Promise<void> }): Promise<any[]> {
    const limit = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 100)));
    const key = `${kind}|${opts.threshold ?? 0.9}|${limit}`;
    if (opts.signal?.aborted) throw Object.assign(new Error('The operation was aborted'), { code: 'ABORT_ERR' });
    const inFlight = this.duplicateInFlight.get(key);
    if (inFlight) return inFlight;
    const fingerprint = this.currentDuplicateFingerprint(opts.threshold ?? 0.9);
    const cached = this.duplicateCache.get(key);
    if (cached?.fingerprint === fingerprint) return cached.result;
    const promise = this.run(kind, { threshold: opts.threshold, limit }, { signal: opts.signal, onProgress: opts.onProgress }).then((response) => {
      if (this.currentDuplicateFingerprint(opts.threshold ?? 0.9) === response.fingerprint) {
        this.duplicateCache.set(key, { fingerprint: response.fingerprint, result: response.result });
        while (this.duplicateCache.size > 8) this.duplicateCache.delete(this.duplicateCache.keys().next().value!);
      }
      return response.result;
    }).finally(() => this.duplicateInFlight.delete(key));
    this.duplicateInFlight.set(key, promise);
    opts.signal?.addEventListener('abort', () => {
      if (this.duplicateInFlight.get(key) === promise) this.duplicateInFlight.delete(key);
    }, { once: true });
    return promise;
  }

  private currentDuplicateFingerprint(threshold: number): string {
    if (!this.sqlite) return 'unavailable';
    try {
      return duplicateFingerprint(this.sqlite, threshold);
    } catch { return `${threshold}|unavailable`; }
  }

  async countByType(opts: { from?: string; to?: string } = {}) {
    this.ensureInitialized();
    try {
      return await this.service!.countByType(opts);
    } catch (error) {
      throw this.wrapError(error, 'Failed to count by type');
    }
  }

  async countByScope(opts: { from?: string; to?: string } = {}) {
    this.ensureInitialized();
    try {
      return await this.service!.countByScope(opts);
    } catch (error) {
      throw this.wrapError(error, 'Failed to count by scope');
    }
  }

  async countByAgent(opts: { from?: string; to?: string } = {}) {
    this.ensureInitialized();
    try {
      return await this.service!.countByAgent(opts);
    } catch (error) {
      throw this.wrapError(error, 'Failed to count by agent');
    }
  }

  async countByPlatform(opts: { from?: string; to?: string } = {}) {
    this.ensureInitialized();
    try {
      return await this.service!.countByPlatform(opts);
    } catch (error) {
      throw this.wrapError(error, 'Failed to count by platform');
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

  async listAllKnowledge(): Promise<KnowledgeEntry[]> {
    this.ensureInitialized();
    try {
      return await this.service!.listAll();
    } catch (error) {
      throw this.wrapError(error, 'Failed to list all knowledge');
    }
  }

  async listScopes(): Promise<string[]> {
    this.ensureInitialized();
    try {
      return await this.service!.listScopes();
    } catch (error) {
      throw this.wrapError(error, 'Failed to list scopes');
    }
  }

  async bulkDeleteKnowledge(ids: string[]): Promise<{ deleted: number; errors: string[] }> {
    this.ensureInitialized();
    try {
      return await this.service!.bulkDelete(ids);
    } catch (error) {
      throw this.wrapError(error, 'Failed to bulk delete knowledge');
    }
  }

  async importKnowledge(entries: CreateKnowledgeInput[]): Promise<{ imported: number; skipped: number; errors: string[] }> {
    this.ensureInitialized();
    try {
      return await this.service!.importKnowledge(entries);
    } catch (error) {
      throw this.wrapError(error, 'Failed to import knowledge');
    }
  }

  async importPlans(plans: any[]): Promise<{ imported: number; skipped: number; errors: string[] }> {
    this.ensureInitialized();
    try {
      return await this.service!.importPlans(plans);
    } catch (error) {
      throw this.wrapError(error, 'Failed to import plans');
    }
  }

  listAllPlans(): Plan[] {
    this.ensureInitialized();
    return this.service!.listAllPlans();
  }

  // ─── Plans (separate entity) ─────────────────────────────────

  async createPlan(input: CreatePlanInput & { relatedKnowledgeIds?: string[]; tasks?: { description: string; priority?: string }[] }): Promise<Plan & { deduplicated?: boolean; deduplicatedAction?: string; dedupSkipped?: boolean; nearestPlanId?: string; hint?: string; lineageWarning?: string }> {
    this.ensureInitialized();
    const { relatedKnowledgeIds, ...rest } = input;
    const parsed = createPlanSchema.safeParse(rest);
    if (!parsed.success) {
      throw new ValidationError(`Invalid plan input: ${parsed.error.message}`);
    }
    try {
      const plan = await this.service!.createPlan(parsed.data as CreatePlanInput & { tasks?: { description: string; priority?: string }[] });
      if (relatedKnowledgeIds) {
        for (const kid of relatedKnowledgeIds) {
          try { this.service!.addPlanRelation(plan.id, kid, 'input'); } catch { /* silent */ }
        }
      }
      return plan;
    } catch (error) {
      throw this.wrapError(error, 'Failed to create plan');
    }
  }

  getPlanById(id: string): Plan | null {
    this.ensureInitialized();
    return this.service!.getPlanById(id);
  }

  updatePlan(id: string, updates: UpdatePlanInput): Plan | null {
    this.ensureInitialized();
    // No schema parse here by design — the service is the single validation
    // choke point for lineage, shared with the MCP server and the HTTP route.
    return this.service!.updatePlan(id, updates);
  }

  /** The full lineage chain a plan belongs to, root (the ORIGINAL) first. */
  getPlanChain(planId: string): PlanChain | null {
    this.ensureInitialized();
    return this.service!.getPlanChain(planId);
  }

  deletePlan(id: string): boolean {
    this.ensureInitialized();
    return this.service!.deletePlan(id);
  }

  /**
   * Both entry points converge here — the HTTP route (which may pass several
   * statuses) and the MCP `listPlans` tool (which passes at most one). This is
   * therefore the single place the `string | string[]` shape is normalised; every
   * layer below takes an array only. Duplicates are dropped here too: the list is
   * caller-supplied (an HTTP query string), and repeats would otherwise grow the
   * `IN (?,?,…)` placeholder list without changing the result.
   */
  listPlans(limit = 20, status?: string | readonly string[], scope?: string, offset = 0): Plan[] {
    this.ensureInitialized();
    const statuses = status === undefined ? undefined
      : [...new Set((typeof status === 'string' ? [status] : [...status]).filter(Boolean))];
    return this.service!.listPlans(limit, statuses?.length ? statuses : undefined, scope, offset);
  }

  async addPlanRelation(planId: string, knowledgeId: string, relationType: 'input' | 'output'): Promise<void> {
    this.ensureInitialized();
    // Guard: never link system knowledge to plans
    const entry = await this.service!.getById(knowledgeId);
    if (entry?.type === 'system') {
      return; // silently skip — system knowledge should not be linked to plans
    }
    this.service!.addPlanRelation(planId, knowledgeId, relationType);
  }

  async getPlanRelations(planId: string) {
    this.ensureInitialized();
    return this.service!.getPlanRelations(planId);
  }

  getPlansForKnowledge(knowledgeId: string) {
    this.ensureInitialized();
    return this.service!.getPlansForKnowledge(knowledgeId);
  }

  // ─── Plan Tasks ─────────────────────────────────────────────

  createPlanTask(input: { planId: string; description: string; priority?: string; notes?: string | null }): PlanTask {
    this.ensureInitialized();
    return this.service!.createPlanTask(input);
  }

  updatePlanTask(id: string, updates: { description?: string; status?: string; priority?: string; notes?: string | null; position?: number }): { task: PlanTask; planId: string; planStatus: string; progress: string; autoActions: string[] } | null {
    this.ensureInitialized();
    return this.service!.updatePlanTask(id, updates);
  }

  updatePlanTasks(updates: Array<{ taskId: string; status?: string; notes?: string | null }>): Array<{ task: PlanTask; planId: string; planStatus: string; progress: string; autoActions: string[] }> {
    this.ensureInitialized();
    const results: Array<{ task: PlanTask; planId: string; planStatus: string; progress: string; autoActions: string[] }> = [];
    for (const u of updates) {
      const result = this.service!.updatePlanTask(u.taskId, { status: u.status, notes: u.notes });
      if (result) results.push(result);
    }
    return results;
  }

  deletePlanTask(id: string): { deleted: boolean; planId: string; planStatus: string; progress: string; autoActions: string[] } {
    this.ensureInitialized();
    return this.service!.deletePlanTask(id);
  }

  listPlanTasks(planId: string): PlanTask[] {
    this.ensureInitialized();
    return this.service!.listPlanTasks(planId);
  }

  getPlanTaskStats() {
    this.ensureInitialized();
    return this.service!.getPlanTaskStats();
  }

  /**
   * Re-embed all knowledge entries and plans with the current embedding model.
   * Used during upgrade when switching embedding models (dimensions change).
   */
  async reembedAll(opts?: { signal?: AbortSignal; onProgress?: (progress: unknown) => void | Promise<void> }): Promise<number> {
    this.ensureInitialized();
    try { return await this.run('reembedAll', {}, opts); }
    finally { this.duplicateCache.clear(); }
  }

  /**
   * Incremental, resumable backfill of missing embeddings only — never drops
   * a table. Use this for routine repair; reembedAll() is only for a genuine
   * dimension migration where the vec tables were just recreated.
   */
  async embedMissing(opts?: {
    signal?: AbortSignal;
    onProgress?: (p: { phase: 'knowledge' | 'plans'; done: number; total: number; failed: number }) => void;
  }): Promise<{ embedded: number; failed: number; remaining: number; cancelled: boolean }> {
    this.ensureInitialized();
    try {
      return await this.run('embedMissing', {}, {
        signal: opts?.signal,
        onProgress: opts?.onProgress as ((progress: unknown) => void) | undefined,
      });
    } finally { this.duplicateCache.clear(); }
  }

  async embeddingCoverage() {
    this.ensureInitialized();
    return this.service!.embeddingCoverage();
  }

  // ─── Operations ─────────────────────────────────────────────

  getOperationCounts() {
    this.ensureInitialized();
    return this.service!.getOperationCounts();
  }

  getOperationsByDay(days: number = 15) {
    this.ensureInitialized();
    return this.service!.getOperationsByDay(days);
  }

  getPlansByDay(days: number = 15) {
    this.ensureInitialized();
    return this.service!.getPlansByDay(days);
  }

  reconcileOperationsDaily() {
    if (!this.initialized || !this.service) return 0;
    return this.service!.reconcileOperationsDaily();
  }

  cleanupOldOperations() {
    if (!this.initialized || !this.service) return 0;
    return this.service!.cleanupOldOperations();
  }

  // ─── Token usage ────────────────────────────────────────────

  async scanTokenUsage(): Promise<ScanResult> {
    this.ensureInitialized();
    return this.tokenService!.scan();
  }

  pruneTokenUsageBefore(cutoff: string, opts?: { signal?: AbortSignal }): Promise<number> {
    this.ensureInitialized();
    if (KnowledgeSDK.maintenanceRunning) {
      const error = new Error('Database maintenance is already running; retry shortly.') as Error & { code: string };
      error.code = 'DATABASE_LOCKED';
      return Promise.reject(error);
    }
    KnowledgeSDK.maintenanceRunning = true;
    return this.tokenService!.pruneBefore(cutoff, opts).finally(() => { KnowledgeSDK.maintenanceRunning = false; });
  }

  getTokenUsage(filter: TokenUsageFilter): TokenUsageAggregates {
    this.ensureInitialized();
    return this.tokenService!.getAggregates(filter);
  }

  cleanupCompletedPlanEmbeddings(maxAgeDays = 30) {
    if (!this.initialized || !this.service) return 0;
    return this.service!.cleanupCompletedPlanEmbeddings(maxAgeDays);
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

  /**
   * Remove orphan embeddings (no matching entry) and run VACUUM.
   * Returns count of orphans removed and final DB size.
   */
  async cleanupDatabase(): Promise<{ orphansRemoved: number; vacuumed: boolean }> {
    this.ensureInitialized();
    try {
      // Delete embeddings whose ID is not in knowledge_entries
      const orphanIds = this.sqlite!.prepare(
        `SELECT id FROM knowledge_embeddings_rowids WHERE id NOT IN (SELECT id FROM knowledge_entries)`
      ).all() as { id: string }[];

      let removed = 0;
      const deleteStmt = this.sqlite!.prepare(`DELETE FROM knowledge_embeddings WHERE id = ?`);
      for (const row of orphanIds) {
        deleteStmt.run(row.id);
        removed++;
      }

      // VACUUM to reclaim space
      this.sqlite!.exec('VACUUM');

      return { orphansRemoved: removed, vacuumed: true };
    } catch (error) {
      throw this.wrapError(error, 'Failed to cleanup database');
    }
  }

  /**
   * Run a passive WAL checkpoint to keep the WAL file small.
   * PASSIVE mode does not block readers or writers.
   */
  walCheckpoint(): void {
    this.ensureInitialized();
    this.sqlite!.pragma('wal_checkpoint(PASSIVE)');
  }

  /**
   * Instrument this SDK's database handle with a perf monitor (plan v2.6,
   * 1A.7). Call after `initialize()`; no-op before it.
   */
  attachPerfMonitor(monitor: { attach(sqlite: SQLiteDatabase): void }): void {
    if (this.sqlite) monitor.attach(this.sqlite);
  }

  /**
   * `PRAGMA optimize`: refresh query-planner statistics where SQLite thinks they
   * are stale. Cheap when nothing changed; run on close and by the sidecar's
   * 6-hour maintenance (plan v2.6, 1A.1).
   */
  optimize(): void {
    this.ensureInitialized();
    this.sqlite!.pragma('optimize');
  }

  /**
   * Write the buffered operation counters and read marks now (plan v2.6,
   * 1A.2/1A.3). Synchronous, so it is safe in a process 'exit' handler.
   * No-op when not initialized.
   */
  flushPendingWrites(): void {
    try { this.service?.flushPendingWrites(); } catch { /* best-effort */ }
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.service) {
      throw new ConnectionError('SDK not initialized. Call initialize() first.');
    }
  }

  private async cleanup(): Promise<void> {
    if (this.sqlite) {
      this.flushPendingWrites();
      this.service?.stopPendingWriteTimers();
      try { this.sqlite.pragma('optimize'); } catch { /* read-only or busy: skip */ }
      try {
        this.sqlite.close();
      } catch {
        // Ignore cleanup errors
      }
      this.sqlite = null;
      this.duplicateCache.clear();
    }
    this.db = null;
    this.service = null;
    this.tokenService = null;
  }

  /**
   * Detect if stored embeddings have different dimensions than config.
   * If mismatch found (e.g., 768→256 Matryoshka migration), drop vec tables,
   * recreate at new dimensions, and re-embed all entries.
   */
  private async detectAndMigrateDimensions(): Promise<void> {
    const targetDims = this.config.ollama.dimensions;

    try {
      const sampleRow = this.sqlite!.prepare(
        'SELECT embedding FROM knowledge_embeddings LIMIT 1'
      ).get() as { embedding: Buffer } | undefined;

      if (!sampleRow) return; // No embeddings yet, nothing to migrate

      const currentDims = sampleRow.embedding.byteLength / 4; // float32 = 4 bytes
      if (currentDims === targetDims) return; // Dimensions match, no migration needed

      console.error(`[CogniStore] Embedding dimension mismatch: DB has ${currentDims}d, config wants ${targetDims}d. Re-embedding all entries...`);

      // Drop and recreate both vec tables at new dimensions
      this.sqlite!.exec('DROP TABLE IF EXISTS knowledge_embeddings');
      this.sqlite!.exec('DROP TABLE IF EXISTS plans_embeddings');
      createEmbeddingsTable(this.sqlite!, targetDims);
      this.sqlite!.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS plans_embeddings USING vec0(
          id TEXT PRIMARY KEY,
          embedding float[${targetDims}] distance_metric=cosine
        )
      `);

      // Re-embed all entries with new dimensions
      const count = await this.run('reembedAll', {});
      this.duplicateCache.clear();
      console.error(`[CogniStore] Re-embedded ${count} entries at ${targetDims} dimensions`);
    } catch (error) {
      // Non-fatal: if migration fails, existing search still works (just with old dims)
      console.error(`[CogniStore] Dimension migration failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.duplicateCache.clear();
    }
  }

  private wrapError(error: unknown, context: string): Error {
    if (error instanceof Error && error.name.endsWith('Error')) {
      return error;
    }
    return new ConnectionError(`${context}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
