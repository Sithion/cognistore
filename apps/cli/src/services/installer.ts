import { execSync, exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import * as ui from '../ui/index.js';
import { ConfigManager } from './config-manager.js';
import { resolveTemplatesDir } from '../utils/resolve-root.js';

const execPromise = promisify(execCb);

const TOTAL_STEPS = 14;

export interface InstallerOptions {
  projectRoot?: string;  // Optional - for backwards compat with repo-based install
  installDir?: string;   // Default: ~/.ai-knowledge/
  skipConfig?: boolean;
  skipDashboard?: boolean;
  verbose?: boolean;
}

export class Installer {
  private projectRoot?: string;
  private installDir: string;
  private configManager: ConfigManager;
  private skipConfig: boolean;
  private skipDashboard: boolean;
  private verbose: boolean;

  constructor(options: InstallerOptions) {
    this.installDir = options.installDir ?? resolve(homedir(), '.ai-knowledge');
    this.projectRoot = options.projectRoot;
    this.configManager = new ConfigManager();
    this.skipConfig = options.skipConfig ?? false;
    this.skipDashboard = options.skipDashboard ?? false;
    this.verbose = options.verbose ?? false;
  }

  async run(): Promise<void> {
    ui.showWelcomeBanner();
    let currentStep = 0;

    try {
      // Step 1: Detect OS
      currentStep++;
      const os = this.detectOS();
      ui.step(currentStep, TOTAL_STEPS, `Detected OS: ${os.name} (${os.arch})`);

      // Step 2: Setup install directory
      currentStep++;
      ui.step(currentStep, TOTAL_STEPS, `Setting up install directory: ${this.installDir}`);
      await this.setupInstallDir();
      ui.success(`Install directory ready: ${this.installDir}`);

      // Step 3: Check Docker
      currentStep++;
      ui.step(currentStep, TOTAL_STEPS, 'Checking Docker...');
      const dockerAvailable = this.checkDocker();
      if (!dockerAvailable) {
        this.showDockerInstallGuide(os.name);
        throw new Error('Docker is not available. Please install Docker and try again.');
      }
      ui.success('Docker is installed and running');

      // Step 4: Check Docker Compose
      currentStep++;
      ui.step(currentStep, TOTAL_STEPS, 'Checking Docker Compose...');
      const composeCmd = this.getComposeCommand();
      ui.success(`Using: ${composeCmd}`);

      // Step 5: Start Docker services
      currentStep++;
      const profile = this.skipDashboard ? '' : '--profile dashboard';
      const buildFlag = this.projectRoot ? '--build' : '';
      if (this.verbose) {
        ui.step(currentStep, TOTAL_STEPS, 'Starting Docker services...');
        this.exec(
          `${composeCmd} -f "${resolve(this.installDir, 'docker-compose.yml')}" ${profile} up -d ${buildFlag}`.trim(),
          false
        );
        ui.success('Docker services started');
      } else {
        await ui.withSpinner(
          `[${currentStep}/${TOTAL_STEPS}] Starting Docker services (pulling & starting containers)...`,
          async () => {
            await this.execAsync(
              `${composeCmd} -f "${resolve(this.installDir, 'docker-compose.yml')}" ${profile} up -d ${buildFlag}`.trim()
            );
          }
        );
      }

      // Step 6: Wait for PostgreSQL
      currentStep++;
      await ui.withSpinner(
        `[${currentStep}/${TOTAL_STEPS}] Waiting for PostgreSQL...`,
        async () => {
          await this.waitForAsync(
            async () => {
              try {
                await this.execAsync('docker exec kb-postgres pg_isready -U knowledge');
                return true;
              } catch {
                return false;
              }
            },
            60000,
            2000
          );
        }
      );

      // Step 7: Wait for Ollama
      currentStep++;
      await ui.withSpinner(
        `[${currentStep}/${TOTAL_STEPS}] Waiting for Ollama...`,
        async () => {
          await this.waitForAsync(
            async () => {
              try {
                await this.execAsync('curl -sf http://localhost:11435/api/tags');
                return true;
              } catch {
                return false;
              }
            },
            120000,
            3000
          );
        }
      );

      // Step 8: Pull embedding model
      currentStep++;
      const model = process.env.OLLAMA_MODEL || 'all-minilm';
      const modelExists = this.checkModelExists(model);
      if (modelExists) {
        ui.step(
          currentStep,
          TOTAL_STEPS,
          `Embedding model '${model}' already available`
        );
      } else if (this.verbose) {
        ui.step(currentStep, TOTAL_STEPS, `Pulling embedding model '${model}'...`);
        this.exec(`docker exec kb-ollama ollama pull ${model}`, false);
        ui.success(`Model '${model}' pulled`);
      } else {
        await ui.withSpinner(
          `[${currentStep}/${TOTAL_STEPS}] Pulling embedding model '${model}'...`,
          async () => {
            await this.execAsync(`docker exec kb-ollama ollama pull ${model}`);
          }
        );
      }

      // Step 9: Wait for Dashboard (if not skipped)
      currentStep++;
      if (!this.skipDashboard) {
        await ui.withSpinner(
          `[${currentStep}/${TOTAL_STEPS}] Waiting for Dashboard...`,
          async () => {
            await this.waitForAsync(
              async () => {
                try {
                  await this.execAsync('curl -sf http://kb.localhost');
                  return true;
                } catch {
                  try {
                    await this.execAsync(`curl -sf http://localhost:${process.env.DASHBOARD_PORT || '3847'}`);
                    return true;
                  } catch {
                    return false;
                  }
                }
              },
              90000,
              3000
            );
          }
        );
      } else {
        ui.step(currentStep, TOTAL_STEPS, 'Dashboard skipped');
      }

      // Step 10: Inject agent configs
      currentStep++;
      if (!this.skipConfig) {
        ui.step(currentStep, TOTAL_STEPS, 'Configuring AI agent instructions...');

        try {
          const claudeResult = await this.configManager.injectConfig(
            ConfigManager.CLAUDE_MD,
            this.projectRoot ? resolve(this.projectRoot, 'configs', 'claude-code-instructions.md') : '',
            'Claude Code'
          );
          ui.success(
            `Claude Code: ${claudeResult.action} ${claudeResult.path}`
          );
        } catch {
          ui.warn('Could not configure Claude Code instructions (skipped)');
        }

        try {
          const copilotResult = await this.configManager.injectConfig(
            ConfigManager.COPILOT_MD,
            this.projectRoot ? resolve(this.projectRoot, 'configs', 'copilot-instructions.md') : '',
            'GitHub Copilot'
          );
          ui.success(
            `GitHub Copilot: ${copilotResult.action} ${copilotResult.path}`
          );
        } catch {
          ui.warn('Could not configure GitHub Copilot instructions (skipped)');
        }
      } else {
        ui.step(currentStep, TOTAL_STEPS, 'Config injection skipped');
      }

      // Step 11: Setup MCP config
      currentStep++;
      if (!this.skipConfig) {
        ui.step(currentStep, TOTAL_STEPS, 'Setting up MCP configuration...');

        const mcpEntry = {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@ai-knowledge/mcp-server'],
          env: {
            DATABASE_URL: `postgresql://knowledge:knowledge_secret@localhost:${
              process.env.POSTGRES_PORT || '5433'
            }/knowledge_base`,
            OLLAMA_HOST: `http://localhost:${
              process.env.OLLAMA_PORT || '11435'
            }`,
            OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'all-minilm',
            EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS || '384',
          },
        };

        const mcpResult = await this.configManager.setupMcpConfig(
          ConfigManager.MCP_CONFIG,
          mcpEntry
        );
        ui.success(`MCP config: ${mcpResult.action} ${mcpResult.path}`);

        // Also add to ~/.claude.json if it exists
        try {
          const claudeJsonResult = await this.configManager.setupMcpConfig(
            ConfigManager.CLAUDE_JSON,
            mcpEntry
          );
          ui.success(
            `Claude JSON: ${claudeJsonResult.action} ${claudeJsonResult.path}`
          );
        } catch {
          // ~/.claude.json may not exist or may have a different structure - that's OK
        }
      } else {
        ui.step(currentStep, TOTAL_STEPS, 'MCP config skipped');
      }

      // Step 12: Inject Copilot CLI instructions
      currentStep++;
      if (!this.skipConfig) {
        ui.step(currentStep, TOTAL_STEPS, 'Configuring Copilot CLI instructions...');

        try {
          const copilotCliResult = await this.configManager.injectConfig(
            ConfigManager.COPILOT_INSTRUCTIONS,
            this.projectRoot ? resolve(this.projectRoot, 'configs', 'copilot-instructions.md') : '',
            'Copilot CLI'
          );
          ui.success(
            `Copilot CLI: ${copilotCliResult.action} ${copilotCliResult.path}`
          );
        } catch {
          ui.warn('Could not configure Copilot CLI instructions (skipped)');
        }
      } else {
        ui.step(currentStep, TOTAL_STEPS, 'Copilot CLI config skipped');
      }

      // Step 13: Setup Copilot MCP config
      currentStep++;
      if (!this.skipConfig) {
        ui.step(currentStep, TOTAL_STEPS, 'Setting up Copilot MCP configuration...');

        const copilotMcpEntry = {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@ai-knowledge/mcp-server'],
          env: {
            DATABASE_URL: `postgresql://knowledge:knowledge_secret@localhost:${
              process.env.POSTGRES_PORT || '5433'
            }/knowledge_base`,
            OLLAMA_HOST: `http://localhost:${
              process.env.OLLAMA_PORT || '11435'
            }`,
            OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'all-minilm',
            EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS || '384',
          },
        };

        try {
          const copilotMcpResult = await this.configManager.setupMcpConfig(
            ConfigManager.COPILOT_MCP_CONFIG,
            copilotMcpEntry
          );
          ui.success(
            `Copilot MCP: ${copilotMcpResult.action} ${copilotMcpResult.path}`
          );
        } catch {
          ui.warn('Could not configure Copilot MCP (skipped)');
        }
      } else {
        ui.step(currentStep, TOTAL_STEPS, 'Copilot MCP config skipped');
      }

      // Step 14: Install knowledge skills
      currentStep++;
      if (!this.skipConfig) {
        ui.step(currentStep, TOTAL_STEPS, 'Installing knowledge skills...');
        await this.installSkills();
        ui.success('Knowledge skills installed for Claude Code and Copilot CLI');
      } else {
        ui.step(currentStep, TOTAL_STEPS, 'Skills installation skipped');
      }

      // Success!
      ui.showSuccessBanner({
        dashboard: this.skipDashboard ? 'skipped' : 'http://kb.localhost',
        postgres: `localhost:${process.env.POSTGRES_PORT || '5433'}`,
        ollama: `localhost:${process.env.OLLAMA_PORT || '11435'}`,
      });
    } catch (err) {
      ui.error(`Installation failed at step ${currentStep}/${TOTAL_STEPS}`);
      throw err;
    }
  }

  private async setupInstallDir(): Promise<void> {
    const { mkdirSync, existsSync, cpSync } = await import('node:fs');

    mkdirSync(this.installDir, { recursive: true });

    // Resolve templates: repo uses docker/ dir, npx uses bundled templates/
    const templatesDir = this.projectRoot
      ? resolve(this.projectRoot, 'docker')  // repo-based install
      : resolveTemplatesDir();  // npx install — from package templates/

    const composeDest = resolve(this.installDir, 'docker-compose.yml');
    const initDest = resolve(this.installDir, 'init');
    const envDest = resolve(this.installDir, '.env');

    // Copy docker-compose.yml if not exists
    if (!existsSync(composeDest)) {
      cpSync(resolve(templatesDir, 'docker-compose.yml'), composeDest);
    }

    // Copy init dir if not exists
    if (!existsSync(initDest)) {
      cpSync(resolve(templatesDir, 'init'), initDest, { recursive: true });
    }

    // Copy .env from .env.example if .env doesn't exist
    if (!existsSync(envDest)) {
      const envSource = resolve(templatesDir, '.env.example');
      if (existsSync(envSource)) {
        cpSync(envSource, envDest);
      }
    }
  }

  private async installSkills(): Promise<void> {
    const { mkdirSync, existsSync, cpSync, lstatSync, unlinkSync } = await import('node:fs');
    const home = homedir();

    // Resolve skill templates from package or repo
    const skillsDir = resolve(resolveTemplatesDir(this.projectRoot), 'skills');

    // Claude Code: ~/.claude/skills/<name>/SKILL.md
    const claudeSkillsDir = resolve(home, '.claude', 'skills');
    const claudeSkillNames = ['ai-knowledge-query', 'ai-knowledge-capture'];

    for (const name of claudeSkillNames) {
      const src = resolve(skillsDir, 'claude-code', name, 'SKILL.md');
      const destDir = resolve(claudeSkillsDir, name);
      const dest = resolve(destDir, 'SKILL.md');

      if (!existsSync(src)) continue;

      // Remove existing symlink if present (from ai-config or previous install)
      if (existsSync(destDir) && lstatSync(destDir).isSymbolicLink()) {
        unlinkSync(destDir);
      }

      mkdirSync(destDir, { recursive: true });
      cpSync(src, dest);
    }

    // Copilot CLI: ~/.copilot/skills/<name>.md
    const copilotSkillsDir = resolve(home, '.copilot', 'skills');
    const copilotSkillNames = ['ai-knowledge-query', 'ai-knowledge-capture'];

    for (const name of copilotSkillNames) {
      const src = resolve(skillsDir, 'copilot', `${name}.md`);
      const dest = resolve(copilotSkillsDir, `${name}.md`);

      if (!existsSync(src)) continue;

      // Remove existing symlink if present
      if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) {
        unlinkSync(dest);
      }

      mkdirSync(copilotSkillsDir, { recursive: true });
      cpSync(src, dest);
    }
  }

  private detectOS(): { name: string; arch: string } {
    const name =
      process.platform === 'darwin'
        ? 'macOS'
        : process.platform === 'linux'
          ? 'Linux'
          : process.platform;
    const arch = process.arch;
    return { name, arch };
  }

  private checkDocker(): boolean {
    try {
      this.exec('docker info', true);
      return true;
    } catch {
      return false;
    }
  }

  private getComposeCommand(): string {
    try {
      this.exec('docker compose version', true);
      return 'docker compose';
    } catch {
      try {
        this.exec('docker-compose version', true);
        return 'docker-compose';
      } catch {
        throw new Error(
          "Neither 'docker compose' nor 'docker-compose' found."
        );
      }
    }
  }

  private checkModelExists(model: string): boolean {
    try {
      const output = this.exec('docker exec kb-ollama ollama list');
      return output.includes(model);
    } catch {
      return false;
    }
  }

  private showDockerInstallGuide(os: string): void {
    ui.error('Docker is not available.');
    console.log('');
    if (os === 'macOS') {
      ui.info('Install Docker on macOS:');
      console.log('  brew install docker docker-compose colima');
      console.log('  colima start --cpu 4 --memory 8 --disk 60');
    } else {
      ui.info('Install Docker on Linux:');
      console.log('  curl -fsSL https://get.docker.com | sh');
      console.log('  sudo systemctl enable --now docker');
    }
    console.log('');
    ui.info('Then run this installer again.');
  }

  private exec(cmd: string, silent = false): string {
    const result = execSync(cmd, {
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit',
      timeout: 300000, // 5 min timeout
    });
    // stdio: 'inherit' returns null, 'pipe' returns string
    return (result ?? '').trim();
  }

  private async execAsync(cmd: string): Promise<string> {
    const { stdout } = await execPromise(cmd, {
      encoding: 'utf-8',
      timeout: 300000, // 5 min timeout
    });
    return (stdout ?? '').trim();
  }

  private async waitForAsync(
    check: () => Promise<boolean>,
    maxWaitMs = 60000,
    intervalMs = 2000
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(
      `Service did not become ready within ${maxWaitMs / 1000}s`
    );
  }
}
