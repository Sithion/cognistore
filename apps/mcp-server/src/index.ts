import { appendFile } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { KnowledgeSDK, createPerfMonitor } from '@cognistore/sdk';
import { createServer } from './server.js';

/**
 * Opt-in performance lines for agent sessions (plan v2.6, 1A.7): with
 * COGNISTORE_PERF=1 this process reports event-loop delay and slow / busy
 * database calls as `[perf]` lines on STDERR — never stdout, which carries the
 * JSON-RPC stream — and also appends them to COGNISTORE_PERF_LOG when set.
 * COGNISTORE_PERF_INTERVAL_MS overrides the 5-minute summary interval.
 */
function startPerfMonitor(sdk: KnowledgeSDK): void {
  if (process.env.COGNISTORE_PERF !== '1') return;
  const logFile = process.env.COGNISTORE_PERF_LOG;
  const tag = `[mcp pid=${process.pid}]`;
  const emit = (lines: string[]) => {
    const ts = new Date().toISOString();
    const text = lines.map((l) => `[${ts}] ${tag} ${l}\n`).join('');
    process.stderr.write(text);
    if (logFile) appendFile(logFile, text).catch(() => { /* never crash the server over logging */ });
  };
  const monitor = createPerfMonitor({
    intervalMs: Number(process.env.COGNISTORE_PERF_INTERVAL_MS) || undefined,
    write: emit,
    warn: (line) => emit([line]),
  });
  sdk.attachPerfMonitor(monitor);
}

async function main() {
  const sdk = new KnowledgeSDK();

  try {
    await sdk.initialize();
  } catch (error) {
    console.error('Failed to initialize CogniStore SDK:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  startPerfMonitor(sdk);
  // Buffered operation counters and read marks (plan v2.6, 1A.2/1A.3) must
  // reach the database however the process ends; better-sqlite3 is
  // synchronous, so this works inside 'exit'.
  process.on('exit', () => sdk.flushPendingWrites());

  const server = createServer(sdk);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  const shutdown = async () => {
    await sdk.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
