import { Command } from 'commander';
import { KnowledgeType } from '@ai-knowledge/shared';
import { getSDK, closeSDK } from '../utils/sdk.js';
import { formatOutput, printError, printInfo, type OutputFormat } from '../utils/output.js';

export const searchCommand = new Command('search')
  .description('Search knowledge semantically')
  .argument('<query>', 'Search query text')
  .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
  .option('--type <type>', 'Filter by type: decision|pattern|fix|constraint|gotcha')
  .option('-s, --scope <scope>', 'Filter by scope (global is always included)')
  .option('-l, --limit <n>', 'Max results', '10')
  .option('--threshold <n>', 'Min similarity threshold 0-1', '0.7')
  .option('-f, --format <format>', 'Output format: json|table|plain', 'plain')
  .action(async (query, opts) => {
    try {
      const sdk = await getSDK();
      const results = await sdk.getKnowledge(query as string, {
        tags: (opts.tags as string | undefined)?.split(',').map((t: string) => t.trim()),
        type: opts.type as KnowledgeType | undefined,
        scope: opts.scope as string | undefined,
        limit: parseInt(opts.limit as string),
        threshold: parseFloat(opts.threshold as string),
      });
      if (results.length === 0) {
        printInfo('No results found.');
      } else {
        printInfo(`Found ${results.length} result(s)`);
        console.log(formatOutput(results, opts.format as OutputFormat));
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      await closeSDK();
    }
  });
