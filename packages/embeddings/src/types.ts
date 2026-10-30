export interface EmbeddingRequest {
  model: string;
  prompt: string;
  options?: { num_ctx?: number };
}

export interface EmbeddingResponse {
  embedding: number[];
}

export interface OllamaTagsResponse {
  models: Array<{
    name: string;
    modified_at: string;
    size: number;
  }>;
}

