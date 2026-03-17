import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DockerStatus {
  running: boolean;
  containers: { name: string; status: string }[];
}

export interface ContainerInfo {
  name: string;
  status: string;
  id: string;
}

export class DockerManager {
  private composePath: string;

  constructor(composePath?: string) {
    // Default to the docker-compose.yml in the project root docker/ folder
    this.composePath =
      composePath ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docker/docker-compose.yml');
  }

  isDockerAvailable(): boolean {
    try {
      execSync('docker info', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  getContainerStatus(name: string): string | null {
    try {
      const output = execSync(
        `docker inspect --format='{{.State.Status}}' ${name} 2>/dev/null`,
        { encoding: 'utf-8' }
      ).trim();
      return output;
    } catch {
      return null;
    }
  }

  async ensureRunning(): Promise<DockerStatus> {
    if (!this.isDockerAvailable()) {
      throw new Error('Docker is not available. Please install and start Docker Desktop.');
    }

    const pgStatus = this.getContainerStatus('kb-postgres');
    const ollamaStatus = this.getContainerStatus('kb-ollama');

    if (pgStatus === 'running' && ollamaStatus === 'running') {
      return {
        running: true,
        containers: [
          { name: 'kb-postgres', status: 'running' },
          { name: 'kb-ollama', status: 'running' },
        ],
      };
    }

    // Start containers
    execSync(`docker compose -f ${this.composePath} up -d`, {
      stdio: 'inherit',
    });

    // Wait for PostgreSQL to be healthy
    await this.waitForPostgres();

    return {
      running: true,
      containers: [
        { name: 'kb-postgres', status: 'running' },
        { name: 'kb-ollama', status: 'running' },
      ],
    };
  }

  async stop(): Promise<void> {
    execSync(`docker compose -f ${this.composePath} down`, {
      stdio: 'inherit',
    });
  }

  private async waitForPostgres(maxRetries = 30): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        execSync(
          `docker exec kb-postgres pg_isready -U ${process.env.POSTGRES_USER ?? 'knowledge'}`,
          { stdio: 'ignore' }
        );
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw new Error('PostgreSQL did not become ready in time');
  }

  async removeContainersAndVolumes(): Promise<void> {
    execSync(`docker compose -f ${this.composePath} down -v --remove-orphans`, {
      stdio: 'inherit',
    });
  }

  async removeContainers(): Promise<void> {
    execSync(`docker compose -f ${this.composePath} down --remove-orphans`, {
      stdio: 'inherit',
    });
  }

  getRunningContainers(): Promise<ContainerInfo[]> {
    return Promise.resolve(
      ((): ContainerInfo[] => {
        try {
          const output = execSync(
            "docker ps --filter 'name=kb-' --format '{{.ID}}\t{{.Names}}\t{{.Status}}'",
            { encoding: 'utf-8' }
          );
          return output
            .trim()
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => {
              const [id, name, status] = line.split('\t');
              return { id, name, status };
            });
        } catch {
          return [];
        }
      })()
    );
  }

  async pullModel(model: string): Promise<void> {
    execSync(`docker exec kb-ollama ollama pull ${model}`, {
      stdio: 'inherit',
    });
  }

  async isModelAvailable(model: string): Promise<boolean> {
    try {
      const output = execSync('docker exec kb-ollama ollama list', {
        encoding: 'utf-8',
      });
      return output.includes(model);
    } catch {
      return false;
    }
  }

  async waitForService(
    name: string,
    check: () => Promise<boolean>,
    maxWaitMs: number = 60000,
    intervalMs: number = 2000
  ): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      try {
        const isReady = await check();
        if (isReady) {
          return;
        }
      } catch {
        // Continue retrying
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Service "${name}" did not become ready within ${maxWaitMs}ms`);
  }
}
