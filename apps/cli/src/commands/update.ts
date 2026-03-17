import { Command } from 'commander';
import { KnowledgeType } from '@ai-knowledge/shared';
import { getSDK, closeSDK } from '../utils/sdk.js';
import { formatOutput, printSuccess, printError, type OutputFormat } from '../utils/output.js';

export const updateCommand = new Command('update')
  .description('Update a knowledge entry')
  .argument('<id>', 'UUID of the knowledge entry')
  .option('-c, --content <text>', 'New content')
  .option('-t, --tags <tags>', 'New tags (comma-separated)')
  .option('--type <type>', 'New type')
  .option('-s, --scope <scope>', 'New scope')
  .option('--source <source>', 'New source')
  .option('--confidence <score>', 'New confidence score')
  .option('-f, --format <format>', 'Output format: json|table|plain', 'plain')
  .action(async (id, opts) => {
    try {
      const sdk = await getSDK();
      const updates: Record<string, unknown> = {};
      if (opts.content) updates.content = opts.content as string;
      if (opts.tags) updates.tags = (opts.tags as string).split(',').map((t: string) => t.trim());
      if (opts.type) updates.type = opts.type as KnowledgeType;
      if (opts.scope) updates.scope = opts.scope as string;
      if (opts.source) updates.source = opts.source as string;
      if (opts.confidence) updates.confidenceScore = parseFloat(opts.confidence as string);

      const result = await sdk.updateKnowledge(id as string, updates);
      if (result) {
        printSuccess('Knowledge entry updated');
        console.log(formatOutput(result, opts.format as OutputFormat));
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
