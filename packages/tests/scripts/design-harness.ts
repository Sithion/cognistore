// Shared fixture for the /_design capture tools: a temporary SQLite DB with a few fake,
// non-personal entries, a mock Ollama and the real built sidecar serving the built dashboard.
// Never touches the real ~/.cognistore.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createDbClient, KnowledgeRepository, KnowledgeService } from '@cognistore/core';
import { KnowledgeType, DEFAULT_EMBEDDING_DIMENSIONS } from '@cognistore/shared';
import { getFreePort, startMockOllama, TEST_TOKEN, waitForSidecar } from '../src/sidecar-helpers.ts';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');
export const OUTPUT_DIR = resolve(REPO_ROOT, 'documentation/plans/reports/assets/rodada-7');
export { TEST_TOKEN };

const FIXTURE: Array<[string, string, string[]]> = [
  ['A reliable design token', 'Prefer semantic color tokens to hardcoded values.', ['design', 'frontend']],
  ['SQLite stays local', 'The sidecar keeps the knowledge base on this device.', ['privacy', 'sqlite']],
  ['Keyboard shortcuts', 'Use command palettes to make navigation fast.', ['ux', 'keyboard']],
  ['Avoid blocking the event loop', 'Move expensive scans to a worker and yield between batches.', ['performance', 'workers']],
  ['Batch writes in one transaction', 'Group inserts so the shared database file sees one short lock.', ['sqlite', 'performance']],
  ['Prefer background jobs for slow work', 'Anything over ~50 ms on a large base runs off the request path.', ['workers', 'architecture']],
];

export async function startHarness(opts: { distPath?: string } = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), 'cognistore-design-capture-'));
  const dbPath = join(sandbox, 'knowledge.db');
  const { sqlite, db } = createDbClient(dbPath);
  const service = new KnowledgeService(new KnowledgeRepository(db, sqlite), {
    async embed(text: string) { const v = new Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0); v[0] = text.length || 1; return v; },
  } as never);
  for (const [title, content, tags] of FIXTURE) {
    await service.add({ title, content, tags, type: KnowledgeType.PATTERN, scope: 'workspace:cognistore', source: 'design-fixture', skipDedup: true });
  }
  sqlite.close();

  const mock = await startMockOllama('nomic-embed-text');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const sidecar = spawn(process.execPath, [resolve(REPO_ROOT, 'apps/dashboard/dist-server/index.js')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env, HOME: sandbox, COGNISTORE_HOME: join(sandbox, '.cognistore'), SQLITE_PATH: dbPath,
      DASHBOARD_PORT: String(port), SIDECAR_TOKEN: TEST_TOKEN, OLLAMA_HOST: `http://127.0.0.1:${mock.port}`,
      OLLAMA_MODEL: 'nomic-embed-text', DASHBOARD_DIST_PATH: opts.distPath ?? resolve(REPO_ROOT, 'apps/dashboard/dist'),
    },
    stdio: 'ignore',
  });
  if (!await waitForSidecar(baseUrl)) throw new Error('Temporary sidecar did not become ready');
  mkdirSync(OUTPUT_DIR, { recursive: true });
  return {
    baseUrl, port,
    async stop() {
      sidecar.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      mock.server.close();
      rmSync(sandbox, { recursive: true, force: true });
    },
  };
}
