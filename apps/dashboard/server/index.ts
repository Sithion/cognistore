import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { KnowledgeSDK } from '@ai-knowledge/sdk';
import type {
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
  SearchOptions,
} from '@ai-knowledge/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.DASHBOARD_PORT) || 3210;

async function start() {
  const sdk = new KnowledgeSDK();

  let sdkReady = false;
  let sdkError: string | null = null;
  let retryInterval: ReturnType<typeof setInterval> | null = null;

  const tryInitSDK = async () => {
    try {
      await sdk.initialize();
      sdkReady = true;
      sdkError = null;
      if (retryInterval) {
        clearInterval(retryInterval);
        retryInterval = null;
      }
      return true;
    } catch (error) {
      sdkError = error instanceof Error ? error.message : String(error);
      return false;
    }
  };

  // Try to initialize SDK — if it fails, server still starts in degraded mode
  const initOk = await tryInitSDK();
  if (!initOk) {
    console.warn(`SDK initialization failed (degraded mode): ${sdkError}`);
    retryInterval = setInterval(async () => {
      await tryInitSDK();
      if (sdkReady) {
        console.log('SDK initialized successfully (recovered from degraded mode)');
      }
    }, 10000);
  }

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // Serve Vite-built frontend (DASHBOARD_DIST_PATH used by Tauri sidecar)
  const distPath = process.env.DASHBOARD_DIST_PATH || join(__dirname, '..', 'dist');
  await app.register(fastifyStatic, {
    root: distPath,
    prefix: '/',
    wildcard: false,
  });

  // SPA fallback — serve index.html for non-API routes
  app.setNotFoundHandler(async (_request, reply) => {
    return reply.sendFile('index.html');
  });

  // Helper: check SDK readiness and return 503 if not ready
  const ensureReady = (reply: any) => {
    if (!sdkReady) {
      reply.code(503);
      return { error: 'Service unavailable', message: sdkError || 'Infrastructure services are not running' };
    }
    return null;
  };

  // Health — always available, even in degraded mode
  app.get('/api/health', async () => {
    if (!sdkReady) {
      return {
        database: { connected: false, error: sdkError || 'Not initialized' },
        ollama: { connected: false, model: null, error: sdkError || 'Not initialized' },
      };
    }
    return sdk.healthCheck();
  });

  // Stats
  app.get('/api/stats', async (_request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    return sdk.getStats();
  });

  // Tags
  app.get('/api/tags', async (_request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    return sdk.listTags();
  });

  // Recent knowledge entries
  app.get('/api/knowledge/recent', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const limit = Number((request.query as any).limit) || 20;
    return sdk.listRecent(limit);
  });

  // Search knowledge
  app.post<{ Body: Record<string, unknown> }>('/api/knowledge/search', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const body = request.body as any;
    const { query, ...options } = body;
    if (!query || typeof query !== 'string') {
      throw new Error('Query is required and must be a string');
    }
    return sdk.getKnowledge(query, options as Partial<SearchOptions>);
  });

  // Get by ID
  app.get<{ Params: { id: string } }>('/api/knowledge/:id', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const entry = await sdk.getKnowledgeById(request.params.id);
    if (!entry) {
      return { error: 'Not found' };
    }
    return entry;
  });

  // Create
  app.post<{ Body: CreateKnowledgeInput }>('/api/knowledge', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    return sdk.addKnowledge(request.body);
  });

  // Update
  app.put<{ Params: { id: string }; Body: UpdateKnowledgeInput }>('/api/knowledge/:id', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const result = await sdk.updateKnowledge(request.params.id, request.body);
    if (!result) {
      return { error: 'Not found' };
    }
    return result;
  });

  // Delete
  app.delete<{ Params: { id: string } }>('/api/knowledge/:id', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const deleted = await sdk.deleteKnowledge(request.params.id);
    return { deleted };
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Dashboard API running at http://localhost:${PORT}${sdkReady ? '' : ' (degraded mode)'}`);

  const shutdown = async () => {
    if (sdkReady) await sdk.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((error) => {
  console.error('Failed to start dashboard server:', error);
  process.exit(1);
});
