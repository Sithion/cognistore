import { Command } from 'commander';
import { getSDK, closeSDK } from '../utils/sdk.js';
import { printError } from '../utils/output.js';

export const healthCommand = new Command('health')
  .description('Check infrastructure health')
  .action(async () => {
    try {
      const sdk = await getSDK();
      const health = await sdk.healthCheck();

      console.log('\nInfrastructure Health:');
      console.log('─'.repeat(40));

      const dbIcon = health.database.connected ? '✓' : '✗';
      const dbDetail = health.database.connected
        ? `Connected (${health.database.path})`
        : health.database.error;
      console.log(`  Database:  ${dbIcon} ${dbDetail}`);

      const ollamaIcon = health.ollama.connected ? '✓' : '✗';
      const ollamaDetail = health.ollama.connected
        ? `Connected (${health.ollama.model} @ ${health.ollama.host})`
        : health.ollama.error;
      console.log(`  Ollama:    ${ollamaIcon} ${ollamaDetail}`);

      console.log('');
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      await closeSDK();
    }
  });
