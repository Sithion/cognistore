import type { KnowledgeSDK } from '@ai-knowledge/sdk';
import { KnowledgeType } from '@ai-knowledge/shared';

export const updateKnowledgeTool = {
  name: 'updateKnowledge',
  description: 'Update an existing knowledge entry. If content changes, embedding is regenerated. Version auto-increments.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: { type: 'string', description: 'UUID of the knowledge entry to update' },
      title: { type: 'string', description: 'New title' },
      content: { type: 'string', description: 'New content text' },
      tags: { type: 'array', items: { type: 'string' }, description: 'New tags' },
      type: { type: 'string', enum: ['decision', 'pattern', 'fix', 'constraint', 'gotcha'], description: 'New type' },
      scope: { type: 'string', description: 'New scope' },
      source: { type: 'string', description: 'New source' },
      confidenceScore: { type: 'number', description: 'New confidence score' },
    },
    required: ['id'],
  },
  handler: async (sdk: KnowledgeSDK, params: Record<string, unknown>) => {
    const { id, ...updates } = params;
    const result = await sdk.updateKnowledge(id as string, {
      title: updates.title as string | undefined,
      content: updates.content as string | undefined,
      tags: updates.tags as string[] | undefined,
      type: updates.type as KnowledgeType | undefined,
      scope: updates.scope as string | undefined,
      source: updates.source as string | undefined,
      confidenceScore: updates.confidenceScore as number | undefined,
    });
    return result ? JSON.stringify(result, null, 2) : 'Knowledge entry not found';
  },
};
