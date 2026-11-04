import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';

const command = process.env.COGNISTORE_MCP_BIN;
if (!command) throw new Error('COGNISTORE_MCP_BIN must point to the installed package executable');
const databasePath = '/tmp/cognistore-mcp-smoke.db';
const sqliteRequire = createRequire(process.env.COGNISTORE_MCP_PACKAGE_JSON);

const ollama = createHttpServer((request, response) => {
  if (request.url === '/api/tags') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ models: [{ name: 'nomic-embed-text:latest' }] }));
  } else if (request.url === '/api/embeddings') {
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ embedding: Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)) }));
  } else {
    response.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => ollama.listen(11434, '127.0.0.1', resolve).once('error', reject));

const server = spawn(command, [], {
  env: {
    ...process.env,
    SQLITE_PATH: databasePath,
    COGNISTORE_HOME: '/tmp/cognistore-home',
    OLLAMA_HOST: 'http://127.0.0.1:11434',
    OLLAMA_MODEL: 'nomic-embed-text',
  },
  stdio: ['pipe', 'pipe', 'inherit'],
});
const lines = createInterface({ input: server.stdout });
let nextId = 0;
const pending = new Map();
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  waiter(message);
});

function request(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for MCP ${method}`));
    }, 30_000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function notify(method, params = {}) {
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

async function callTool(name, args) {
  const result = await request('tools/call', { name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
  const text = result.content?.find((item) => item.type === 'text')?.text;
  if (!text) throw new Error(`${name} returned no text content`);
  return JSON.parse(text);
}

try {
  await request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'cognistore-no-toolchain-smoke', version: '1.0.0' },
  });
  notify('notifications/initialized');

  const tag = `no-toolchain-${process.pid}`;
  const added = await callTool('addKnowledge', {
    entries: {
      title: `Smoke ${tag}`,
      content: `Installed from an npm tarball in a container without a compiler: ${tag}`,
      tags: ['no-toolchain'],
      type: 'pattern',
      scope: `workspace:${tag}`,
      source: 'mcp-npx-smoke',
    },
  });
  const knowledgeId = added.id ?? added.entry?.id ?? added.entries?.[0]?.id ?? added[0]?.id;
  if (!knowledgeId) throw new Error(`addKnowledge returned no id: ${JSON.stringify(added)}`);

  const found = await callTool('getKnowledge', { query: tag, scope: `workspace:${tag}` });
  if (!JSON.stringify(found).includes(knowledgeId)) throw new Error('getKnowledge could not read the inserted entry');

  const plan = await callTool('createPlan', {
    title: `Smoke plan ${tag}`,
    content: 'Validate the MCP package from npm without a compiler.',
    tags: ['no-toolchain'],
    scope: `workspace:${tag}`,
    source: 'mcp-npx-smoke',
    tasks: [{ description: `Complete ${tag}` }],
  });
  const db = sqliteRequire('better-sqlite3')(databasePath, { readonly: true });
  const taskId = db.prepare('SELECT id FROM plan_tasks WHERE plan_id = ?').get(plan.id)?.id;
  db.close();
  if (!taskId) throw new Error(`createPlan returned no task id: ${JSON.stringify(plan)}`);

  const updated = await callTool('updatePlanTask', { taskId, status: 'in_progress' });
  if (updated.task?.status !== 'in_progress') throw new Error(`updatePlanTask failed: ${JSON.stringify(updated)}`);
  console.log('PASS: addKnowledge, getKnowledge, createPlan, updatePlanTask');
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
  await new Promise((resolve) => ollama.close(resolve));
}
