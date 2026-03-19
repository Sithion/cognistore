import type { KnowledgeSDK } from '@ai-knowledge/sdk';
import { KnowledgeType, KnowledgeStatus } from '@ai-knowledge/shared';

export const addKnowledgeTool = {
  name: 'addKnowledge',
  description: 'Store a new knowledge entry with semantic embedding. Content is vectorized for future semantic search.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Short descriptive title for the knowledge entry' },
      content: { type: 'string', description: 'The knowledge content text to store' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Mandatory categorical tags for filtering' },
      type: { type: 'string', enum: ['decision', 'pattern', 'fix', 'constraint', 'gotcha'], description: 'Type of knowledge entry' },
      scope: { type: 'string', description: 'Scope: "global" or "workspace:<project-name>"' },
      source: { type: 'string', description: 'Source of the knowledge' },
      confidenceScore: { type: 'number', description: 'Confidence score 0-1' },
      agentId: { type: 'string', description: 'ID of the agent that created this' },
    },
    required: ['title', 'content', 'tags', 'type', 'scope', 'source'],
  },
  handler: async (sdk: KnowledgeSDK, params: Record<string, unknown>) => {
    const result = await sdk.addKnowledge({
      title: params.title as string,
      content: params.content as string,
      tags: params.tags as string[],
      type: params.type as KnowledgeType,
      scope: params.scope as string,
      source: params.source as string,
      confidenceScore: params.confidenceScore as number | undefined,
      agentId: params.agentId as string | undefined,
    });
    return JSON.stringify(result, null, 2);
  },
};
