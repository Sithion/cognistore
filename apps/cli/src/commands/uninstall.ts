import { Command } from 'commander';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Uninstaller } from '../services/uninstaller.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const uninstallCommand = new Command('uninstall')
  .description('Remove AI Knowledge Base and clean up all configurations')
  .option('--keep-data', 'Keep Docker volumes (database data)')
  .option('--force', 'Skip confirmation prompts')
  .action(async (options) => {
    try {
      // Resolve project root: from src/commands/ → src/ → apps/cli/ → apps/ → root
      const projectRoot = resolve(__dirname, '..', '..', '..', '..');

      const uninstaller = new Uninstaller({
        projectRoot,
        force: options.force ?? false,
        keepData: options.keepData ?? false,
      });
      await uninstaller.run();
    } catch (err) {
      console.error(`\nUninstall failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });
