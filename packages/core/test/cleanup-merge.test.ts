import { describe, expect, it } from 'vitest';
import {
  CLEANUP_CONTROL_TAGS, MERGE_APPENDIX_BUDGET, MERGE_MAX_CONTENT, MERGE_MAX_TAGS,
  MERGE_MAX_TITLE, computeMergedTags, deterministicMergeDraft, MergeDraftError, validateMergeDraft,
  type MergeMember,
} from '../src/services/cleanup-merge.js';

const member = (overrides: Partial<MergeMember> = {}): MergeMember => ({
  id: 'a', title: 'Canonical', content: 'Canonical body', tags: [], updatedAt: '2026-01-01', ...overrides,
});

describe('cleanup merge helpers', () => {
  it('unions normalized tags, drops controls and invalid values', () => {
    expect(CLEANUP_CONTROL_TAGS).toEqual(['deprecated', 'keep']);
    expect(computeMergedTags([
      member({ tags: [' SQLite ', 'deprecated', 'KEEP', '', 'x'.repeat(51), 'SQLite', 3 as any] }),
      member({ tags: ['TypeScript', 'sqlite'] }),
    ])).toEqual(['sqlite', 'typescript']);
  });

  it('stops tag union at the configured cap', () => {
    const tags = computeMergedTags([member({ tags: Array.from({ length: MERGE_MAX_TAGS + 5 }, (_, i) => `t${i}`) })]);
    expect(tags).toHaveLength(MERGE_MAX_TAGS);
    expect(tags.at(-1)).toBe(`t${MERGE_MAX_TAGS - 1}`);
  });

  it.each([null, undefined, 2, 'x', []])('rejects non-object draft %j', (draft) => {
    expect(() => validateMergeDraft(draft)).toThrow(MergeDraftError);
  });

  it.each([
    [{ title: ' ', content: 'body' }, /title/],
    [{ title: 2, content: 'body' }, /title/],
    [{ title: 'title', content: '' }, /content/],
    [{ title: 'title', content: 2 }, /content/],
    [{ title: 'x'.repeat(MERGE_MAX_TITLE + 1), content: 'body' }, /exceeds/],
    [{ title: 'title', content: 'x'.repeat(MERGE_MAX_CONTENT + 1) }, /exceeds/],
  ])('rejects invalid draft fields', (draft, message) => {
    expect(() => validateMergeDraft(draft)).toThrow(message);
  });

  it('trims title but preserves content bytes', () => {
    expect(validateMergeDraft({ title: '  T  ', content: ' body\n' })).toEqual({ title: 'T', content: ' body\n' });
  });

  it('rejects an empty merge and returns a sole canonical unchanged', () => {
    expect(() => deterministicMergeDraft([])).toThrow(/empty group/);
    expect(deterministicMergeDraft([member()])).toEqual({ title: 'Canonical', content: 'Canonical body' });
  });

  it('keeps canonical content and appends every ordinary duplicate', () => {
    const result = deterministicMergeDraft([member(), member({ title: 'Other', content: 'Other body' })]);
    expect(result.title).toBe('Canonical');
    expect(result.content).toContain('Canonical body\n\n## Merged from duplicates');
    expect(result.content).toContain('### Other\n\nOther body\n');
  });

  it('truncates an oversized appendix and omits later members after the budget is spent', () => {
    const result = deterministicMergeDraft([
      member(), member({ title: 'Huge', content: 'x'.repeat(MERGE_APPENDIX_BUDGET + 20) }),
      member({ title: 'Later', content: 'later body' }),
    ]);
    expect(result.content).toContain('[truncated]');
    expect(result.content).toContain('[1 further duplicate(s) omitted: merge size limit reached]');
  });

  it('caps total merged content at the public content limit', () => {
    const result = deterministicMergeDraft([member({ content: 'c'.repeat(MERGE_MAX_CONTENT) }), member({ content: 'z'.repeat(100) })]);
    expect(result.content).toHaveLength(MERGE_MAX_CONTENT);
  });
});
