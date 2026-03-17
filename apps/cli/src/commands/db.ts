import { Command } from 'commander';
import { DockerManager } from '@ai-knowledge/core';
import { printSuccess, printError } from '../utils/output.js';

export const dbStartCommand = new Command('db:start')
  .description('Start the Docker infrastructure (PostgreSQL + Ollama)')
  .action(async () => {
    try {
      const manager = new DockerManager();
      const status = await manager.ensureRunning();
      printSuccess('Infrastructure is running');
      for (const container of status.containers) {
        console.log(`  ${container.name}: ${container.status}`);
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

export const dbStopCommand = new Command('db:stop')
  .description('Stop the Docker infrastructure')
  .action(async () => {
    try {
      const manager = new DockerManager();
      await manager.stop();
      printSuccess('Infrastructure stopped');
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });
