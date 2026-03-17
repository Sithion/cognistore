import {
  DEFAULT_DATABASE_URL,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  type SDKConfig,
} from '@ai-knowledge/shared';

export function resolveConfig(userConfig?: Partial<SDKConfig>): SDKConfig {
  return {
    database: {
      url: userConfig?.database?.url ?? (process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL),
      maxConnections: userConfig?.database?.maxConnections ?? 10,
    },
    ollama: {
      host: userConfig?.ollama?.host ?? (process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST),
      model: userConfig?.ollama?.model ?? (process.env.OLLAMA_MODEL ?? DEFAULT_EMBEDDING_MODEL),
      dimensions: userConfig?.ollama?.dimensions ?? (Number(process.env.EMBEDDING_DIMENSIONS) || DEFAULT_EMBEDDING_DIMENSIONS),
    },
    autoStart: userConfig?.autoStart ?? true,
    dockerComposePath: userConfig?.dockerComposePath,
  };
}
