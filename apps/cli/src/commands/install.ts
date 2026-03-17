import { Command } from 'commander';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Installer } from '../services/installer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const installCommand = new Command('install')
  .description('Install AI Knowledge Base with interactive wizard')
  .option('--no-dashboard', 'Skip dashboard container')
  .option('--skip-config', 'Skip agent config injection')
  .option('--verbose', 'Show full Docker and command output')
  .action(async (options) => {
    try {
      // Resolve project root: from src/commands/ → src/ → apps/cli/ → apps/ → root
      const projectRoot = resolve(__dirname, '..', '..', '..', '..');

      const installer = new Installer({
        projectRoot,
        skipConfig: options.skipConfig ?? false,
        skipDashboard: !options.dashboard, // --no-dashboard sets dashboard=false
        verbose: options.verbose ?? false,
      });
      await installer.run();
    } catch (err) {
      console.error(`\nInstallation failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });
