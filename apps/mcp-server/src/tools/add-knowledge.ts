import type { KnowledgeSDK } from '@ai-knowledge/sdk';
import { KnowledgeType } from '@ai-knowledge/shared';

export const addKnowledgeTool = {
  name: 'addKnowledge',
  description: 'Store a new knowledge entry with semantic embedding. Content is vectorized for future semantic search. Tags are mandatory and used as categorical filters.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      content: { type: 'string', description: 'The knowledge content text to store. Will be vectorized for semantic search.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Mandatory categorical tags for filtering (e.g., ["auth", "jwt", "fix"])' },
      type: { type: 'string', enum: ['decision', 'pattern', 'fix', 'constraint', 'gotcha'], description: 'Type of knowledge entry' },
      scope: { type: 'string', description: 'Scope: "global" or "workspace:<project-name>"' },
      source: { type: 'string', description: 'Source of the knowledge (e.g., "manual", "claude", "copilot")' },
      confidenceScore: { type: 'number', description: 'Confidence score between 0 and 1 (default: 1.0)' },
      agentId: { type: 'string', description: 'ID of the agent that created this entry' },
    },
    required: ['content', 'tags', 'type', 'scope', 'source'],
  },
  handler: async (sdk: KnowledgeSDK, params: Record<string, unknown>) => {
    const result = await sdk.addKnowledge({
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
