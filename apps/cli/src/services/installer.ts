import { execSync, exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import * as ui from '../ui/index.js';
import { ConfigManager } from './config-manager.js';
import { resolveTemplatesDir } from '../utils/resolve-root.js';

const execPromise = promisify(execCb);

const TOTAL_STEPS = 12;

export interface InstallerOptions {
  projectRoot?: string;
  installDir?: string;
  skipConfig?: boolean;
  verbose?: boolean;
}

export class Installer {
  private projectRoot?: string;
  private installDir: string;
  private configManager: ConfigManager;
  private skipConfig: boolean;
  private verbose: boolean;

  constructor(options: InstallerOptions) {
    this.installDir = options.installDir ?? resolve(homedir(), '.ai-knowledge');
    this.projectRoot = options.projectRoot;
    this.configManager = new ConfigManager();
    this.skipConfig = options.skipConfig ?? false;
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

      // Step 3: Ensure Ollama is installed
      currentStep++;
      ui.step(currentStep, TOTAL_STEPS, 'Checking for Ollama...');
      if (!this.checkOllama()) {
        ui.warn('Ollama not found. Installing...');
        await this.installOllama(os.name);
        if (!this.checkOllama()) {
          this.showOllamaInstallGuide(os.name);
          throw new Error('Ollama installation failed. Please install manually and try again.');
        }
      }
      ui.success('Ollama is installed');

      // Step 4: Ensure Ollama is running
      currentStep++;
      ui.step(currentStep, TOTAL_STEPS, 'Ensuring Ollama is running...');
      let ollamaRunning = await this.checkOllamaRunning();
      if (!ollamaRunning) {
        ui.info('Starting Ollama...');
        await this.startOllama();
        // Wait for Ollama to be ready
        ollamaRunning = await this.waitForOllama();
        if (!ollamaRunning) {
          throw new Error('Could not start Ollama. Please start it manually: ollama serve');
        }
      }
      ui.success('Ollama is running');

      // Step 5: Create SQLite database
      currentStep++;
      ui.step(currentStep, TOTAL_STEPS, 'Initializing SQLite database...');
      await this.initializeDatabase();
      ui.success(`Database ready: ${resolve(this.installDir, 'knowledge.db')}`);

      // Step 6: Pull embedding model
      currentStep++;
      const model = process.env.OLLAMA_MODEL || 'all-minilm';
      const modelAvailable = await this.checkModelAvailable(model);
      if (modelAvailable) {
        ui.step(currentStep, TOTAL_STEPS, `Embedding model '${model}' already available`);
      } else if (this.verbose) {
        ui.step(currentStep, TOTAL_STEPS, `Pulling embedding model '${model}'...`);
        this.exec(`ollama pull ${model}`, false);
        ui.success(`Model '${model}' pulled`);
      } else {
        await ui.withSpinner(
          `[${currentStep}/${TOTAL_STEPS}] Pulling embedding model '${model}'...`,
          async () => {
            await this.execAsync(`ollama pull ${model}`);
          }
        );
      }

      // Step 7: Inject agent configs
      currentStep++;
      if (!this.skipConfig) {
        ui.step(currentStep, TOTAL_STEPS, 'Configuring AI agent instructions...');

        try {
          const claudeResult = await this.configManager.injectConfig(
            ConfigManager.CLAUDE_MD,
            this.projectRoot ? resolve(this.projectRoot, 'configs', 'claude-code-instructions.md') : '',
            'Claude Code'
          );
          ui.success(`Claude Code: ${claudeResult.action} ${claudeResult.path}`);
        } catch {
          ui.warn('Could not configure Claude Code instructions (skipped)');
        }

        try {
          const copilotResult = await this.configManager.injectConfig(
            ConfigManager.COPILOT_MD,
            this.projectRoot ? resolve(this.projectRoot, 'configs', 'copilot-instructions.md') : '',
            'GitHub Copilot'
          );
          ui.success(`GitHub Copilot: ${copilotResult.action} ${copilotResult.path}`);
        } catch {
          ui.warn('Could not configure GitHub Copilot instructions (skipped)');
        }
      } else {
        ui.step(currentStep, TOTAL_STEPS, 'Config injection skipped');
      }

      // Step 8: Setup MCP config
      currentStep++;
      if (!this.skipConfig) {
        ui.step(currentStep, TOTAL_STEPS, 'Setting up MCP configuration...');

        const sqlitePath = resolve(this.installDir, 'knowledge.db');
        const mcpEntry = {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@ai-knowledge/mcp-server'],
          env: {
            SQLITE_PATH: sqlitePath,
            OLLAMA_HOST: 'http://localhost:11434',
            OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'all-minilm',
            EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS || '384',
          },
        };

        const mcpResult = await this.configManager.setupMcpConfig(
          ConfigManager.MCP_CONFIG,
          mcpEntry
        );
        ui.success(`MCP config: ${mcpResult.action} ${mcpResult.path}`);

        try {
          const claudeJsonResult = await this.configManager.setupMcpConfig(
            ConfigManager.CLAUDE_JSON,
            mcpEntry
          );
          ui.success(`Claude JSON: ${claudeJsonResult.action} ${claudeJsonResult.path}`);
        } catch {
          // ~/.claude.json may not exist — that's OK
        }
      } else {
        ui.step(currentStep, TOTAL_STEPS, 'MCP config skipped');
      }

      // Step 9: Inject Copilot CLI instructions
      currentStep++;
      if (!this.skipConfig) {
        ui.step(currentStep, TOTAL_STEPS, 'Configuring Copilot CLI instructions...');

        try {
          const copilotCliResult = await this.configManager.injectConfig(
            ConfigManager.COPILOT_INSTRUCTIONS,
            this.projectRoot ? resolve(this.projectRoot, 'configs', 'copilot-instructions.md') : '',
            'Copilot CLI'
          );
          ui.success(`Copilot CLI: ${copilotCliResult.action} ${copilotCliResult.path}`);
        } catch {
          ui.warn('Could not configure Copilot CLI instructions (skipped)');
        }
      } else {
        ui.step(currentStep, TOTAL_STEPS, 'Copilot CLI config skipped');
      }

      // Step 10: Setup Copilot MCP config
      currentStep++;
      if (!this.skipConfig) {
        ui.step(currentStep, TOTAL_STEPS, 'Setting up Copilot MCP configuration...');

        const sqlitePath = resolve(this.installDir, 'knowledge.db');
        const copilotMcpEntry = {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@ai-knowledge/mcp-server'],
          env: {
            SQLITE_PATH: sqlitePath,
            OLLAMA_HOST: 'http://localhost:11434',
            OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'all-minilm',
            EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS || '384',
          },
        };

        try {
          const copilotMcpResult = await this.configManager.setupMcpConfig(
            ConfigManager.COPILOT_MCP_CONFIG,
            copilotMcpEntry
          );
          ui.success(`Copilot MCP: ${copilotMcpResult.action} ${copilotMcpResult.path}`);
        } catch {
          ui.warn('Could not configure Copilot MCP (skipped)');
        }
      } else {
        ui.step(currentStep, TOTAL_STEPS, 'Copilot MCP config skipped');
      }

      // Step 11: Install knowledge skills
      currentStep++;
      if (!this.skipConfig) {
        ui.step(currentStep, TOTAL_STEPS, 'Installing knowledge skills...');
        await this.installSkills();
        ui.success('Knowledge skills installed for Claude Code and Copilot CLI');
      } else {
        ui.step(currentStep, TOTAL_STEPS, 'Skills installation skipped');
      }

      // Step 12: Offer to install Tauri dashboard app
      currentStep++;
      if (!this.skipConfig) {
        const tauriAppInstalled = await this.isTauriAppInstalled();
        if (tauriAppInstalled) {
          ui.step(currentStep, TOTAL_STEPS, 'Dashboard app already installed');
        } else {
          ui.step(currentStep, TOTAL_STEPS, 'Dashboard app...');
          try {
            await this.installTauriApp(os);
          } catch (err) {
            ui.warn(`Could not install dashboard app: ${err instanceof Error ? err.message : err}`);
            ui.info('You can use "kb dashboard --no-app" to run in browser mode');
          }
        }
      } else {
        ui.step(currentStep, TOTAL_STEPS, 'Dashboard app skipped');
      }

      // Success!
      ui.showSuccessBanner({
        database: resolve(this.installDir, 'knowledge.db'),
        ollama: 'localhost:11434',
      });
    } catch (err) {
      ui.error(`Installation failed at step ${currentStep}/${TOTAL_STEPS}`);
      throw err;
    }
  }

  private async setupInstallDir(): Promise<void> {
    const { mkdirSync, existsSync } = await import('node:fs');
    mkdirSync(this.installDir, { recursive: true });

    // No more docker-compose, .env, or init/ to copy — SQLite is created directly
  }

  private async initializeDatabase(): Promise<void> {
    const { createDbClient } = await import('@ai-knowledge/core');
    const dbPath = resolve(this.installDir, 'knowledge.db');

    // createDbClient handles: creating the file, WAL mode, loading sqlite-vec,
    // and creating the virtual table. We also need to create the schema table.
    const { db, sqlite } = createDbClient(dbPath);

    // Create the knowledge_entries table if it doesn't exist
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        type TEXT NOT NULL,
        scope TEXT NOT NULL,
        source TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        expires_at TEXT,
        confidence_score REAL NOT NULL DEFAULT 1.0,
        related_ids TEXT,
        agent_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Create indexes
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_type ON knowledge_entries(type)`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_scope ON knowledge_entries(scope)`);

    sqlite.close();
  }

  private async installSkills(): Promise<void> {
    const { mkdirSync, existsSync, cpSync, lstatSync, unlinkSync } = await import('node:fs');
    const home = homedir();

    const skillsDir = resolve(resolveTemplatesDir(this.projectRoot), 'skills');

    // Claude Code: ~/.claude/skills/<name>/SKILL.md
    const claudeSkillsDir = resolve(home, '.claude', 'skills');
    const claudeSkillNames = ['ai-knowledge-query', 'ai-knowledge-capture'];

    for (const name of claudeSkillNames) {
      const src = resolve(skillsDir, 'claude-code', name, 'SKILL.md');
      const destDir = resolve(claudeSkillsDir, name);
      const dest = resolve(destDir, 'SKILL.md');

      if (!existsSync(src)) continue;

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

      if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) {
        unlinkSync(dest);
      }

      mkdirSync(copilotSkillsDir, { recursive: true });
      cpSync(src, dest);
    }
  }

  private async isTauriAppInstalled(): Promise<boolean> {
    const { existsSync } = await import('node:fs');
    if (process.platform === 'darwin') {
      return (
        existsSync('/Applications/AI Knowledge Base.app') ||
        existsSync(resolve(homedir(), 'Applications', 'AI Knowledge Base.app'))
      );
    }
    if (process.platform === 'linux') {
      return existsSync(resolve(homedir(), '.local', 'bin', 'ai-knowledge-dashboard'));
    }
    return false;
  }

  private async installTauriApp(os: { name: string; arch: string }): Promise<void> {
    if (os.name !== 'macOS') {
      ui.info('Dashboard app not yet available for this platform. Use "kb dashboard" for browser mode.');
      return;
    }

    const { existsSync, mkdirSync, unlinkSync, cpSync } = await import('node:fs');
    const arch = os.arch === 'arm64' ? 'aarch64' : 'x64';

    // Try local build first (for development/repo installs)
    if (this.projectRoot) {
      const localApp = resolve(
        this.projectRoot, 'apps', 'dashboard', 'src-tauri', 'target', 'release', 'bundle', 'macos', 'AI Knowledge Base.app'
      );
      if (existsSync(localApp)) {
        ui.info('Installing dashboard app from local build...');
        cpSync(localApp, '/Applications/AI Knowledge Base.app', { recursive: true });
        this.exec('xattr -cr "/Applications/AI Knowledge Base.app"', true);
        ui.success('Dashboard app installed to /Applications/');
        return;
      }
    }

    // Download from GitHub Releases
    const version = '0.5.0';
    const dmgName = `AI.Knowledge.Base_${version}_${arch}.dmg`;
    const downloadUrl = `https://github.com/Sithion/knowledge-base/releases/download/v${version}/${dmgName}`;

    const tmpDir = resolve(homedir(), '.ai-knowledge', '.tmp');
    mkdirSync(tmpDir, { recursive: true });
    const dmgPath = resolve(tmpDir, dmgName);

    await ui.withSpinner('Downloading dashboard app...', async () => {
      await this.execAsync(`curl -fsSL -o "${dmgPath}" "${downloadUrl}"`);
    });

    await ui.withSpinner('Installing dashboard app...', async () => {
      const mountOutput = this.exec(`hdiutil attach "${dmgPath}" -nobrowse -noverify`);
      const mountPoint = mountOutput.split('\n').pop()?.split('\t').pop()?.trim();

      if (!mountPoint) throw new Error('Could not mount DMG');

      try {
        this.exec(`cp -R "${mountPoint}/AI Knowledge Base.app" /Applications/`);
        this.exec('xattr -cr "/Applications/AI Knowledge Base.app"');
      } finally {
        this.exec(`hdiutil detach "${mountPoint}" -quiet`);
        unlinkSync(dmgPath);
      }
    });

    ui.success('Dashboard app installed to /Applications/');
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

  private checkOllama(): boolean {
    try {
      this.exec('ollama --version', true);
      return true;
    } catch {
      return false;
    }
  }

  private async checkOllamaRunning(): Promise<boolean> {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      return response.ok;
    } catch {
      return false;
    }
  }

  private async checkModelAvailable(model: string): Promise<boolean> {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (!response.ok) return false;
      const data = (await response.json()) as { models: { name: string }[] };
      return data.models.some(m => m.name === model || m.name.startsWith(`${model}:`));
    } catch {
      return false;
    }
  }

  private hasBrew(): boolean {
    try {
      this.exec('brew --version', true);
      return true;
    } catch {
      return false;
    }
  }

  private async installOllama(os: string): Promise<void> {
    if (os === 'macOS') {
      if (this.hasBrew()) {
        try {
          await ui.withSpinner('Installing Ollama via Homebrew...', async () => {
            await this.execAsync('brew install ollama');
          });
          return;
        } catch {
          ui.warn('Homebrew install failed, trying curl installer...');
        }
      }
      // Fallback: curl installer (works on macOS without brew)
      await ui.withSpinner('Installing Ollama via curl...', async () => {
        await this.execAsync('curl -fsSL https://ollama.com/install.sh | sh');
      });
    } else if (os === 'Linux') {
      await ui.withSpinner('Installing Ollama...', async () => {
        await this.execAsync('curl -fsSL https://ollama.com/install.sh | sh');
      });
    } else {
      // Windows or other — cannot auto-install
      throw new Error(
        'Automatic Ollama installation is not supported on this platform. ' +
        'Please download Ollama from https://ollama.com/download and try again.'
      );
    }
  }

  private async startOllama(): Promise<void> {
    // Start ollama serve in background
    const { spawn } = await import('node:child_process');
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }

  private async waitForOllama(): Promise<boolean> {
    const maxWaitMs = 30000;
    const intervalMs = 1000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (await this.checkOllamaRunning()) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  private showOllamaInstallGuide(os: string): void {
    ui.error('Ollama installation failed.');
    console.log('');
    if (os === 'macOS') {
      ui.info('Install Ollama manually on macOS:');
      console.log('  brew install ollama');
      console.log('  or download from https://ollama.com/download');
    } else if (os === 'Linux') {
      ui.info('Install Ollama manually on Linux:');
      console.log('  curl -fsSL https://ollama.com/install.sh | sh');
    } else {
      ui.info('Download Ollama from:');
      console.log('  https://ollama.com/download');
    }
    console.log('');
    ui.info('Then run this installer again.');
  }

  private exec(cmd: string, silent = false): string {
    const result = execSync(cmd, {
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit',
      timeout: 300000,
    });
    return (result ?? '').trim();
  }

  private async execAsync(cmd: string): Promise<string> {
    const { stdout } = await execPromise(cmd, {
      encoding: 'utf-8',
      timeout: 300000,
    });
    return (stdout ?? '').trim();
  }
}
