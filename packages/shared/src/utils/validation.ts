import { z } from 'zod';
import { KnowledgeType } from '../types/knowledge.js';
import { DEFAULT_SIMILARITY_THRESHOLD, DEFAULT_SEARCH_LIMIT } from '../constants/defaults.js';

export const knowledgeTypeSchema = z.nativeEnum(KnowledgeType);

export const createKnowledgeSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  tags: z.array(z.string().min(1)).min(1, 'At least one tag is required'),
  type: knowledgeTypeSchema,
  scope: z.string().min(1, 'Scope is required'),
  source: z.string().min(1, 'Source is required'),
  confidenceScore: z.number().min(0).max(1).optional().default(1.0),
  expiresAt: z.date().nullable().optional().default(null),
  relatedIds: z.array(z.string().uuid()).nullable().optional().default(null),
  agentId: z.string().nullable().optional().default(null),
});

export const updateKnowledgeSchema = z.object({
  content: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).min(1).optional(),
  type: knowledgeTypeSchema.optional(),
  scope: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  expiresAt: z.date().nullable().optional(),
  relatedIds: z.array(z.string().uuid()).nullable().optional(),
  agentId: z.string().nullable().optional(),
});

export const searchOptionsSchema = z.object({
  tags: z.array(z.string()).optional(),
  type: knowledgeTypeSchema.optional(),
  scope: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(DEFAULT_SEARCH_LIMIT),
  threshold: z.number().min(0).max(1).optional().default(DEFAULT_SIMILARITY_THRESHOLD),
});
