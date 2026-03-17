import { Command } from 'commander';
import { getSDK, closeSDK } from '../utils/sdk.js';
import { printSuccess, printError } from '../utils/output.js';

export const deleteCommand = new Command('delete')
  .description('Delete a knowledge entry')
  .argument('<id>', 'UUID of the knowledge entry')
  .action(async (id) => {
    try {
      const sdk = await getSDK();
      const deleted = await sdk.deleteKnowledge(id as string);
      if (deleted) {
        printSuccess('Knowledge entry deleted');
      } else {
        printError('Knowledge entry not found');
        process.exitCode = 1;
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      await closeSDK();
    }
  });
