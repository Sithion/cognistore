import { createServer, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbClient, JobRunner, KnowledgeRepository, KnowledgeService } from '@cognistore/core';
import { KnowledgeSDK } from '@cognistore/sdk';
export async function mockEmbedding() {
  let hook: ((prompt: string) => Promise<void>) | undefined;
  const server = createServer(async (req, res: ServerResponse) => {
    if (req.url === '/api/tags') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ models: [{ name: 'nomic-embed-text' }] })); return; }
    let body = ''; for await (const chunk of req) body += chunk; const prompt = JSON.parse(body || '{}').prompt || '';
    try { await hook?.(prompt); } catch { res.writeHead(500); res.end('fixed embedding failure'); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ embedding: [1, ...Array(255).fill(0)] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing mock port');
  return { host: `http://127.0.0.1:${address.port}`, setHook(fn?: (prompt: string) => Promise<void>) { hook = fn; }, async close() { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}
export async function startSdk(path: string) {
  const mock = await mockEmbedding(); const sdk = new KnowledgeSDK({ database: { path }, ollama: { host: mock.host, model: 'nomic-embed-text', dimensions: 256 } });
  try { await sdk.initialize(); } catch (error) { await mock.close(); throw error; }
  return { sdk, mock, async close() { await sdk.close(); await mock.close(); } };
}
export async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'r5-worker-')); const path = join(dir, 'db'); const client = createDbClient(path); const started = await startSdk(path);
  return { dir, path, ...client, ...started, runner(workerUrl = new URL('../../sdk/dist/jobs/worker.js', import.meta.url)) { return new JobRunner({ workerUrl, databasePath: path, embeddingConfig: { host: started.mock.host, model: 'nomic-embed-text', dimensions: 256 } }); }, async close() { await started.close(); client.sqlite.close(); rmSync(dir, { recursive: true, force: true }); } };
}

export function forbidMain(methods: (keyof KnowledgeRepository | keyof KnowledgeService)[]) {
  const originals = new Map<string, { owner: any; method: (...args: any[]) => any }>();
  // Repository and service methods are patched on their prototype so SDK calls
  // fail if they fall back to the parent process implementation.
  for (const name of methods) {
    const owner: any = name in KnowledgeRepository.prototype ? KnowledgeRepository.prototype : KnowledgeService.prototype;
    const method = owner[name];
    originals.set(name, { owner, method });
    owner[name] = (..._args: any[]) => {
      throw new Error(`Parent implementation called: ${name}`);
    };
  }
  return () => { for (const [name, original] of originals) original.owner[name] = original.method; };
}
