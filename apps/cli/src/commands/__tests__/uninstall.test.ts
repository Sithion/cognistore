import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRun = vi.fn().mockResolvedValue(undefined);
let lastUninstallerOpts: Record<string, unknown> = {};

vi.mock('../../services/uninstaller.js', () => ({
  Uninstaller: class MockUninstaller {
    constructor(opts: Record<string, unknown>) {
      lastUninstallerOpts = opts;
    }
    run = mockRun;
  },
}));

import { uninstallCommand } from '../uninstall.js';

describe('uninstall command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUninstallerOpts = {};
  });

  it('is named "uninstall"', () => {
    expect(uninstallCommand.name()).toBe('uninstall');
  });

  it('has --keep-data option', () => {
    const opt = uninstallCommand.options.find(o => o.long === '--keep-data');
    expect(opt).toBeDefined();
  });

  it('has --force option', () => {
    const opt = uninstallCommand.options.find(o => o.long === '--force');
    expect(opt).toBeDefined();
  });

  it('passes force=true when --force is given', async () => {
    await uninstallCommand.parseAsync(['uninstall', '--force'], { from: 'user' });
    expect(lastUninstallerOpts.force).toBe(true);
  });
});
