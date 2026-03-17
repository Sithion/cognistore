import {
  DEFAULT_SQLITE_PATH,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  type SDKConfig,
} from '@ai-knowledge/shared';

export function resolveConfig(userConfig?: Partial<SDKConfig>): SDKConfig {
  return {
    database: {
      path: userConfig?.database?.path ?? (process.env.SQLITE_PATH ?? DEFAULT_SQLITE_PATH),
    },
    ollama: {
      host: userConfig?.ollama?.host ?? (process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST),
      model: userConfig?.ollama?.model ?? (process.env.OLLAMA_MODEL ?? DEFAULT_EMBEDDING_MODEL),
      dimensions: userConfig?.ollama?.dimensions ?? (Number(process.env.EMBEDDING_DIMENSIONS) || DEFAULT_EMBEDDING_DIMENSIONS),
    },
  };
}
