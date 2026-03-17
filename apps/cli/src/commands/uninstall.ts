import { Command } from 'commander';
import { Uninstaller } from '../services/uninstaller.js';

export const uninstallCommand = new Command('uninstall')
  .description('Remove AI Knowledge Base and clean up all configurations')
  .option('--keep-data', 'Keep SQLite database (knowledge data)')
  .option('--force', 'Skip confirmation prompts')
  .action(async (options) => {
    try {
      const uninstaller = new Uninstaller({
        force: options.force ?? false,
        keepData: options.keepData ?? false,
      });
      await uninstaller.run();
    } catch (err) {
      console.error(`\nUninstall failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });
