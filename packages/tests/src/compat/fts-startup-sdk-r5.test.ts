import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbClient } from '@cognistore/core';
import { KnowledgeSDK } from '@cognistore/sdk';
import { DEFAULT_EMBEDDING_DIMENSIONS, KnowledgeType } from '@cognistore/shared';
import { startMockOllama } from '../sidecar-helpers.js';

const MODEL = 'nomic-embed-text';

test.describe.configure({ timeout: 120_000 });

test('initialize repairs missing FTS rows in the background and handles repair rejection', async () => {
  const work = mkdtempSync(join(tmpdir(), 'cognistore-fts-startup-sdk-'));
  const path = join(work, 'knowledge.db');
  const mock = await startMockOllama(MODEL);
  const config = {
    database: { path },
    ollama: { host: `http://127.0.0.1:${mock.port}`, model: MODEL, dimensions: DEFAULT_EMBEDDING_DIMENSIONS },
  };
  let writer: KnowledgeSDK | undefined;
  let sdk: KnowledgeSDK | undefined;
  let rejectedRepairSdk: KnowledgeSDK | undefined;

  try {
    writer = new KnowledgeSDK(config);
    await writer.initialize();
    const entries = [];
    for (const [index, keyword] of ['amber-orbit', 'cobalt-meadow', 'silver-harbor'].entries()) {
      entries.push(await writer.addKnowledge({
        title: `FTS startup ${keyword}`,
        content: `Unique searchable phrase ${keyword} for startup repair coverage.`,
        tags: ['fts-startup'],
        type: KnowledgeType.PATTERN,
        scope: `workspace:fts-startup-${index}`,
        source: 'fts-startup-sdk-r5.test',
      }));
    }
    await writer.waitForFtsRepair();
    await writer.close();
    writer = undefined;

    const { sqlite } = createDbClient(path);
    try {
      sqlite.prepare('DELETE FROM knowledge_fts WHERE id IN (?, ?)').run(entries[0].id, entries[1].id);
    } finally {
      sqlite.close();
    }

    sdk = new KnowledgeSDK(config);
    await sdk.initialize();
    await sdk.waitForFtsRepair();
    const { sqlite: repairedDb } = createDbClient(path);
    try {
      const missing = (repairedDb.prepare("SELECT count(*) AS n FROM knowledge_entries WHERE type != 'system' AND id NOT IN (SELECT id FROM knowledge_fts)").get() as { n: number }).n;
      expect(missing).toBe(0);
    } finally {
      repairedDb.close();
    }
    const hits = await sdk.getKnowledge('amber-orbit', { threshold: 0 });
    expect(hits.map((hit) => hit.entry.id)).toContain(entries[0].id);
    await sdk.close();
    sdk = undefined;

    // Exercise initialize()'s rejection callback. waitForFtsRepair() is specified
    // to resolve even when the background job fails.
    const { sqlite: damageDb } = createDbClient(path);
    try {
      damageDb.prepare('DELETE FROM knowledge_fts WHERE id = ?').run(entries[2].id);
    } finally {
      damageDb.close();
    }
    rejectedRepairSdk = new KnowledgeSDK(config);
    rejectedRepairSdk.run = (() => Promise.reject(new Error('controlled FTS repair failure'))) as typeof rejectedRepairSdk.run;
    const warn = console.warn;
    console.warn = () => {};
    try {
      await rejectedRepairSdk.initialize();
      await expect(rejectedRepairSdk.waitForFtsRepair()).resolves.toBeUndefined();
    } finally {
      console.warn = warn;
    }
  } finally {
    await writer?.close();
    await sdk?.close();
    await rejectedRepairSdk?.close();
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    rmSync(work, { recursive: true, force: true });
  }
});

test('initialize with a complete FTS index starts no repair', async () => {
  const work = mkdtempSync(join(tmpdir(), 'cognistore-fts-complete-sdk-'));
  const path = join(work, 'knowledge.db');
  const mock = await startMockOllama(MODEL);
  const config = {
    database: { path },
    ollama: { host: `http://127.0.0.1:${mock.port}`, model: MODEL, dimensions: DEFAULT_EMBEDDING_DIMENSIONS },
  };
  let sdk: KnowledgeSDK | undefined;

  try {
    sdk = new KnowledgeSDK(config);
    await sdk.initialize();
    for (const [index, keyword] of ['maple-signal', 'violet-river', 'copper-cloud'].entries()) {
      await sdk.addKnowledge({
        title: `Complete FTS ${keyword}`,
        content: `Complete index entry ${keyword}.`,
        tags: ['fts-startup'],
        type: KnowledgeType.PATTERN,
        scope: `workspace:fts-complete-${index}`,
        source: 'fts-startup-sdk-r5.test',
      });
    }
    await sdk.waitForFtsRepair();

    // Re-open a fresh SDK after entries were indexed, then verify no repair is scheduled.
    await sdk.close();
    sdk = new KnowledgeSDK(config);
    await sdk.initialize();
    await expect(Promise.race([
      sdk.waitForFtsRepair(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('FTS wait exceeded 100 ms')), 100)),
    ])).resolves.toBeUndefined();
  } finally {
    await sdk?.close();
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    rmSync(work, { recursive: true, force: true });
  }
});
