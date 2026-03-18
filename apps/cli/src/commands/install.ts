import { Command } from 'commander';
import { Installer } from '../services/installer.js';
import { resolveProjectRoot } from '../utils/resolve-root.js';

export const installCommand = new Command('install')
  .description('Install AI Knowledge Base with interactive wizard')
  .option('--skip-config', 'Skip agent config injection')
  .option('--verbose', 'Show full command output')
  .action(async (options) => {
    try {
      const projectRoot = resolveProjectRoot();

      const installer = new Installer({
        projectRoot,
        skipConfig: options.skipConfig ?? false,
        verbose: options.verbose ?? false,
      });
      await installer.run();
    } catch (err) {
      console.error(`\nInstallation failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });
