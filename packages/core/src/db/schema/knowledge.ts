import { pgTable, uuid, text, integer, doublePrecision, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { vector } from './pgvector.js';

export const knowledgeTypeEnum = ['decision', 'pattern', 'fix', 'constraint', 'gotcha'] as const;

export const knowledgeEntries = pgTable(
  'knowledge_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 384 }),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    type: text('type', { enum: knowledgeTypeEnum }).notNull(),
    scope: text('scope').notNull(),
    source: text('source').notNull(),
    version: integer('version').notNull().default(1),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    confidenceScore: doublePrecision('confidence_score').notNull().default(1.0),
    relatedIds: uuid('related_ids').array(),
    agentId: text('agent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_tags').using('gin', table.tags),
    index('idx_type').on(table.type),
    index('idx_scope').on(table.scope),
  ]
);
