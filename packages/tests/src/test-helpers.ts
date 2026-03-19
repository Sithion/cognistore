import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { createDbClient, KnowledgeRepository, KnowledgeService, type Database, type SQLiteDatabase } from '@ai-knowledge/core';
import { KnowledgeType, type CreateKnowledgeInput } from '@ai-knowledge/shared';
import type { EmbeddingProvider } from '@ai-knowledge/core';

export interface TestContext {
  service: KnowledgeService;
  repository: KnowledgeRepository;
  sqlite: SQLiteDatabase;
  db: Database;
  dbPath: string;
}

/** Mock embedding provider — deterministic 384-dim vector based on text hash */
function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    async embed(text: string): Promise<number[]> {
      const vec = new Array(384).fill(0);
      for (let i = 0; i < text.length; i++) {
        vec[i % 384] += text.charCodeAt(i) / 1000;
      }
      const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
      return vec.map((v) => v / mag);
    },
  };
}

/** Create a fresh test context with temp database */
export function createTestContext(): TestContext {
  const dbPath = join(tmpdir(), `ai-knowledge-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const { db, sqlite } = createDbClient(dbPath);
  const repository = new KnowledgeRepository(db, sqlite);
  const service = new KnowledgeService(repository, createMockEmbeddingProvider());
  return { service, repository, sqlite, db, dbPath };
}

/** Destroy test context */
export function destroyTestContext(ctx: TestContext): void {
  try { ctx.sqlite.close(); } catch {}
  try { unlinkSync(ctx.dbPath); } catch {}
  try { unlinkSync(ctx.dbPath + '-wal'); } catch {}
  try { unlinkSync(ctx.dbPath + '-shm'); } catch {}
}

/** Factory for quick test data creation */
export function createFactory(service: KnowledgeService) {
  let counter = 0;
  return {
    async knowledge(overrides: Partial<CreateKnowledgeInput> = {}) {
      counter++;
      return service.add({
        title: overrides.title ?? `Test Entry ${counter}`,
        content: overrides.content ?? `Test content for entry ${counter} with unique words alpha${counter}`,
        tags: overrides.tags ?? ['test'],
        type: overrides.type ?? KnowledgeType.PATTERN,
        scope: overrides.scope ?? 'global',
        source: overrides.source ?? 'test',
        ...overrides,
      });
    },
    async plan(overrides: Partial<{ title: string; content: string; tags: string[]; scope: string; source: string; tasks: { description: string; priority?: string }[] }> = {}) {
      counter++;
      return service.createPlan({
        title: overrides.title ?? `Test Plan ${counter}`,
        content: overrides.content ?? `Plan content ${counter}`,
        tags: overrides.tags ?? ['test-plan'],
        scope: overrides.scope ?? 'global',
        source: overrides.source ?? 'test',
        tasks: overrides.tasks,
      });
    },
    planTask(planId: string, overrides: Partial<{ description: string; priority: string; notes: string }> = {}) {
      counter++;
      return service.createPlanTask({
        planId,
        description: overrides.description ?? `Task ${counter}`,
        priority: overrides.priority,
        notes: overrides.notes,
      });
    },
  };
}
