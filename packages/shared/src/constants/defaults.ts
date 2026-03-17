import { KnowledgeType } from '../types/knowledge.js';

export const DEFAULT_EMBEDDING_MODEL = 'all-minilm';
export const DEFAULT_EMBEDDING_DIMENSIONS = 384;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.3;
export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_OLLAMA_HOST = 'http://localhost:11435';
export const DEFAULT_DATABASE_URL = 'postgresql://knowledge:knowledge_secret@localhost:5433/knowledge_base';
export const DEFAULT_POSTGRES_PORT = 5433;
export const DEFAULT_OLLAMA_PORT = 11435;

export const KNOWLEDGE_TYPES = Object.values(KnowledgeType);
