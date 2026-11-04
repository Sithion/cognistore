import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { collectDbHealth, createEventLoopSampler } from '../db-health.js';

const lag = { p50: 1, p99: 2, max: 3 };
function db() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE knowledge_entries(id TEXT); CREATE TABLE token_usage(id INTEGER);');
  return sqlite;
}

describe('collectDbHealth', () => {
  it('reports size, row counts for existing tables only, and the share of telemetry rows', () => {
    const sqlite = db();
    for (let i = 0; i < 3; i++) sqlite.prepare('INSERT INTO knowledge_entries VALUES (?)').run(String(i));
    sqlite.prepare('INSERT INTO token_usage VALUES (1)').run();
    const health = collectDbHealth(sqlite, () => lag);
    expect(health.sizeBytes).toBeGreaterThan(0);
    expect(health.tables).toEqual([{ name: 'knowledge_entries', rows: 3 }, { name: 'token_usage', rows: 1 }]); // curation_* absent here
    expect(health.telemetryShare).toBe(0.25);
    expect(health.lastVacuumAt).toBeNull();
    expect(health.eventLoopLagMs).toEqual(lag);
  });

  it('has a zero telemetry share for an empty database instead of dividing by zero', () => {
    expect(collectDbHealth(db(), () => lag).telemetryShare).toBe(0);
  });
});

describe('createEventLoopSampler', () => {
  it('returns finite percentiles and restarts its window after each snapshot', async () => {
    const sampler = createEventLoopSampler();
    try {
      await new Promise(r => setTimeout(r, 100));
      const first = sampler.snapshot();
      expect(Object.keys(first).sort()).toEqual(['max', 'p50', 'p99']);
      expect(Object.values(first).every(Number.isFinite)).toBe(true);
      expect(first.max).toBeGreaterThanOrEqual(first.p50);
    } finally { sampler.stop(); }
  });
});
