import { OllamaEmbeddingClient } from './client.js';

export interface OllamaHealthStatus {
  connected: boolean;
  model?: string;
  modelAvailable?: boolean;
  error?: string;
}

export async function checkOllamaHealth(client: OllamaEmbeddingClient): Promise<OllamaHealthStatus> {
  try {
    const healthy = await client.isHealthy();
    if (!healthy) {
      return { connected: false, error: 'Ollama is not responding' };
    }

    const config = client.getConfig();
    const modelAvailable = await client.isModelAvailable();

    return {
      connected: true,
      model: config.model,
      modelAvailable,
      error: modelAvailable ? undefined : `Model "${config.model}" is not available. Run: ollama pull ${config.model}`,
    };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
