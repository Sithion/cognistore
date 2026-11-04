import { describe, expect, it } from 'vitest';
import { corpus, judgeInput, LABELS, score, workspaceOutput, WORKSPACE } from '../../tests/scripts/curation-eval.js';
import type { JudgeResult } from '../../embeddings/src/curation-judge.js';

const answers = (): JudgeResult[] => corpus.map(pair => ({ verdict: pair.expected, confidence: 0.95, reason: 'Scripted manual label', candidateIds: pair.entries.map(e => e.id), model: 'scripted',
  ...(pair.winnerId ? { payload: { sourceId: pair.winnerId, targetId: pair.entries.find(e => e.id !== pair.winnerId)!.id } } : {}) }));

describe('curation evaluation', () => {
  it('synthetic corpus contains sixty balanced labeled pairs with stable IDs', () => {
    expect(corpus).toHaveLength(60);
    expect(new Set(corpus.map(p => p.id)).size).toBe(60);
    for (const label of LABELS) {
      expect(corpus.filter(p => p.expected === label).map(p => p.id)).toEqual(Array.from({ length: 15 }, (_, i) => `${label}-${String(i + 1).padStart(2, '0')}`));
    }
    for (const pair of corpus) {
      expect(pair.entries).toHaveLength(2);
      expect(pair.rationale.length).toBeGreaterThan(15);
      expect(new Set(pair.entries.map(e => e.id)).size).toBe(2);
      for (const entry of pair.entries) {
        expect(entry.scope).toMatch(/^workspace:fictional-/);
        expect(entry.content.length).toBeGreaterThan(10);
        expect(entry.version).toBeGreaterThanOrEqual(1);
        for (const domain of entry.content.matchAll(/https:\/\/([^/\s.]+(?:\.[^/\s.]+)+)/g)) expect(domain[1]).toContain('example.invalid');
      }
      expect(judgeInput(pair).candidateIds).toEqual(pair.entries.map(e => e.id));
      if (pair.expected === 'supersedes') expect(pair.entries.map(e => e.id)).toContain(pair.winnerId);
      else expect(pair.winnerId).toBeNull();
    }
    expect(workspaceOutput('packages/tests/eval-result.json')).toBe(`${WORKSPACE}/packages/tests/eval-result.json`);
    expect(() => workspaceOutput('../outside.json')).toThrow('inside the workspace');
    expect(() => workspaceOutput('/tmp/outside.json')).toThrow('inside the workspace');
  });

  it('evaluation scoring counts invalid answers and false duplicates conservatively', () => {
    const judgments: (JudgeResult | null)[] = answers();
    judgments[0] = null;
    judgments[1] = { ...judgments[1]!, confidence: NaN };
    judgments[2] = { ...judgments[2]!, candidateIds: ['foreign', 'ids'] };
    judgments[15] = { ...judgments[15]!, verdict: 'duplicate', payload: undefined };
    judgments[16] = { ...judgments[16]!, payload: { sourceId: corpus[16].entries.find(e => e.id !== corpus[16].winnerId)!.id, targetId: corpus[16].winnerId! } };
    judgments[17] = { ...judgments[17]!, payload: undefined };
    judgments.pop();
    const result = score(corpus, judgments);
    expect(result).toMatchObject({ completed: 55, invalid: 4, incomplete: 1, correct: 53, accuracy: 53 / 60, falseDuplicateCount: 1, qualified: false });
    expect(result.confusionMatrix.duplicate.invalid).toBe(3);
    expect(result.confusionMatrix.supersedes.duplicate).toBe(1);
    expect(result.confusionMatrix.distinct.incomplete).toBe(1);
    expect(result.highConfidence).toEqual({ threshold: 0.85, decisions: 55, correct: 53, precision: 53 / 55, coverage: 55 / 60 });
  });

  it('model qualification requires complete accuracy and zero false duplicate verdicts', () => {
    expect(score(corpus, answers()).qualified).toBe(true);
    const boundary = answers();
    for (let i = 0; i < 9; i++) boundary[i] = { ...boundary[i], verdict: 'distinct', confidence: 0.84 };
    expect(score(corpus, boundary)).toMatchObject({ accuracy: 0.85, qualified: true });
    boundary[9] = { ...boundary[9], verdict: 'distinct' };
    expect(score(corpus, boundary).qualified).toBe(false);
    const unsafe = answers(); unsafe[30] = { ...unsafe[30], verdict: 'duplicate' };
    expect(score(corpus, unsafe)).toMatchObject({ correct: 59, falseDuplicateCount: 1, qualified: false });
    expect(score(corpus, answers().slice(0, 59)).qualified).toBe(false);
    expect(score(corpus, [...answers().slice(0, 59), null]).qualified).toBe(false);
    expect(score(corpus, [], false)).toMatchObject({ available: false, completed: 0, invalid: 0, incomplete: 60, accuracy: 0, qualified: false });
    expect(score(corpus, answers(), false).qualified).toBe(false);
  });
});
