import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { KnowledgeSDK } from '@cognistore/sdk';
import { KnowledgeType } from '@cognistore/shared';

const knowledgeTypeValues = ['decision', 'pattern', 'fix', 'constraint', 'gotcha'] as const;
const knowledgeStatusValues = ['draft', 'active', 'completed', 'archived'] as const;

// Tool annotations for MCP clients that support them (readOnlyHint, destructiveHint, etc.)
const READ_ONLY = { readOnlyHint: true, destructiveHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

export function createServer(sdk: KnowledgeSDK): McpServer {
  const server = new McpServer({
    name: 'cognistore',
    version: '0.1.0',
  });

  // addKnowledge
  server.tool(
    'addKnowledge',
    'Store a new knowledge entry with semantic embedding. Content is vectorized for future semantic search.',
    {
      title: z.string().describe('Short descriptive title for the knowledge entry'),
      content: z.string().describe('The knowledge content text to store'),
      tags: z.array(z.string()).describe('Mandatory categorical tags for filtering'),
      type: z.enum(knowledgeTypeValues).describe('Type of knowledge entry'),
      scope: z.string().describe('Scope: "global" or "workspace:<project-name>"'),
      source: z.string().describe('Source of the knowledge'),
      confidenceScore: z.number().min(0).max(1).optional().describe('Confidence score 0-1'),
      agentId: z.string().optional().describe('ID of the agent that created this'),
    },
    WRITE,
    async (params) => {
      const result = await sdk.addKnowledge({
        title: params.title,
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
    READ_ONLY,
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
      title: z.string().optional().describe('New title'),
      content: z.string().optional().describe('New content text'),
      tags: z.array(z.string()).optional().describe('New tags'),
      type: z.enum(knowledgeTypeValues).optional().describe('New type'),
      scope: z.string().optional().describe('New scope'),
      source: z.string().optional().describe('New source'),
      confidenceScore: z.number().min(0).max(1).optional().describe('New confidence score'),
    },
    WRITE,
    async (params) => {
      const { id, ...updates } = params;
      const result = await sdk.updateKnowledge(id, {
        title: updates.title,
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
    DESTRUCTIVE,
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
    READ_ONLY,
    async () => {
      const tags = await sdk.listTags();
      return { content: [{ type: 'text' as const, text: JSON.stringify(tags) }] };
    }
  );

  // healthCheck
  server.tool(
    'healthCheck',
    'Check health of the knowledge base infrastructure (database, Ollama).',
    {},
    READ_ONLY,
    async () => {
      const health = await sdk.healthCheck();
      return { content: [{ type: 'text' as const, text: JSON.stringify(health, null, 2) }] };
    }
  );

  // createPlan
  server.tool(
    'createPlan',
    'Create a new plan in the knowledge base. Plans are the ONLY way to persist implementation plans — never use local files. Status starts as draft.',
    {
      title: z.string().describe('Plan title (short, descriptive)'),
      content: z.string().describe('Full plan content (steps, approach, considerations)'),
      tags: z.array(z.string()).describe('Tags for categorization'),
      scope: z.string().describe('Scope: "global" or "workspace:<project-name>"'),
      source: z.string().describe('Source/context of the plan'),
      relatedKnowledgeIds: z.array(z.string()).optional().describe('IDs of knowledge entries consulted during planning (input relations)'),
      tasks: z.array(z.object({
        description: z.string(),
        priority: z.enum(['low', 'medium', 'high']).optional(),
      })).optional().describe('Initial tasks for the plan todo list'),
    },
    WRITE,
    async (params) => {
      const result = await sdk.createPlan({
        title: params.title,
        content: params.content,
        tags: params.tags,
        scope: params.scope,
        source: params.source,
        relatedKnowledgeIds: params.relatedKnowledgeIds,
        tasks: params.tasks,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // updatePlan
  server.tool(
    'updatePlan',
    'Update an existing plan. Use to change status (draft → active → completed → archived), title, content, tags, or scope.',
    {
      planId: z.string().describe('UUID of the plan to update'),
      title: z.string().optional().describe('New title'),
      content: z.string().optional().describe('New content'),
      tags: z.array(z.string()).optional().describe('New tags'),
      scope: z.string().optional().describe('New scope'),
      status: z.enum(knowledgeStatusValues).optional().describe('New status'),
      source: z.string().optional().describe('New source'),
    },
    WRITE,
    async (params) => {
      const { planId, ...updates } = params;
      const result = sdk.updatePlan(planId, updates as any);
      const text = result ? JSON.stringify(result, null, 2) : 'Plan not found';
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  // addPlanRelation
  server.tool(
    'addPlanRelation',
    'Link a knowledge entry to a plan. Use "input" for entries consulted during planning, "output" for entries created/updated during execution.',
    {
      planId: z.string().describe('UUID of the plan'),
      knowledgeId: z.string().describe('UUID of the knowledge entry to link'),
      relationType: z.enum(['input', 'output']).describe('"input" = consulted during planning, "output" = created/updated during execution'),
    },
    WRITE,
    async (params) => {
      sdk.addPlanRelation(params.planId, params.knowledgeId, params.relationType);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, ...params }) }] };
    }
  );

  // addPlanTask
  server.tool(
    'addPlanTask',
    'Add a task to a plan todo list. Position is auto-calculated.',
    {
      planId: z.string().describe('UUID of the plan'),
      description: z.string().describe('Task description'),
      priority: z.enum(['low', 'medium', 'high']).optional().describe('Priority (default: medium)'),
      notes: z.string().optional().describe('Optional notes'),
    },
    WRITE,
    async (params) => {
      const task = sdk.createPlanTask(params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] };
    }
  );

  // updatePlanTask
  server.tool(
    'updatePlanTask',
    'Update a plan task. Mark in_progress when starting, completed when done. Add notes for context.',
    {
      taskId: z.string().describe('UUID of the task'),
      status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('New status'),
      description: z.string().optional().describe('New description'),
      priority: z.enum(['low', 'medium', 'high']).optional().describe('New priority'),
      notes: z.string().nullable().optional().describe('Notes about progress or blockers'),
    },
    WRITE,
    async (params) => {
      const { taskId, ...updates } = params;
      const task = sdk.updatePlanTask(taskId, updates);
      const text = task ? JSON.stringify(task, null, 2) : 'Task not found';
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  // listPlanTasks
  server.tool(
    'listPlanTasks',
    'List all tasks for a plan, ordered by position. Use to check progress or resume work.',
    {
      planId: z.string().describe('UUID of the plan'),
    },
    READ_ONLY,
    async (params) => {
      const tasks = sdk.listPlanTasks(params.planId);
      return { content: [{ type: 'text' as const, text: JSON.stringify(tasks, null, 2) }] };
    }
  );

  // ─── MCP Resources ──────────────────────────────────────────

  // Scope-aware knowledge context resource
  // Provides auto-loaded KB context for agents — useful when tools can't be called (e.g., plan mode)
  server.resource(
    'knowledge-context',
    new ResourceTemplate('cognistore://context/{scope}', { list: undefined }),
    { description: 'Workspace-scoped knowledge base context with recent entries and active plans' },
    async (uri, variables) => {
      const scope = variables.scope as string || 'global';
      const scopeFilter = scope === 'global' ? undefined : `workspace:${scope}`;

      // Fetch recent knowledge entries for this scope
      let knowledgeSection = '';
      try {
        const results = await sdk.getKnowledge('*', {
          scope: scopeFilter,
          limit: 10,
          threshold: 0,
        });
        if (results.length > 0) {
          knowledgeSection = '## Recent Knowledge\n\n' + results.map(r =>
            `- **${r.entry.title}** (${r.entry.type}, ${r.entry.scope})\n  ${r.entry.content.slice(0, 200)}${r.entry.content.length > 200 ? '...' : ''}`
          ).join('\n\n');
        } else {
          knowledgeSection = '## Recent Knowledge\n\nNo entries found for this scope.';
        }
      } catch {
        knowledgeSection = '## Recent Knowledge\n\nUnable to fetch entries.';
      }

      // Fetch active plans
      let plansSection = '';
      try {
        const plans = sdk.listPlans(10, 'active');
        const scopedPlans = scopeFilter
          ? plans.filter(p => p.scope === scopeFilter || p.scope === 'global')
          : plans;
        if (scopedPlans.length > 0) {
          const planEntries = scopedPlans.map(p => {
            const tasks = sdk.listPlanTasks(p.id);
            const completed = tasks.filter(t => t.status === 'completed').length;
            return `- **${p.title}** (${p.status}, ${completed}/${tasks.length} tasks done)\n  ${p.content.slice(0, 150)}${p.content.length > 150 ? '...' : ''}`;
          });
          plansSection = '## Active Plans\n\n' + planEntries.join('\n\n');
        } else {
          plansSection = '## Active Plans\n\nNo active plans for this scope.';
        }
      } catch {
        plansSection = '## Active Plans\n\nUnable to fetch plans.';
      }

      // Fetch top tags
      let tagsSection = '';
      try {
        const tags = await sdk.listTags();
        if (tags.length > 0) {
          tagsSection = `## Tags\n\n${tags.slice(0, 20).join(', ')}`;
        }
      } catch {
        // skip
      }

      const content = `# CogniStore Context — ${scope}\n\n${knowledgeSection}\n\n${plansSection}\n\n${tagsSection}`.trim();

      return {
        contents: [{
          uri: uri.href,
          text: content,
          mimeType: 'text/markdown',
        }],
      };
    }
  );

  return server;
}
