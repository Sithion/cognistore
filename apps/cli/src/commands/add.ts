import { Command } from 'commander';
import { KnowledgeType } from '@ai-knowledge/shared';
import { getSDK, closeSDK } from '../utils/sdk.js';
import { formatOutput, printSuccess, printError, type OutputFormat } from '../utils/output.js';

export const addCommand = new Command('add')
  .description('Add a new knowledge entry')
  .requiredOption('-c, --content <text>', 'Knowledge content text')
  .requiredOption('-t, --tags <tags>', 'Comma-separated tags (e.g., "auth,jwt,fix")')
  .requiredOption('--type <type>', 'Knowledge type: decision|pattern|fix|constraint|gotcha')
  .requiredOption('-s, --scope <scope>', 'Scope: global or workspace:<name>')
  .requiredOption('--source <source>', 'Source of knowledge (e.g., "manual", "claude")')
  .option('--confidence <score>', 'Confidence score 0-1', '1.0')
  .option('--agent <id>', 'Agent ID')
  .option('-f, --format <format>', 'Output format: json|table|plain', 'plain')
  .action(async (opts) => {
    try {
      const sdk = await getSDK();
      const result = await sdk.addKnowledge({
        content: opts.content as string,
        tags: (opts.tags as string).split(',').map((t: string) => t.trim()),
        type: opts.type as KnowledgeType,
        scope: opts.scope as string,
        source: opts.source as string,
        confidenceScore: parseFloat(opts.confidence as string),
        agentId: opts.agent as string | undefined,
      });
      printSuccess('Knowledge entry created');
      console.log(formatOutput(result, opts.format as OutputFormat));
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      await closeSDK();
    }
  });
