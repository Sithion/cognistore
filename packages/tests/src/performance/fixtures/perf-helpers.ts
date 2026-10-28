import { appendFileSync, readFileSync } from 'node:fs';
import { DEFAULT_EMBEDDING_DIMENSIONS } from '@cognistore/shared';
import type { EmbeddingProvider } from '@cognistore/core';

/**
 * Deterministic, Ollama-free embedder (char-code hash). Query vectors only need
 * to be valid unit vectors of the right size — the fixture's stored vectors are
 * random, so this measures the KNN cost, not relevance.
 */
export const hashEmbedder: EmbeddingProvider = {
  async embed(text: string): Promise<number[]> {
    const vec = new Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0);
    for (let i = 0; i < text.length; i++) vec[i % vec.length] += text.charCodeAt(i) / 1000;
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / mag);
  },
};

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One warmup call, then the median of `runs` timed calls (ms). */
export async function measure(fn: () => unknown, runs = 5): Promise<number> {
  await fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  return median(times);
}

/** Floor so sub-millisecond baselines don't turn into flaky budgets. */
export const BUDGET_FLOOR_MS = 50;
export const BUDGET_FACTOR = 4;

export const PERF_CASES = [
  'search.hybrid', 'listRecent.offset0', 'listRecent.offset5000', 'stats.knowledge',
  'tokens.aggregates30d', 'tokens.aggregates180d', 'duplicates.groups', 'tokens.scanFull', 'tokens.scanIncremental',
] as const;
export type PerfCase = (typeof PERF_CASES)[number];

interface Baseline { cases: Record<PerfCase, number> }
const baseline: Baseline = JSON.parse(readFileSync(new URL('../baseline.json', import.meta.url), 'utf8'));

/** Budget = max(4 × the recorded baseline, 50 ms). Catches regressions of ~4×, not noise. */
export function budgetFor(name: PerfCase): number {
  return Math.max(BUDGET_FACTOR * baseline.cases[name], BUDGET_FLOOR_MS);
}

/**
 * Print a `PERF <name> <ms>` line (grep-able in CI logs) and, when
 * PERF_RESULTS_FILE is set, append it as JSON for refreshing baseline.json.
 */
export function report(name: string, ms: number, extra: Record<string, unknown> = {}): void {
  console.log(`PERF ${name} ${ms.toFixed(1)}ms${Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : ''}`);
  const file = process.env.PERF_RESULTS_FILE;
  if (file) appendFileSync(file, `${JSON.stringify({ name, ms: Number(ms.toFixed(1)), ...extra })}\n`);
}
