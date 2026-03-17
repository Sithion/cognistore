import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { KnowledgeSDK } from '@ai-knowledge/sdk';
import { KnowledgeType } from '@ai-knowledge/shared';

const knowledgeTypeValues = ['decision', 'pattern', 'fix', 'constraint', 'gotcha'] as const;

export function createServer(sdk: KnowledgeSDK): McpServer {
  const server = new McpServer({
    name: 'ai-knowledge',
    version: '0.1.0',
  });

  // addKnowledge
  server.tool(
    'addKnowledge',
    'Store a new knowledge entry with semantic embedding. Content is vectorized for future semantic search.',
    {
      content: z.string().describe('The knowledge content text to store'),
      tags: z.array(z.string()).describe('Mandatory categorical tags for filtering'),
      type: z.enum(knowledgeTypeValues).describe('Type of knowledge entry'),
      scope: z.string().describe('Scope: "global" or "workspace:<project-name>"'),
      source: z.string().describe('Source of the knowledge'),
      confidenceScore: z.number().min(0).max(1).optional().describe('Confidence score 0-1'),
      agentId: z.string().optional().describe('ID of the agent that created this'),
    },
    async (params) => {
      const result = await sdk.addKnowledge({
        content: params.content,
        tags: params.tags,
        type: params.type as KnowledgeType,
        scope: params.scope,
        source: params.source,
        confidenceScore: params.confidenceScore,
        agentId: params.agentId,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // getKnowledge
  server.tool(
    'getKnowledge',
    'Search knowledge semantically. When a specific scope is provided, global knowledge is always included.',
    {
      query: z.string().describe('Natural language query to search for'),
      tags: z.array(z.string()).optional().describe('Optional tag filters'),
      type: z.enum(knowledgeTypeValues).optional().describe('Optional type filter'),
      scope: z.string().optional().describe('Optional scope filter (global always included)'),
      limit: z.number().optional().describe('Max results (default: 10)'),
      threshold: z.number().optional().describe('Min similarity 0-1 (default: 0.3)'),
    },
    async (params) => {
      const results = await sdk.getKnowledge(params.query, {
        tags: params.tags,
        type: params.type as KnowledgeType | undefined,
        scope: params.scope,
        limit: params.limit,
        threshold: params.threshold,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    }
  );

  // updateKnowledge
  server.tool(
    'updateKnowledge',
    'Update an existing knowledge entry. If content changes, embedding is regenerated. Version auto-increments.',
    {
      id: z.string().describe('UUID of the knowledge entry to update'),
      content: z.string().optional().describe('New content text'),
      tags: z.array(z.string()).optional().describe('New tags'),
      type: z.enum(knowledgeTypeValues).optional().describe('New type'),
      scope: z.string().optional().describe('New scope'),
      source: z.string().optional().describe('New source'),
      confidenceScore: z.number().min(0).max(1).optional().describe('New confidence score'),
    },
    async (params) => {
      const { id, ...updates } = params;
      const result = await sdk.updateKnowledge(id, {
        content: updates.content,
        tags: updates.tags,
        type: updates.type as KnowledgeType | undefined,
        scope: updates.scope,
        source: updates.source,
        confidenceScore: updates.confidenceScore,
      });
      const text = result ? JSON.stringify(result, null, 2) : 'Knowledge entry not found';
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  // deleteKnowledge
  server.tool(
    'deleteKnowledge',
    'Delete a knowledge entry by ID.',
    {
      id: z.string().describe('UUID of the knowledge entry to delete'),
    },
    async (params) => {
      const deleted = await sdk.deleteKnowledge(params.id);
      return {
        content: [{ type: 'text' as const, text: deleted ? 'Deleted successfully' : 'Not found' }],
      };
    }
  );

  // listTags
  server.tool(
    'listTags',
    'List all unique tags across all knowledge entries.',
    {},
    async () => {
      const tags = await sdk.listTags();
      return { content: [{ type: 'text' as const, text: JSON.stringify(tags) }] };
    }
  );

  // healthCheck
  server.tool(
    'healthCheck',
    'Check health of the knowledge base infrastructure (database, Ollama, Docker).',
    {},
    async () => {
      const health = await sdk.healthCheck();
      return { content: [{ type: 'text' as const, text: JSON.stringify(health, null, 2) }] };
    }
  );

  return server;
}
