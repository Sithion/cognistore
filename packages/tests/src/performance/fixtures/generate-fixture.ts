import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbClient, insertEmbedding } from '@cognistore/core';
import { DEFAULT_EMBEDDING_DIMENSIONS } from '@cognistore/shared';

/**
 * Deterministic large-database fixture for performance tests (plan v2.6, 0.3).
 *
 * Same options + same seed => same rows, so baselines are comparable across
 * runs and machines. The generated file is cached in the OS temp dir (the name
 * encodes FIXTURE_VERSION and every option); suites must COPY it before use
 * (copyFixture) because the code under test writes (logOp, markRead, scans).
 *
 * Bump FIXTURE_VERSION whenever the generated content changes.
 */
export const FIXTURE_VERSION = 1;

export interface FixtureOptions {
  entries?: number;
  tokenRows?: number;
  opsRows?: number;
  /** Share of entries that belong to near-duplicate clusters (2–5 members, pairwise cosine ≈ 0.97). */
  dupRatio?: number;
  seed?: number;
}

export interface FixtureStats {
  entries: number;
  duplicateClusters: number;
  duplicateMembers: number;
  tokenRows: number;
  opsRows: number;
  generatedMs: number;
}

export const DEFAULT_FIXTURE: Required<FixtureOptions> = {
  entries: 10_000,
  tokenRows: 200_000,
  opsRows: 50_000,
  dupRatio: 0.05,
  seed: 42,
};

/** Fixed reference date so content never depends on when the fixture is built. */
const REFERENCE_MS = Date.UTC(2026, 9, 1);
const SPAN_DAYS = 180;
const DAY_MS = 86_400_000;

const WORDS = (
  'sqlite cache index query plan vector embedding search scope tag token session agent hook skill ' +
  'migration schema sidecar tauri fastify worker thread lock transaction commit rollback wal fsync ' +
  'latency budget memory buffer batch insert update delete select join filter sort page offset limit ' +
  'react redux router dashboard widget theme sidebar palette command shortcut modal panel toast ' +
  'ollama model prompt context window chunk merge duplicate cluster curation archive restore undo ' +
  'release version upgrade patch build test coverage lint type check deploy pipeline secret key ' +
  'error retry timeout backoff queue job scheduler timer interval event loop delay histogram metric'
).split(' ');
const TAGS = Array.from({ length: 60 }, (_, i) => `${WORDS[(i * 7) % WORDS.length]}-${i}`);
const TYPES = ['pattern', 'pattern', 'pattern', 'gotcha', 'gotcha', 'gotcha', 'decision', 'fix', 'constraint'];
const SCOPES = ['global', 'global', 'global', 'global', 'global', 'global',
  ...Array.from({ length: 10 }, (_, i) => `workspace:project-${i}`)];
const PLATFORMS = ['claude-code', 'claude-code', 'claude-code', 'copilot', 'opencode'];
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'gpt-6-luna', 'gemini-3.8-flash'];

/** mulberry32 — small, fast, deterministic. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(arr: readonly T[]) => arr[int(arr.length)];
  const hex = (len: number) => {
    let s = '';
    while (s.length < len) s += ((next() * 0x100000000) >>> 0).toString(16).padStart(8, '0');
    return s.slice(0, len);
  };
  return { next, gauss, int, pick, hex };
}
type Rng = ReturnType<typeof makeRng>;

const uuid = (rng: Rng) => {
  const h = rng.hex(32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const isoInSpan = (rng: Rng) => new Date(REFERENCE_MS - rng.next() * SPAN_DAYS * DAY_MS).toISOString();

function normalize(v: number[]): number[] {
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag) || 1;
  return v.map((x) => x / mag);
}

function randomVector(rng: Rng, dims: number): number[] {
  return normalize(Array.from({ length: dims }, () => rng.gauss()));
}

/** 0.5–10 KB, skewed small (mean ≈ 2.4 KB, like real bases). */
function randomContent(rng: Rng): string {
  const target = 500 + Math.floor(Math.pow(rng.next(), 4) * 9500);
  const parts: string[] = [];
  let len = 0;
  while (len < target) {
    const sentenceWords = 6 + rng.int(12);
    const words: string[] = [];
    for (let i = 0; i < sentenceWords; i++) words.push(rng.pick(WORDS));
    const sentence = `${words.join(' ')}.`;
    parts.push(sentence);
    len += sentence.length + 1;
  }
  return parts.join(' ').slice(0, target);
}

function randomTags(rng: Rng): string[] {
  const n = 1 + rng.int(5);
  const set = new Set<string>();
  while (set.size < n) set.add(rng.pick(TAGS));
  return [...set];
}

export function fixturePath(opts: FixtureOptions = {}): string {
  const o = { ...DEFAULT_FIXTURE, ...opts };
  return join(
    tmpdir(),
    `cognistore-perf-fixture-v${FIXTURE_VERSION}-${o.entries}e-${o.tokenRows}t-${o.opsRows}o-d${o.dupRatio}-s${o.seed}.db`,
  );
}

/** Build the fixture at `path` (overwrites). Returns what was generated. */
export function generateFixture(path: string, opts: FixtureOptions = {}): FixtureStats {
  const o = { ...DEFAULT_FIXTURE, ...opts };
  const started = performance.now();
  const rng = makeRng(o.seed);
  const dims = DEFAULT_EMBEDDING_DIMENSIONS;
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });

  const { sqlite } = createDbClient(path);
  let duplicateClusters = 0;
  let duplicateMembers = 0;
  try {
    const insertEntry = sqlite.prepare(
      `INSERT INTO knowledge_entries
         (id, title, content, tags, type, scope, source, version, confidence_score, agent_id, platform,
          created_at, updated_at, last_read_at, read_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1.0, ?, ?, ?, ?, ?, ?)`,
    );
    const insertFts = sqlite.prepare('INSERT INTO knowledge_fts (id, title, content, tags) VALUES (?, ?, ?, ?)');
    const insertToken = sqlite.prepare(
      `INSERT INTO token_usage
         (id, source, model, project, session_id, message_id, occurred_at,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertOp = sqlite.prepare('INSERT INTO operations_log (operation, created_at) VALUES (?, ?)');

    const addEntry = (title: string, content: string, tags: string[], vector: number[]) => {
      const id = uuid(rng);
      const createdAt = isoInSpan(rng);
      const read = rng.next() < 0.8;
      insertEntry.run(
        id, title, content, JSON.stringify(tags), rng.pick(TYPES), rng.pick(SCOPES), 'perf-fixture',
        `agent-${rng.int(6)}`, rng.pick(PLATFORMS), createdAt, createdAt,
        read ? createdAt : null, read ? 1 + rng.int(30) : 0,
      );
      insertFts.run(id, title, content, tags.join(' '));
      insertEmbedding(sqlite, id, vector);
    };

    const dupTarget = Math.round(o.entries * o.dupRatio);

    sqlite.transaction(() => {
      let made = 0;
      // Near-duplicate clusters first: one base text/vector, members with small edits + noise.
      while (duplicateMembers < dupTarget && made < o.entries) {
        const size = Math.min(2 + rng.int(4), o.entries - made, dupTarget - duplicateMembers);
        if (size < 2) break;
        const baseTitle = `Cluster ${duplicateClusters}: ${rng.pick(WORDS)} ${rng.pick(WORDS)} ${rng.pick(WORDS)}`;
        const baseContent = randomContent(rng);
        const baseVector = randomVector(rng, dims);
        const tags = randomTags(rng);
        for (let m = 0; m < size; m++) {
          const vector = normalize(baseVector.map((x) => x + rng.gauss() * 0.01));
          addEntry(`${baseTitle} (v${m})`, `${baseContent} Variant ${m}: ${rng.pick(WORDS)}.`, tags, vector);
        }
        duplicateClusters++;
        duplicateMembers += size;
        made += size;
      }
      for (let i = made; i < o.entries; i++) {
        addEntry(
          `Entry ${i}: ${rng.pick(WORDS)} ${rng.pick(WORDS)} ${rng.pick(WORDS)}`,
          randomContent(rng), randomTags(rng), randomVector(rng, dims),
        );
      }
    })();

    sqlite.transaction(() => {
      for (let i = 0; i < o.tokenRows; i++) {
        const occurredAt = isoInSpan(rng);
        insertToken.run(
          rng.hex(32), rng.next() < 0.85 ? 'claude-code' : 'copilot-cli', rng.pick(MODELS),
          `project-${rng.int(15)}`, `sess-${rng.int(3000)}`, `msg-${i}`, occurredAt,
          rng.int(20_000), rng.int(4_000), rng.int(200_000), rng.int(30_000), occurredAt,
        );
      }
    })();

    sqlite.transaction(() => {
      for (let i = 0; i < o.opsRows; i++) {
        insertOp.run(rng.next() < 0.8 ? 'read' : 'write', isoInSpan(rng));
      }
    })();

    sqlite.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    sqlite.close();
  }
  return {
    entries: o.entries,
    duplicateClusters,
    duplicateMembers,
    tokenRows: o.tokenRows,
    opsRows: o.opsRows,
    generatedMs: performance.now() - started,
  };
}

/**
 * Return the cached fixture for `opts`, generating it on first use. Writes to a
 * per-process temp name and renames, so concurrent workers never see a partial file.
 */
export function ensureFixture(opts: FixtureOptions = {}): { path: string; cached: boolean; stats?: FixtureStats } {
  const path = fixturePath(opts);
  if (existsSync(path)) return { path, cached: true };
  const partial = `${path}.${process.pid}.partial`;
  const removePartial = () => { for (const suffix of ['', '-wal', '-shm']) rmSync(partial + suffix, { force: true }); };
  try {
    const stats = generateFixture(partial, opts);
    renameSync(partial, path);
    removePartial();
    return { path, cached: false, stats };
  } catch (err) {
    removePartial();
    throw err;
  }
}

/** Copy the fixture into `dir` as knowledge.db; returns the copy's path. */
export function copyFixture(fixture: string, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, 'knowledge.db');
  copyFileSync(fixture, dest);
  return dest;
}

export interface JsonlOptions {
  projects?: number;
  filesPerProject?: number;
  linesPerFile?: number;
  seed?: number;
}

/**
 * Claude Code–style session logs for token-scan tests: `<root>/<project-folder>/<session>.jsonl`.
 * Every third line is a user message without `usage` (ignored by the scanner).
 * Returns how many lines carry usage, i.e. how many rows a full scan inserts.
 */
export function generateTokenJsonlDir(root: string, opts: JsonlOptions = {}): { files: number; usageLines: number } {
  const { projects = 34, filesPerProject = 50, linesPerFile = 20, seed = 7 } = opts;
  const rng = makeRng(seed);
  let files = 0;
  let usageLines = 0;
  for (let p = 0; p < projects; p++) {
    const dir = join(root, `-home-user-Projects-project-${p}`);
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < filesPerProject; f++) {
      const sessionId = uuid(rng);
      const lines: string[] = [];
      for (let l = 0; l < linesPerFile; l++) {
        const timestamp = isoInSpan(rng);
        if (l % 3 === 0) {
          lines.push(JSON.stringify({ type: 'user', timestamp, sessionId, message: { role: 'user', content: 'hi' } }));
          continue;
        }
        usageLines++;
        lines.push(JSON.stringify({
          type: 'assistant', timestamp, sessionId, uuid: uuid(rng),
          message: {
            id: `msg_${rng.hex(24)}`, model: rng.pick(MODELS),
            usage: {
              input_tokens: rng.int(20_000), output_tokens: rng.int(4_000),
              cache_read_input_tokens: rng.int(200_000), cache_creation_input_tokens: rng.int(30_000),
            },
          },
        }));
      }
      writeFileSync(join(dir, `${sessionId}.jsonl`), `${lines.join('\n')}\n`);
      files++;
    }
  }
  return { files, usageLines };
}
