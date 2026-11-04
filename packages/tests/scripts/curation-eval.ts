/** Offline scoring exports; CLI: apps/dashboard/node_modules/.bin/tsx this-file --output <workspace-path>. */
import { readFileSync, realpathSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CurationJudgeClient, type JudgeInput, type JudgeResult } from '../../embeddings/src/curation-judge.js';

export const LABELS = ['duplicate', 'supersedes', 'complementary', 'distinct'] as const;
export type Label = typeof LABELS[number];
export interface EvalPair {
  id: string; entries: JudgeInput['entries']; expected: Label; winnerId: string | null; rationale: string;
}
export const WORKSPACE = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'));
export const corpus: EvalPair[] = JSON.parse(readFileSync(resolve(WORKSPACE, 'packages/core/test/fixtures/curation-eval.json'), 'utf8'));

export function judgeInput(pair: EvalPair): JudgeInput {
  return { taskKind: 'cluster', entries: pair.entries, candidateIds: pair.entries.map(e => e.id),
    hashes: Object.fromEntries(pair.entries.map(e => [e.id, e.contentHash])), versions: Object.fromEntries(pair.entries.map(e => [e.id, e.version])) };
}
function valid(pair: EvalPair, result: JudgeResult | null | undefined): result is JudgeResult {
  if (!result || !LABELS.includes(result.verdict as Label) || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1 || !result.reason?.trim()) return false;
  const ids = pair.entries.map(e => e.id);
  if (!Array.isArray(result.candidateIds) || result.candidateIds.length !== 2 || new Set(result.candidateIds).size !== 2 || result.candidateIds.some(id => !ids.includes(id))) return false;
  if (result.verdict === 'supersedes') return !!result.payload && ids.includes(result.payload.sourceId!) && ids.includes(result.payload.targetId!) && result.payload.sourceId !== result.payload.targetId;
  return true;
}
export function score(pairs: EvalPair[], judgments: (JudgeResult | null)[], available = true) {
  const confusionMatrix = Object.fromEntries(LABELS.map(expected => [expected, Object.fromEntries([...LABELS, 'invalid', 'incomplete'].map(predicted => [predicted, 0]))]));
  let completed = 0, invalid = 0, correct = 0, falseDuplicateCount = 0, confident = 0, confidentCorrect = 0;
  const decisions = pairs.map((pair, index) => {
    const result = judgments[index];
    const state = index >= judgments.length ? 'incomplete' : valid(pair, result) ? 'valid' : 'invalid';
    const predicted = state === 'valid' ? result!.verdict : state;
    confusionMatrix[pair.expected][predicted]++;
    if (state === 'invalid') invalid++;
    if (state !== 'valid') return { id: pair.id, state, correct: false, judgment: result ?? null };
    completed++;
    const right = result!.verdict === pair.expected && (pair.expected !== 'supersedes' || result!.payload?.sourceId === pair.winnerId);
    if (right) correct++;
    if (result!.verdict === 'duplicate' && pair.expected !== 'duplicate') falseDuplicateCount++;
    if (result!.confidence >= 0.85) { confident++; if (right) confidentCorrect++; }
    return { id: pair.id, state, correct: right, judgment: result };
  });
  const accuracy = pairs.length ? correct / pairs.length : 0;
  return { available, total: pairs.length, completed, invalid, incomplete: pairs.length - completed - invalid,
    confusionMatrix, correct, accuracy, falseDuplicateCount,
    highConfidence: { threshold: 0.85, decisions: confident, correct: confidentCorrect, precision: confident ? confidentCorrect / confident : null, coverage: pairs.length ? confident / pairs.length : 0 },
    qualified: available && pairs.length === 60 && completed === 60 && invalid === 0 && accuracy >= 0.85 && falseDuplicateCount === 0,
    decisions };
}

/** Resolve symlinks, including the nearest existing ancestor of a new output. */
export function workspaceOutput(path: string): string {
  const target = resolve(WORKSPACE, path);
  let ancestor = target;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error('Cannot resolve output ancestor');
    ancestor = parent;
  }
  const physical = resolve(realpathSync(ancestor), relative(ancestor, target));
  const rel = relative(WORKSPACE, physical);
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('--output must resolve inside the workspace');
  return physical;
}
export async function main(args = process.argv.slice(2)) {
  const models: string[] = [];
  let host = 'http://127.0.0.1:11434', output: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i], value = args[++i];
    if (!['--model', '--host', '--output'].includes(flag) || !value || value.startsWith('--')) throw new Error(`Invalid argument: ${flag}`);
    if (flag === '--model') models.push(value);
    if (flag === '--host') host = value;
    if (flag === '--output') output = workspaceOutput(value);
  }
  if (!output) throw new Error('--output <workspace-path> is required');
  const reports = [];
  for (const model of [...new Set(models.length ? models : ['llama3.2:3b', 'qwen2.5:7b-instruct'])]) {
    let available = false, availabilityError: string | null = null;
    try {
      const response = await fetch(`${host.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Inventory returned HTTP ${response.status}`);
      const inventory = await response.json() as { models: { name: string }[] };
      available = inventory.models.some(m => m.name === model || m.name === `${model}:latest`);
      if (!available) availabilityError = 'Model is not installed';
    } catch (error) { availabilityError = String(error); }
    const judgments: (JudgeResult | null)[] = [];
    if (available) {
      const judge = new CurationJudgeClient({ host: host.replace(/\/$/, ''), model, installedModels: [] });
      for (const pair of corpus) {
        try { judgments.push(await judge.judge(judgeInput(pair))); } catch { judgments.push(null); }
      }
    }
    const report = { model, availabilityError, ...score(corpus, judgments, available) };
    reports.push(report);
    console.log(`${model}: ${available ? 'available' : 'unavailable'} completed=${report.completed}/60 invalid=${report.invalid} incomplete=${report.incomplete} accuracy=${report.accuracy.toFixed(3)} falseDuplicates=${report.falseDuplicateCount} precision>=0.85=${report.highConfidence.precision ?? 'n/a'} coverage=${report.highConfidence.coverage.toFixed(3)} qualified=${report.qualified}`);
  }
  writeFileSync(output, JSON.stringify({ corpus: 'synthetic-manual-v1', reports }, null, 2) + '\n', { mode: 0o600 });
  console.log(`curation-eval: ${reports.every(r => r.available) ? 'complete' : 'unavailable'}`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(String(error)); process.exitCode = 1; });
}
