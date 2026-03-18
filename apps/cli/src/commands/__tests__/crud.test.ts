import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSDK } = vi.hoisted(() => {
  const mockSDK = {
    addKnowledge: vi.fn().mockResolvedValue({ id: 'test-id', content: 'test' }),
    getKnowledge: vi.fn().mockResolvedValue([]),
    updateKnowledge: vi.fn().mockResolvedValue({ id: 'test-id', content: 'updated' }),
    deleteKnowledge: vi.fn().mockResolvedValue(true),
    listTags: vi.fn().mockResolvedValue(['tag1', 'tag2']),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { mockSDK };
});

vi.mock('../../utils/sdk.js', () => ({
  getSDK: vi.fn().mockResolvedValue(mockSDK),
  closeSDK: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@ai-knowledge/shared', () => ({
  KnowledgeType: {
    DECISION: 'decision',
    PATTERN: 'pattern',
    FIX: 'fix',
    CONSTRAINT: 'constraint',
    GOTCHA: 'gotcha',
  },
}));

import { addCommand } from '../add.js';
import { searchCommand } from '../search.js';
import { updateCommand } from '../update.js';
import { deleteCommand } from '../delete.js';
import { tagsCommand } from '../tags.js';

describe('add command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('is named "add"', () => {
    expect(addCommand.name()).toBe('add');
  });

  it('requires --content, --tags, --type, --scope, --source', () => {
    const required = addCommand.options.filter(o => o.required);
    const names = required.map(o => o.long);
    expect(names).toContain('--content');
    expect(names).toContain('--tags');
    expect(names).toContain('--type');
    expect(names).toContain('--scope');
    expect(names).toContain('--source');
  });

  it('has --confidence, --agent, --format options', () => {
    const names = addCommand.options.map(o => o.long);
    expect(names).toContain('--confidence');
    expect(names).toContain('--agent');
    expect(names).toContain('--format');
  });

  it('calls sdk.addKnowledge with parsed options', async () => {
    await addCommand.parseAsync([
      'node', 'kb',
      '-c', 'test content',
      '-t', 'auth,jwt',
      '--type', 'fix',
      '-s', 'global',
      '--source', 'manual',
    ], { from: 'node' });

    expect(mockSDK.addKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'test content',
        tags: ['auth', 'jwt'],
        type: 'fix',
        scope: 'global',
        source: 'manual',
        confidenceScore: 1.0,
      })
    );
  });

  it('sets exitCode=1 on SDK error', async () => {
    mockSDK.addKnowledge.mockRejectedValueOnce(new Error('connection refused'));

    await addCommand.parseAsync([
      'node', 'kb',
      '-c', 'x', '-t', 'y', '--type', 'fix', '-s', 'global', '--source', 'test',
    ], { from: 'node' });

    expect(process.exitCode).toBe(1);
  });
});

describe('search command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('is named "search"', () => {
    expect(searchCommand.name()).toBe('search');
  });

  it('accepts a query argument', () => {
    const args = searchCommand.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].name()).toBe('query');
    expect(args[0].required).toBe(true);
  });

  it('has --tags, --type, --scope, --limit, --threshold, --format options', () => {
    const names = searchCommand.options.map(o => o.long);
    expect(names).toContain('--tags');
    expect(names).toContain('--type');
    expect(names).toContain('--scope');
    expect(names).toContain('--limit');
    expect(names).toContain('--threshold');
    expect(names).toContain('--format');
  });

  it('calls sdk.getKnowledge with query and options', async () => {
    mockSDK.getKnowledge.mockResolvedValueOnce([{ id: '1', content: 'result' }]);

    await searchCommand.parseAsync(['node', 'kb', 'how to authenticate'], { from: 'node' });

    expect(mockSDK.getKnowledge).toHaveBeenCalledWith(
      'how to authenticate',
      expect.objectContaining({
        limit: 10,
        threshold: 0.3,
      })
    );
  });

  it('passes tags as array when --tags given', async () => {
    await searchCommand.parseAsync(['node', 'kb', 'query', '-t', 'auth,jwt'], { from: 'node' });

    expect(mockSDK.getKnowledge).toHaveBeenCalledWith(
      'query',
      expect.objectContaining({
        tags: ['auth', 'jwt'],
      })
    );
  });
});

describe('update command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('is named "update"', () => {
    expect(updateCommand.name()).toBe('update');
  });

  it('accepts an id argument', () => {
    const args = updateCommand.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].name()).toBe('id');
  });

  it('calls sdk.updateKnowledge with only provided fields', async () => {
    await updateCommand.parseAsync(['node', 'kb', 'uuid-123', '-c', 'new content'], { from: 'node' });

    expect(mockSDK.updateKnowledge).toHaveBeenCalledWith(
      'uuid-123',
      expect.objectContaining({ content: 'new content' })
    );
    const updates = mockSDK.updateKnowledge.mock.calls[0][1];
    expect(updates).not.toHaveProperty('tags');
    expect(updates).not.toHaveProperty('type');
  });

  it('sets exitCode=1 when entry not found', async () => {
    mockSDK.updateKnowledge.mockResolvedValueOnce(null);

    await updateCommand.parseAsync(['node', 'kb', 'uuid-missing', '-c', 'x'], { from: 'node' });

    expect(process.exitCode).toBe(1);
  });
});

describe('delete command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('is named "delete"', () => {
    expect(deleteCommand.name()).toBe('delete');
  });

  it('accepts an id argument', () => {
    const args = deleteCommand.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].name()).toBe('id');
  });

  it('calls sdk.deleteKnowledge with id', async () => {
    await deleteCommand.parseAsync(['node', 'kb', 'uuid-123'], { from: 'node' });
    expect(mockSDK.deleteKnowledge).toHaveBeenCalledWith('uuid-123');
  });

  it('sets exitCode=1 when entry not found', async () => {
    mockSDK.deleteKnowledge.mockResolvedValueOnce(false);

    await deleteCommand.parseAsync(['node', 'kb', 'uuid-missing'], { from: 'node' });

    expect(process.exitCode).toBe(1);
  });
});

describe('tags command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('is named "tags"', () => {
    expect(tagsCommand.name()).toBe('tags');
  });

  it('has --format option', () => {
    const names = tagsCommand.options.map(o => o.long);
    expect(names).toContain('--format');
  });

  it('calls sdk.listTags', async () => {
    await tagsCommand.parseAsync(['node', 'kb'], { from: 'node' });
    expect(mockSDK.listTags).toHaveBeenCalled();
  });
});
