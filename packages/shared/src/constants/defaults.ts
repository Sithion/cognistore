import { KnowledgeType } from '../types/knowledge.js';

export const DEFAULT_EMBEDDING_MODEL = 'all-minilm';
export const DEFAULT_EMBEDDING_DIMENSIONS = 384;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.3;
export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';
export const DEFAULT_OLLAMA_PORT = 11434;
export const DEFAULT_SQLITE_PATH = '~/.ai-knowledge/knowledge.db';

export const KNOWLEDGE_TYPES = Object.values(KnowledgeType);
