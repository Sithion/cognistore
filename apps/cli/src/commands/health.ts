import { Command } from 'commander';
import { getSDK, closeSDK } from '../utils/sdk.js';
import { printSuccess, printError, printInfo } from '../utils/output.js';

export const healthCommand = new Command('health')
  .description('Check infrastructure health')
  .action(async () => {
    try {
      const sdk = await getSDK({ autoStart: false });
      const health = await sdk.healthCheck();

      console.log('\nInfrastructure Health:');
      console.log('─'.repeat(40));

      const dbIcon = health.database.connected ? '✓' : '✗';
      console.log(`  Database:  ${dbIcon} ${health.database.connected ? 'Connected' : health.database.error}`);

      const ollamaIcon = health.ollama.connected ? '✓' : '✗';
      console.log(
        `  Ollama:    ${ollamaIcon} ${health.ollama.connected ? `Connected (${health.ollama.model})` : health.ollama.error}`
      );

      const dockerIcon = health.docker.running ? '✓' : '✗';
      console.log(`  Docker:    ${dockerIcon} ${health.docker.running ? 'Running' : 'Not available'}`);

      for (const container of health.docker.containers) {
        console.log(`    - ${container.name}: ${container.status}`);
      }

      console.log('');
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      await closeSDK();
    }
  });
