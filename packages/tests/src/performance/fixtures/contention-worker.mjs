// One simulated agent session (an MCP server process) for the contention
// harness (plan v2.6, item 0.5). Usage:
//   node contention-worker.mjs <dbPath> <durationMs> <workerIndex>
// Searches with trackRead (the read path that also writes: buffered logOp + read marks)
// and adds an entry every 25 iterations, then prints ONE JSON line with its
// counters on stdout and exits 0. Any thrown error exits 1.
// `busyThrown` only sees errors that reach the caller: the buffered flushes swallow
// theirs, so `busyErrors` (from the instrumentation) is the real busy count.
import { setTimeout as sleep } from 'node:timers/promises';
import { createDbClient, instrumentDatabase, KnowledgeRepository, KnowledgeService } from '@cognistore/core';
import { DEFAULT_EMBEDDING_DIMENSIONS } from '@cognistore/shared';

const [dbPath, durationArg, indexArg] = process.argv.slice(2);
const durationMs = Number(durationArg);
const index = Number(indexArg);
const DIMS = DEFAULT_EMBEDDING_DIMENSIONS;

const embedder = {
  async embed(text) {
    const vec = new Array(DIMS).fill(0);
    for (let i = 0; i < text.length; i++) vec[i % DIMS] += text.charCodeAt(i) / 1000;
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / mag);
  },
};

const QUERIES = ['sqlite lock', 'token scan latency', 'duplicate cluster merge', 'event loop delay', 'hook skill agent'];

const { db, sqlite } = createDbClient(dbPath);
const instr = instrumentDatabase(sqlite, { slowMs: 100 });
const service = new KnowledgeService(new KnowledgeRepository(db, sqlite), embedder);

let iterations = 0;
let searches = 0;
let adds = 0;
let busyThrown = 0;
const searchMs = [];
const end = Date.now() + durationMs;

while (Date.now() < end) {
  try {
    if (iterations % 25 === 24) {
      await service.add({
        title: `Contention worker ${index} note ${iterations}`,
        content: `Written by worker ${index} at iteration ${iterations} while the others search.`,
        tags: ['perf', `worker-${index}`], type: 'pattern', scope: 'global', source: 'perf-contention',
      });
      adds++;
    } else {
      const start = performance.now();
      await service.search(QUERIES[(iterations + index) % QUERIES.length], { limit: 10, trackRead: true });
      searchMs.push(performance.now() - start);
      searches++;
    }
  } catch (err) {
    if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_BUSY')) busyThrown++;
    else throw err;
  }
  iterations++;
  await sleep(5);
}

// Read marks and operation counters are buffered (plan v2.6, 1A.2/1A.3):
// write them before the handle closes, as the MCP server's exit handler does.
service.flushPendingWrites();
sqlite.close();
searchMs.sort((a, b) => a - b);
const pct = (p) => (searchMs.length ? searchMs[Math.min(searchMs.length - 1, Math.floor(p * searchMs.length))] : 0);
console.log(JSON.stringify({
  worker: index, iterations, searches, adds, busyThrown,
  searchP50: Number(pct(0.5).toFixed(1)), searchP99: Number(pct(0.99).toFixed(1)),
  ...instr.stats(),
}));
