import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { KnowledgeSDK } from '@ai-knowledge/sdk';
import type {
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
  SearchOptions,
} from '@ai-knowledge/shared';

const execAsync = promisify(execCb);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.DASHBOARD_PORT) || 3210;

// Ensure common Docker paths are in PATH for child_process calls
const EXTRA_PATHS = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin'];
const currentPath = process.env.PATH || '';
const missingPaths = EXTRA_PATHS.filter((p) => !currentPath.includes(p));
if (missingPaths.length > 0) {
  process.env.PATH = `${missingPaths.join(':')}:${currentPath}`;
}

// Resolve project root: from dist-server/ → apps/dashboard/ → apps/ → root
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const COMPOSE_PATH = resolve(PROJECT_ROOT, 'docker', 'docker-compose.yml');

async function start() {
  const sdk = new KnowledgeSDK({
    autoStart: false,
  });

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
    // Retry initialization periodically if not ready
    retryInterval = setInterval(async () => {
      await tryInitSDK();
      if (sdkReady) {
        console.log('SDK initialized successfully (recovered from degraded mode)');
      }
    }, 10000);
  }

  // Detect compose command — try standalone first (more common on macOS Homebrew)
  let composeCmd = 'docker-compose';
  try {
    await execAsync('docker-compose version');
  } catch {
    try {
      await execAsync('docker compose version');
      composeCmd = 'docker compose';
    } catch {
      console.warn('No docker compose command found — admin actions will fail');
    }
  }

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // Serve Vite-built frontend
  const distPath = join(__dirname, '..', 'dist');
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
        docker: { running: false, containers: [] },
      };
    }
    const health = await sdk.healthCheck();
    // If DB and Ollama are connected, Docker is implicitly running
    // and containers are healthy even if docker CLI is not in PATH
    if (health.database.connected && health.ollama.connected) {
      health.docker.running = true;
      // Only override containers if they weren't detected by docker CLI
      if (!health.docker.containers || health.docker.containers.length === 0) {
        health.docker.containers = [
          { name: 'kb-postgres', status: 'running' },
          { name: 'kb-ollama', status: 'running' },
        ];
      }
    }
    // Docker is only "running" if at least one container is actually running
    if (health.docker.containers && health.docker.containers.length > 0) {
      const anyRunning = health.docker.containers.some((c: any) => c.status === 'running');
      health.docker.running = anyRunning;
    }
    return health;
  });

  // Admin: Repair — restart containers and re-initialize SDK
  // Uses `up -d` (without -v) so Docker volumes (kb_pgdata, kb_ollama) are preserved.
  // User's knowledge data in PostgreSQL survives repair operations.
  app.post('/api/admin/repair', async () => {
    try {
      // Start/restart only core services (postgres + ollama), preserving volumes
      await execAsync(
        `${composeCmd} -f "${COMPOSE_PATH}" up -d --build postgres ollama`,
        { timeout: 300000 }
      );

      // Wait a few seconds for services to be ready
      await new Promise((r) => setTimeout(r, 5000));

      // Re-initialize SDK
      if (sdkReady) {
        await sdk.close();
        sdkReady = false;
      }
      await tryInitSDK();

      return { success: true, message: 'Infrastructure repaired successfully' };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  // Admin: Uninstall — stop containers, remove volumes, shut down server
  // Uses `down -v` which DELETES Docker volumes (kb_pgdata, kb_ollama).
  // This permanently removes all knowledge data and Ollama models.
  app.post('/api/admin/uninstall', async (_request, reply) => {
    try {
      // Close SDK connection before tearing down containers
      if (sdkReady) {
        await sdk.close();
        sdkReady = false;
      }

      // Stop containers, remove them, AND delete volumes (all user data erased)
      await execAsync(
        `${composeCmd} -f "${COMPOSE_PATH}" down -v --remove-orphans`,
        { timeout: 120000 }
      );

      reply.send({ success: true, message: 'Infrastructure removed. Server shutting down.' });

      // Shut down the server after response is sent
      setTimeout(async () => {
        await app.close();
        process.exit(0);
      }, 1000);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
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
