import type { KnowledgeSDK } from '@ai-knowledge/sdk';
import { KnowledgeType } from '@ai-knowledge/shared';

export const getKnowledgeTool = {
  name: 'getKnowledge',
  description: 'Search knowledge semantically. The query is vectorized and compared against stored entries using cosine similarity. When a specific scope is provided, global knowledge is always included alongside scoped results.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Natural language query to search for semantically' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag filters' },
      type: { type: 'string', enum: ['decision', 'pattern', 'fix', 'constraint', 'gotcha'], description: 'Optional type filter' },
      scope: { type: 'string', description: 'Optional scope filter (global knowledge is always included)' },
      limit: { type: 'number', description: 'Max results (default: 10)' },
      threshold: { type: 'number', description: 'Minimum similarity threshold 0-1 (default: 0.7)' },
    },
    required: ['query'],
  },
  handler: async (sdk: KnowledgeSDK, params: Record<string, unknown>) => {
    const results = await sdk.getKnowledge(params.query as string, {
      tags: params.tags as string[] | undefined,
      type: params.type as KnowledgeType | undefined,
      scope: params.scope as string | undefined,
      limit: params.limit as number | undefined,
      threshold: params.threshold as number | undefined,
    });
    return JSON.stringify(results, null, 2);
  },
};
