import { test, expect } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbClient, KnowledgeRepository } from '@cognistore/core';
import { DEFAULT_EMBEDDING_DIMENSIONS, KnowledgeType } from '@cognistore/shared';
import {
  authFetch,
  getFreePort,
  spawnSidecar,
  waitForSidecar,
  stopSidecar,
  startMockOllama,
  TEST_TOKEN,
} from '../sidecar-helpers.js';

test('sidecar startup repairs missing FTS rows in its child process', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cognistore-fts-startup-sidecar-'));
  const dbPath = join(home, 'knowledge.db');
  const mock = await startMockOllama('nomic-embed-text');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let child: ReturnType<typeof spawnSidecar>['child'] | undefined;

  try {
    const { db, sqlite } = createDbClient(dbPath);
    const repository = new KnowledgeRepository(db, sqlite);
    const entries = [];
    try {
      for (const [index, keyword] of ['amber-orbit', 'cobalt-meadow', 'silver-harbor'].entries()) {
        entries.push(await repository.create({
          title: `FTS sidecar ${keyword}`,
          content: `Searchable sidecar startup entry ${keyword}.`,
          tags: ['fts-startup'],
          type: KnowledgeType.PATTERN,
          scope: `workspace:fts-sidecar-${index}`,
          source: 'fts-startup-sidecar-r5.test',
          embedding: new Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0),
        }));
      }
    } finally {
      sqlite.close();
    }

    const damagedDb = new BetterSqlite3(dbPath);
    try {
      damagedDb.prepare('DELETE FROM knowledge_fts WHERE id IN (?, ?)').run(entries[0].id, entries[1].id);
    } finally {
      damagedDb.close();
    }

    const spawned = spawnSidecar({
      HOME: home,
      COGNISTORE_HOME: join(home, '.cognistore'),
      SQLITE_PATH: dbPath,
      DASHBOARD_PORT: String(port),
      SIDECAR_TOKEN: TEST_TOKEN,
      OLLAMA_HOST: `http://127.0.0.1:${mock.port}`,
      OLLAMA_MODEL: 'nomic-embed-text',
    });
    child = spawned.child;

    expect(await waitForSidecar(baseUrl), spawned.readLog()).toBe(true);

    const deadline = Date.now() + 10_000;
    let missing = -1;
    while (Date.now() < deadline) {
      const reader = new BetterSqlite3(dbPath, { readonly: true });
      try {
        missing = (reader.prepare(
          "SELECT count(*) AS n FROM knowledge_entries WHERE type != 'system' AND id NOT IN (SELECT id FROM knowledge_fts)",
        ).get() as { n: number }).n;
      } finally {
        reader.close();
      }
      if (missing === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(missing).toBe(0);
  } finally {
    await stopSidecar(child);
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
});
