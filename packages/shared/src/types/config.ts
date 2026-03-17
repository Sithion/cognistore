export interface DatabaseConfig {
  path: string;
}

export interface OllamaConfig {
  host: string;
  model: string;
  dimensions: number;
}

export interface SDKConfig {
  database: DatabaseConfig;
  ollama: OllamaConfig;
}
