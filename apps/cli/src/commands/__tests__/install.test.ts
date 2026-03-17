import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRun = vi.fn().mockResolvedValue(undefined);
let lastInstallerOpts: Record<string, unknown> = {};

vi.mock('../../services/installer.js', () => ({
  Installer: class MockInstaller {
    constructor(opts: Record<string, unknown>) {
      lastInstallerOpts = opts;
    }
    run = mockRun;
  },
}));

vi.mock('../../utils/resolve-root.js', () => ({
  resolveProjectRoot: vi.fn().mockReturnValue('/mock/repo/root'),
}));

import { installCommand } from '../install.js';
import { resolveProjectRoot } from '../../utils/resolve-root.js';

describe('install command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastInstallerOpts = {};
  });

  it('is named "install"', () => {
    expect(installCommand.name()).toBe('install');
  });

  it('has --skip-config option', () => {
    const opt = installCommand.options.find(o => o.long === '--skip-config');
    expect(opt).toBeDefined();
  });

  it('has --verbose option', () => {
    const opt = installCommand.options.find(o => o.long === '--verbose');
    expect(opt).toBeDefined();
  });

  it('uses resolveProjectRoot instead of hardcoded path', async () => {
    await installCommand.parseAsync(['install'], { from: 'user' });

    expect(resolveProjectRoot).toHaveBeenCalled();
    expect(lastInstallerOpts.projectRoot).toBe('/mock/repo/root');
  });

  it('passes skipConfig=true when --skip-config is given', async () => {
    await installCommand.parseAsync(['install', '--skip-config'], { from: 'user' });
    expect(lastInstallerOpts.skipConfig).toBe(true);
  });

  it('passes verbose=true when --verbose is given', async () => {
    await installCommand.parseAsync(['install', '--verbose'], { from: 'user' });
    expect(lastInstallerOpts.verbose).toBe(true);
  });
});
