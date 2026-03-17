import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue(''),
  exec: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({ stdout: '' })),
}));

vi.mock('../../ui/index.js', () => ({
  showWelcomeBanner: vi.fn(),
  step: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  withSpinner: vi.fn().mockImplementation((_msg: string, fn: () => Promise<void>) => fn()),
  showSuccessBanner: vi.fn(),
}));

vi.mock('../config-manager.js', () => ({
  ConfigManager: class MockConfigManager {
    static CLAUDE_MD = '~/.claude/CLAUDE.md';
    static COPILOT_MD = '~/.github/copilot-instructions.md';
    static COPILOT_INSTRUCTIONS = '~/.copilot/copilot-instructions.md';
    static MCP_CONFIG = '~/.claude/mcp-config.json';
    static CLAUDE_JSON = '~/.claude.json';
    static COPILOT_MCP_CONFIG = '~/.copilot/mcp-config.json';
    injectConfig = vi.fn().mockResolvedValue({ action: 'created', path: '/mock' });
    setupMcpConfig = vi.fn().mockResolvedValue({ action: 'created', path: '/mock' });
  },
}));

vi.mock('../../utils/resolve-root.js', () => ({
  resolveTemplatesDir: vi.fn().mockImplementation((projectRoot?: string) => {
    if (projectRoot) {
      return resolve(projectRoot, 'apps', 'cli', 'templates');
    }
    return '/mock/package/templates';
  }),
}));

import { Installer } from '../installer.js';

describe('Installer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets default installDir to ~/.ai-knowledge/', () => {
    const installer = new Installer({});
    expect((installer as any).installDir).toContain('.ai-knowledge');
  });

  it('accepts custom installDir', () => {
    const installer = new Installer({ installDir: '/custom/path' });
    expect((installer as any).installDir).toBe('/custom/path');
  });

  it('defaults skipConfig to false', () => {
    const installer = new Installer({});
    expect((installer as any).skipConfig).toBe(false);
  });

  it('defaults verbose to false', () => {
    const installer = new Installer({});
    expect((installer as any).verbose).toBe(false);
  });

  it('stores projectRoot as undefined for npx context', () => {
    const installer = new Installer({});
    expect((installer as any).projectRoot).toBeUndefined();
  });

  it('stores projectRoot when provided (repo context)', () => {
    const installer = new Installer({ projectRoot: '/repo/root' });
    expect((installer as any).projectRoot).toBe('/repo/root');
  });
});
