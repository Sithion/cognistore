import type { KnowledgeSDK } from '@ai-knowledge/sdk';

export const addPlanRelationTool = {
  name: 'addPlanRelation',
  description: 'Link a knowledge entry to a plan. Use "input" for entries consulted during planning, "output" for entries created/updated during plan execution.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      planId: { type: 'string', description: 'UUID of the plan' },
      knowledgeId: { type: 'string', description: 'UUID of the knowledge entry to link' },
      relationType: { type: 'string', enum: ['input', 'output'], description: '"input" = consulted during planning, "output" = created/updated during execution' },
    },
    required: ['planId', 'knowledgeId', 'relationType'],
  },
  handler: async (sdk: KnowledgeSDK, params: Record<string, unknown>) => {
    sdk.addPlanRelation(
      params.planId as string,
      params.knowledgeId as string,
      params.relationType as 'input' | 'output',
    );
    return JSON.stringify({ success: true, planId: params.planId, knowledgeId: params.knowledgeId, relationType: params.relationType });
  },
};
