import { Command } from 'commander';
import { getSDK, closeSDK } from '../utils/sdk.js';
import { printSuccess, printError } from '../utils/output.js';

export const dbStatusCommand = new Command('db:status')
  .description('Check database and Ollama status')
  .action(async () => {
    try {
      const sdk = await getSDK();
      const health = await sdk.healthCheck();

      if (health.database.connected) {
        printSuccess(`Database: connected (${health.database.path})`);
      } else {
        printError(`Database: ${health.database.error}`);
      }

      if (health.ollama.connected) {
        printSuccess(`Ollama: connected (${health.ollama.model} @ ${health.ollama.host})`);
      } else {
        printError(`Ollama: ${health.ollama.error}`);
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      await closeSDK();
    }
  });
