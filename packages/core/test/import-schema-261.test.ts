import { describe, expect, it } from 'vitest';
import { importSchema, MAX_SOURCE_LENGTH, MAX_TITLE_LENGTH, MAX_TAG_LENGTH, MAX_TAGS } from '@cognistore/shared';

const entry = (overrides: Record<string, unknown> = {}) => ({
  title: 't', content: 'c', tags: ['a'], type: 'pattern', scope: 'global', source: 's', ...overrides,
});

describe('importSchema accepts every entry the create path allows', () => {
  it('accepts a source at the create limit', () => {
    const r = importSchema.safeParse({ knowledge: [entry({ source: 'x'.repeat(MAX_SOURCE_LENGTH) })] });
    expect(r.success).toBe(true);
  });

  it('accepts title, tag and tag-count values at the create limits', () => {
    const r = importSchema.safeParse({ knowledge: [entry({
      title: 'x'.repeat(MAX_TITLE_LENGTH),
      tags: Array.from({ length: MAX_TAGS }, (_, i) => `${i}`.padEnd(MAX_TAG_LENGTH, 'x')),
    })] });
    expect(r.success).toBe(true);
  });

  it('still rejects a source above the create limit', () => {
    const r = importSchema.safeParse({ knowledge: [entry({ source: 'x'.repeat(MAX_SOURCE_LENGTH + 1) })] });
    expect(r.success).toBe(false);
  });
});
