import type { KnowledgeSDK } from '@ai-knowledge/sdk';

export const healthCheckTool = {
  name: 'healthCheck',
  description: 'Check the health of the knowledge base infrastructure (database, Ollama, Docker).',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
  handler: async (sdk: KnowledgeSDK) => {
    const health = await sdk.healthCheck();
    return JSON.stringify(health, null, 2);
  },
};
