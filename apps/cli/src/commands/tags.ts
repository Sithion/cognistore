import { Command } from 'commander';
import { getSDK, closeSDK } from '../utils/sdk.js';
import { formatOutput, printError, type OutputFormat } from '../utils/output.js';

export const tagsCommand = new Command('tags')
  .description('List all unique tags')
  .option('-f, --format <format>', 'Output format: json|table|plain', 'plain')
  .action(async (opts) => {
    try {
      const sdk = await getSDK();
      const tags = await sdk.listTags();
      console.log(formatOutput(tags, opts.format as OutputFormat));
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      await closeSDK();
    }
  });
