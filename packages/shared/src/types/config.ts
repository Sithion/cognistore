export interface DatabaseConfig {
  url: string;
  maxConnections?: number;
}

export interface OllamaConfig {
  host: string;
  model: string;
  dimensions: number;
}

export interface SDKConfig {
  database: DatabaseConfig;
  ollama: OllamaConfig;
  autoStart: boolean;
  dockerComposePath?: string;
}
