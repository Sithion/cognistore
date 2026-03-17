import type { KnowledgeSDK } from '@ai-knowledge/sdk';

export const deleteKnowledgeTool = {
  name: 'deleteKnowledge',
  description: 'Delete a knowledge entry by ID.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: { type: 'string', description: 'UUID of the knowledge entry to delete' },
    },
    required: ['id'],
  },
  handler: async (sdk: KnowledgeSDK, params: Record<string, unknown>) => {
    const deleted = await sdk.deleteKnowledge(params.id as string);
    return deleted ? 'Knowledge entry deleted successfully' : 'Knowledge entry not found';
  },
};
