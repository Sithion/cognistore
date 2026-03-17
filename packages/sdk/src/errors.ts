export class KnowledgeBaseError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'KnowledgeBaseError';
  }
}

export class ConnectionError extends KnowledgeBaseError {
  constructor(message: string) {
    super(message, 'CONNECTION_ERROR');
    this.name = 'ConnectionError';
  }
}

export class EmbeddingError extends KnowledgeBaseError {
  constructor(message: string) {
    super(message, 'EMBEDDING_ERROR');
    this.name = 'EmbeddingError';
  }
}

export class ValidationError extends KnowledgeBaseError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class DockerError extends KnowledgeBaseError {
  constructor(message: string) {
    super(message, 'DOCKER_ERROR');
    this.name = 'DockerError';
  }
}
