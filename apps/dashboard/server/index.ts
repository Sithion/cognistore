import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, cpSync, readdirSync, unlinkSync, rmdirSync, readFileSync, writeFileSync, statSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { KnowledgeSDK } from '@ai-knowledge/sdk';
import { ConfigManager } from '@ai-knowledge/config';
import type {
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
  SearchOptions,
} from '@ai-knowledge/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.DASHBOARD_PORT) || 3210;
const TEMPLATES_PATH = process.env.TEMPLATES_PATH || join(__dirname, '..', 'templates');
const INSTALL_DIR = resolve(homedir(), '.ai-knowledge');
const VERSION_FILE = resolve(INSTALL_DIR, '.version');

// Read app version from package.json
const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version as string;
  } catch {
    return '0.0.0';
  }
})();

/** Get the last deployed version from ~/.ai-knowledge/.version */
function getDeployedVersion(): string | null {
  try { return readFileSync(VERSION_FILE, 'utf-8').trim(); } catch { return null; }
}

/** Save the current version as deployed */
function saveDeployedVersion(): void {
  mkdirSync(INSTALL_DIR, { recursive: true });
  writeFileSync(VERSION_FILE, APP_VERSION);
}

async function start() {
  const sdk = new KnowledgeSDK();
  const configManager = new ConfigManager();

  let sdkReady = false;
  let sdkError: string | null = null;
  let retryInterval: ReturnType<typeof setInterval> | null = null;

  const tryInitSDK = async () => {
    try {
      await sdk.initialize();
      sdkReady = true;
      sdkError = null;
      if (retryInterval) {
        clearInterval(retryInterval);
        retryInterval = null;
      }
      return true;
    } catch (error) {
      sdkError = error instanceof Error ? error.message : String(error);
      return false;
    }
  };

  const initOk = await tryInitSDK();
  if (!initOk) {
    console.warn(`SDK initialization failed (degraded mode): ${sdkError}`);
    retryInterval = setInterval(async () => {
      await tryInitSDK();
      if (sdkReady) {
        console.log('SDK initialized successfully (recovered from degraded mode)');
      }
    }, 10000);
  }

  // Cleanup old operations log entries every 6 hours
  setInterval(() => {
    if (sdkReady) { try { sdk.cleanupOldOperations(); } catch { /* silent */ } }
  }, 6 * 60 * 60 * 1000);

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const distPath = resolve(process.env.DASHBOARD_DIST_PATH || join(__dirname, '..', 'dist'));
  await app.register(fastifyStatic, {
    root: distPath,
    prefix: '/',
    wildcard: false,
  });

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.sendFile('index.html');
  });

  const ensureReady = (reply: any) => {
    if (!sdkReady) {
      reply.code(503);
      return { error: 'Service unavailable', message: sdkError || 'Run setup first' };
    }
    return null;
  };

  // ─── Setup endpoints ───────────────────────────────────────────

  // Ensure common binary paths are available (Tauri sidecar may not inherit full shell PATH)
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', resolve(homedir(), '.ollama-bin')];
  for (const p of extraPaths) {
    if (existsSync(p) && !process.env.PATH?.includes(p)) {
      process.env.PATH = `${p}:${process.env.PATH}`;
    }
  }

  app.get('/api/setup/status', async () => {
    // Check Node.js v20 availability
    const nodeReady = (() => {
      const nvmDir = resolve(homedir(), '.nvm', 'versions', 'node');
      if (existsSync(nvmDir)) {
        const versions = readdirSync(nvmDir).filter(v => v.startsWith('v20.'));
        if (versions.length > 0) return true;
      }
      // Check system node
      try {
        const version = execSync('node --version', { stdio: 'pipe' }).toString().trim();
        const major = parseInt(version.replace('v', '').split('.')[0], 10);
        return major === 20;
      } catch { return false; }
    })();

    const ollamaInstalled = (() => {
      try { execSync('which ollama', { stdio: 'pipe' }); return true; } catch { return false; }
    })();

    let ollamaRunning = false;
    try {
      const res = await fetch('http://localhost:11434/api/tags');
      ollamaRunning = res.ok;
    } catch { /* not running */ }

    const databaseReady = existsSync(resolve(INSTALL_DIR, 'knowledge.db'));

    let modelAvailable = false;
    if (ollamaRunning) {
      try {
        const res = await fetch('http://localhost:11434/api/tags');
        if (res.ok) {
          const data = (await res.json()) as { models: { name: string }[] };
          const model = process.env.OLLAMA_MODEL || 'all-minilm';
          modelAvailable = data.models.some(m => m.name === model || m.name.startsWith(`${model}:`));
        }
      } catch { /* ignore */ }
    }

    // Check if MCP config exists
    const configsReady = existsSync(ConfigManager.MCP_CONFIG) &&
      (() => {
        try {
          const content = readFileSync(ConfigManager.MCP_CONFIG, 'utf-8');
          return content.includes('ai-knowledge');
        } catch { return false; }
      })();

    const allReady = nodeReady && ollamaInstalled && ollamaRunning && databaseReady && modelAvailable && configsReady && sdkReady;

    return {
      nodeReady,
      ollamaInstalled,
      ollamaRunning,
      databaseReady,
      modelAvailable,
      configsReady,
      sdkReady,
      allReady,
    };
  });

  // Node.js v20 LTS — required for native module compatibility (better-sqlite3)
  const REQUIRED_NODE_MAJOR = 20;

  app.post('/api/setup/node', async () => {
    try {
      const nvmDir = resolve(homedir(), '.nvm');
      const nodeDir = resolve(nvmDir, 'versions', 'node');

      // Check if Node 20 already exists in nvm
      if (existsSync(nodeDir)) {
        const versions = readdirSync(nodeDir).filter(v => v.startsWith(`v${REQUIRED_NODE_MAJOR}.`));
        if (versions.length > 0) {
          const latest = versions.sort().pop()!;
          const nodeBin = resolve(nodeDir, latest, 'bin', 'node');
          if (existsSync(nodeBin)) {
            return { success: true, message: `Node.js ${latest} already installed`, path: nodeBin };
          }
        }
      }

      // Check if system node is already v20
      try {
        const version = execSync('node --version', { stdio: 'pipe' }).toString().trim();
        const major = parseInt(version.replace('v', '').split('.')[0], 10);
        if (major === REQUIRED_NODE_MAJOR) {
          return { success: true, message: `System Node.js ${version} matches`, path: 'node' };
        }
      } catch { /* no system node */ }

      // Install nvm if not present
      if (!existsSync(resolve(nvmDir, 'nvm.sh'))) {
        execSync('curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash', {
          stdio: 'pipe', timeout: 60000,
          env: { ...process.env, NVM_DIR: nvmDir },
        });
      }

      // Install Node 20 via nvm
      const nvmCmd = `export NVM_DIR="${nvmDir}" && . "$NVM_DIR/nvm.sh" && nvm install ${REQUIRED_NODE_MAJOR} --lts`;
      execSync(nvmCmd, { stdio: 'pipe', timeout: 120000, shell: '/bin/bash' });

      // Verify installation
      const versions = readdirSync(nodeDir).filter(v => v.startsWith(`v${REQUIRED_NODE_MAJOR}.`));
      if (versions.length > 0) {
        const latest = versions.sort().pop()!;
        const nodeBin = resolve(nodeDir, latest, 'bin', 'node');
        return { success: true, message: `Installed Node.js ${latest} via nvm`, path: nodeBin };
      }

      return { success: false, message: 'Node.js installation completed but version not found' };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post('/api/setup/ollama', async () => {
    try {
      // Check if already installed
      try { execSync('which ollama', { stdio: 'pipe' }); return { success: true, message: 'Already installed' }; } catch { /* not installed */ }

      const platform = process.platform;
      if (platform === 'darwin') {
        // macOS: use brew (no sudo needed). Curl installer requires sudo which doesn't work in app context.
        // Ensure brew paths are in PATH (Tauri sidecar may not inherit full shell PATH)
        const brewPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
        for (const p of brewPaths) {
          if (existsSync(resolve(p, 'brew')) && !process.env.PATH?.includes(p)) {
            process.env.PATH = `${p}:${process.env.PATH}`;
          }
        }
        let hasBrew = false;
        try { execSync('brew --version', { stdio: 'pipe' }); hasBrew = true; } catch { /* no brew */ }

        if (hasBrew) {
          execSync('brew install ollama', { stdio: 'pipe', timeout: 180000 });
          return { success: true, message: 'Installed via Homebrew' };
        }

        // No brew: try downloading the macOS zip directly
        const ollamaDir = resolve(homedir(), '.ollama-bin');
        mkdirSync(ollamaDir, { recursive: true });
        try {
          execSync(`curl -fsSL -o "${ollamaDir}/ollama" "https://ollama.com/download/ollama-darwin"`, { stdio: 'pipe', timeout: 120000 });
          execSync(`chmod +x "${ollamaDir}/ollama"`, { stdio: 'pipe' });
          // Add to PATH for this session
          process.env.PATH = `${ollamaDir}:${process.env.PATH}`;
          return { success: true, message: 'Installed to ~/.ollama-bin/' };
        } catch {
          return { success: false, message: 'Could not install Ollama. Please install Homebrew (brew.sh) or download Ollama from ollama.com/download' };
        }
      } else if (platform === 'linux') {
        // Linux: curl installer usually works (many distros don't need sudo for /usr/local/bin)
        try {
          execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'pipe', timeout: 180000 });
          return { success: true, message: 'Installed via curl' };
        } catch {
          // Fallback: download binary directly
          const ollamaDir = resolve(homedir(), '.ollama-bin');
          mkdirSync(ollamaDir, { recursive: true });
          execSync(`curl -fsSL -o "${ollamaDir}/ollama" "https://ollama.com/download/ollama-linux-amd64"`, { stdio: 'pipe', timeout: 120000 });
          execSync(`chmod +x "${ollamaDir}/ollama"`, { stdio: 'pipe' });
          process.env.PATH = `${ollamaDir}:${process.env.PATH}`;
          return { success: true, message: 'Installed to ~/.ollama-bin/' };
        }
      }
      return { success: false, message: 'Unsupported platform. Download Ollama from ollama.com/download' };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post('/api/setup/ollama-start', async () => {
    try {
      // Check if already running
      try {
        const res = await fetch('http://localhost:11434/api/tags');
        if (res.ok) return { success: true, message: 'Already running' };
      } catch { /* not running */ }

      // Find ollama binary
      let ollamaBin = 'ollama';
      const ollamaLocalBin = resolve(homedir(), '.ollama-bin', 'ollama');
      if (existsSync(ollamaLocalBin)) ollamaBin = ollamaLocalBin;

      // Start ollama serve in background
      const child = spawn(ollamaBin, ['serve'], { detached: true, stdio: 'ignore' });
      child.unref();

      // Wait up to 15s for it to be ready
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const res = await fetch('http://localhost:11434/api/tags');
          if (res.ok) return { success: true, message: 'Started' };
        } catch { /* keep waiting */ }
      }
      return { success: false, message: 'Timeout waiting for Ollama to start' };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post('/api/setup/database', async () => {
    try {
      const { createDbClient } = await import('@ai-knowledge/core');
      const dbPath = resolve(INSTALL_DIR, 'knowledge.db');
      mkdirSync(INSTALL_DIR, { recursive: true });

      const { sqlite } = createDbClient(dbPath);
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
      sqlite.exec('CREATE INDEX IF NOT EXISTS idx_type ON knowledge_entries(type)');
      sqlite.exec('CREATE INDEX IF NOT EXISTS idx_scope ON knowledge_entries(scope)');
      sqlite.close();

      return { success: true, path: dbPath };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post('/api/setup/model', async () => {
    try {
      const model = process.env.OLLAMA_MODEL || 'all-minilm';
      const host = process.env.OLLAMA_HOST || 'http://localhost:11434';

      // Check if already available
      const tagsRes = await fetch(`${host}/api/tags`);
      if (tagsRes.ok) {
        const data = (await tagsRes.json()) as { models: { name: string }[] };
        if (data.models.some(m => m.name === model || m.name.startsWith(`${model}:`))) {
          return { success: true, message: 'Model already available' };
        }
      }

      // Pull model
      const pullRes = await fetch(`${host}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
      });

      if (!pullRes.ok) {
        return { success: false, message: `Pull failed: ${pullRes.statusText}` };
      }

      // Consume stream to completion
      const reader = pullRes.body?.getReader();
      if (reader) {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }

      return { success: true, message: `Model ${model} pulled` };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post('/api/setup/configure', async () => {
    try {
      const results: string[] = [];

      // Inject agent instructions
      const configTemplateDir = resolve(TEMPLATES_PATH, 'configs');

      try {
        const claudeTemplate = existsSync(resolve(configTemplateDir, 'claude-code-instructions.md'))
          ? resolve(configTemplateDir, 'claude-code-instructions.md') : '';
        await configManager.injectConfig(ConfigManager.CLAUDE_MD, claudeTemplate, 'Claude Code');
        results.push('Claude Code config injected');
      } catch { results.push('Claude Code config skipped'); }

      try {
        const copilotTemplate = existsSync(resolve(configTemplateDir, 'copilot-instructions.md'))
          ? resolve(configTemplateDir, 'copilot-instructions.md') : '';
        await configManager.injectConfig(ConfigManager.COPILOT_MD, copilotTemplate, 'GitHub Copilot');
        results.push('Copilot config injected');
      } catch { results.push('Copilot config skipped'); }

      try {
        await configManager.injectConfig(ConfigManager.COPILOT_INSTRUCTIONS, '', 'Copilot CLI');
        results.push('Copilot CLI config injected');
      } catch { results.push('Copilot CLI config skipped'); }

      // Setup MCP configs
      const mcpEntry = {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@ai-knowledge/mcp-server'],
        env: {
          SQLITE_PATH: resolve(INSTALL_DIR, 'knowledge.db'),
          OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://localhost:11434',
          OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'all-minilm',
          EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS || '384',
        },
      };

      await configManager.setupMcpConfig(ConfigManager.MCP_CONFIG, mcpEntry);
      results.push('Claude MCP config set');

      try { await configManager.setupMcpConfig(ConfigManager.CLAUDE_JSON, mcpEntry); results.push('Claude JSON config set'); } catch { /* optional */ }
      try { await configManager.setupMcpConfig(ConfigManager.COPILOT_MCP_CONFIG, mcpEntry); results.push('Copilot MCP config set'); } catch { /* optional */ }
      try { await configManager.setupOpenCodeMcp(mcpEntry); results.push('OpenCode MCP config set'); } catch { /* optional */ }

      // Install skills
      const skillsDir = resolve(TEMPLATES_PATH, 'skills');
      const home = homedir();

      // Claude Code skills (with hooks directories)
      for (const name of ['ai-knowledge-query', 'ai-knowledge-capture', 'ai-knowledge-plan']) {
        const srcDir = resolve(skillsDir, 'claude-code', name);
        if (existsSync(srcDir)) {
          const destDir = resolve(home, '.claude', 'skills', name);
          mkdirSync(destDir, { recursive: true });
          cpSync(srcDir, destDir, { recursive: true });
          // Make hook scripts executable
          const hooksDir = resolve(destDir, 'hooks');
          if (existsSync(hooksDir)) {
            for (const file of readdirSync(hooksDir)) {
              if (file.endsWith('.sh')) {
                chmodSync(resolve(hooksDir, file), 0o755);
              }
            }
          }
          results.push(`Skill ${name} installed (Claude)`);
        }
      }

      // Copilot skills
      for (const name of ['ai-knowledge-query', 'ai-knowledge-capture', 'ai-knowledge-plan']) {
        const src = resolve(skillsDir, 'copilot', `${name}.md`);
        if (existsSync(src)) {
          const destDir = resolve(home, '.copilot', 'skills');
          mkdirSync(destDir, { recursive: true });
          cpSync(src, resolve(destDir, `${name}.md`));
          results.push(`Skill ${name} installed (Copilot)`);
        }
      }

      return { success: true, results };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post('/api/setup/complete', async () => {
    try {
      if (sdkReady) {
        await sdk.close();
        sdkReady = false;
      }
      const ok = await tryInitSDK();
      return { success: ok, sdkReady };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  // ─── Upgrade endpoints ────────────────────────────────────────

  app.get('/api/upgrade/check', async () => {
    const deployed = getDeployedVersion();
    const current = APP_VERSION;
    const needsUpgrade = deployed !== null && deployed !== current;
    return {
      needsUpgrade,
      fromVersion: deployed,
      toVersion: current,
      isFirstInstall: deployed === null,
    };
  });

  app.post('/api/upgrade/run', async () => {
    const results: { step: string; status: 'success' | 'error'; message?: string }[] = [];

    // Step 1: Database migrations (handled automatically by createDbClient, but log it)
    try {
      if (sdkReady) { await sdk.close(); sdkReady = false; }
      const ok = await tryInitSDK();
      results.push({ step: 'database', status: ok ? 'success' : 'error', message: ok ? 'Schema up to date' : 'SDK init failed' });
    } catch (e: any) {
      results.push({ step: 'database', status: 'error', message: e.message });
    }

    // Step 2: Re-inject agent instructions
    const configTemplateDir = resolve(TEMPLATES_PATH, 'configs');
    try {
      const claudeTemplate = existsSync(resolve(configTemplateDir, 'claude-code-instructions.md'))
        ? resolve(configTemplateDir, 'claude-code-instructions.md') : '';
      await configManager.injectConfig(ConfigManager.CLAUDE_MD, claudeTemplate, 'Claude Code');
      results.push({ step: 'instructions-claude', status: 'success' });
    } catch (e: any) {
      results.push({ step: 'instructions-claude', status: 'error', message: e.message });
    }

    try {
      const copilotTemplate = existsSync(resolve(configTemplateDir, 'copilot-instructions.md'))
        ? resolve(configTemplateDir, 'copilot-instructions.md') : '';
      await configManager.injectConfig(ConfigManager.COPILOT_MD, copilotTemplate, 'GitHub Copilot');
      results.push({ step: 'instructions-copilot', status: 'success' });
    } catch (e: any) {
      results.push({ step: 'instructions-copilot', status: 'error', message: e.message });
    }

    // Step 3: Re-setup MCP configs
    try {
      const mcpEntry = {
        type: 'stdio', command: 'npx', args: ['-y', '@ai-knowledge/mcp-server'],
        env: {
          SQLITE_PATH: resolve(INSTALL_DIR, 'knowledge.db'),
          OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://localhost:11434',
          OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'all-minilm',
          EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS || '384',
        },
      };
      await configManager.setupMcpConfig(ConfigManager.MCP_CONFIG, mcpEntry);
      try { await configManager.setupMcpConfig(ConfigManager.CLAUDE_JSON, mcpEntry); } catch { /* optional */ }
      try { await configManager.setupMcpConfig(ConfigManager.COPILOT_MCP_CONFIG, mcpEntry); } catch { /* optional */ }
      try { await configManager.setupOpenCodeMcp(mcpEntry); } catch { /* optional */ }
      results.push({ step: 'mcp-configs', status: 'success' });
    } catch (e: any) {
      results.push({ step: 'mcp-configs', status: 'error', message: e.message });
    }

    // Step 4: Re-deploy skills and hooks
    try {
      const skillsDir = resolve(TEMPLATES_PATH, 'skills');
      const home = homedir();

      for (const name of ['ai-knowledge-query', 'ai-knowledge-capture', 'ai-knowledge-plan']) {
        const srcDir = resolve(skillsDir, 'claude-code', name);
        if (existsSync(srcDir)) {
          const destDir = resolve(home, '.claude', 'skills', name);
          mkdirSync(destDir, { recursive: true });
          cpSync(srcDir, destDir, { recursive: true });
          const hooksDir = resolve(destDir, 'hooks');
          if (existsSync(hooksDir)) {
            for (const file of readdirSync(hooksDir)) {
              if (file.endsWith('.sh')) chmodSync(resolve(hooksDir, file), 0o755);
            }
          }
        }
      }

      for (const name of ['ai-knowledge-query', 'ai-knowledge-capture', 'ai-knowledge-plan']) {
        const src = resolve(skillsDir, 'copilot', `${name}.md`);
        if (existsSync(src)) {
          const destDir = resolve(home, '.copilot', 'skills');
          mkdirSync(destDir, { recursive: true });
          cpSync(src, resolve(destDir, `${name}.md`));
        }
      }

      results.push({ step: 'skills', status: 'success' });
    } catch (e: any) {
      results.push({ step: 'skills', status: 'error', message: e.message });
    }

    // Step 5: Save new version
    try {
      saveDeployedVersion();
      results.push({ step: 'version', status: 'success', message: `v${APP_VERSION}` });
    } catch (e: any) {
      results.push({ step: 'version', status: 'error', message: e.message });
    }

    const allSuccess = results.every((r) => r.status === 'success');
    return { success: allSuccess, fromVersion: getDeployedVersion(), toVersion: APP_VERSION, results };
  });

  // Also save version after initial setup completes
  app.addHook('onResponse', (request) => {
    if (request.url === '/api/setup/complete' && request.method === 'POST') {
      try { saveDeployedVersion(); } catch { /* silent */ }
    }
  });

  // ─── Uninstall endpoint ────────────────────────────────────────

  app.post('/api/uninstall', async (_request, reply) => {
    const step = async (label: string, fn: () => unknown, results: string[], errors: string[]) => {
      try { await fn(); results.push(label); }
      catch (e) { errors.push(`${label}: ${e}`); }
    };

    try {
      const results: string[] = [];
      const errors: string[] = [];
      const home = homedir();

      // 1. Remove config markers
      await step('CLAUDE.md cleaned', () => configManager.removeConfig(ConfigManager.CLAUDE_MD), results, errors);
      await step('Copilot config cleaned', () => configManager.removeConfig(ConfigManager.COPILOT_MD), results, errors);
      await step('Copilot CLI cleaned', () => configManager.removeConfig(ConfigManager.COPILOT_INSTRUCTIONS), results, errors);

      // 2. Remove MCP entries
      await step('MCP config cleaned', () => configManager.removeMcpEntry(ConfigManager.MCP_CONFIG, 'ai-knowledge'), results, errors);
      await step('Claude JSON cleaned', () => configManager.removeMcpEntry(ConfigManager.CLAUDE_JSON, 'ai-knowledge'), results, errors);
      await step('Copilot MCP cleaned', () => configManager.removeMcpEntry(ConfigManager.COPILOT_MCP_CONFIG, 'ai-knowledge'), results, errors);
      await step('OpenCode MCP cleaned', () => configManager.removeOpenCodeMcp(), results, errors);

      // 3. Remove skills
      for (const name of ['ai-knowledge-query', 'ai-knowledge-capture', 'ai-knowledge-plan']) {
        const claudeDir = resolve(home, '.claude', 'skills', name);
        if (existsSync(claudeDir)) { rmSync(claudeDir, { recursive: true, force: true }); results.push(`Skill ${name} removed (Claude)`); }
        const copilotFile = resolve(home, '.copilot', 'skills', `${name}.md`);
        if (existsSync(copilotFile)) { unlinkSync(copilotFile); results.push(`Skill ${name} removed (Copilot)`); }
      }

      // 4. Remove Ollama model
      await step('Ollama model removed', () => { execSync(`ollama rm ${process.env.OLLAMA_MODEL || 'all-minilm'}`, { stdio: 'pipe', timeout: 30000 }); }, results, errors);

      // 5. Uninstall Ollama
      try { execSync('pkill -f "ollama serve"', { stdio: 'pipe' }); } catch { /* may not be running */ }

      const ollamaBinDir = resolve(home, '.ollama-bin');
      const ollamaDataDir = resolve(home, '.ollama');

      if (process.platform === 'darwin') {
        try { execSync('brew list ollama', { stdio: 'pipe' }); execSync('brew uninstall ollama', { stdio: 'pipe', timeout: 60000 }); results.push('Ollama uninstalled (brew)'); } catch { /* not brew */ }
        for (const p of ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', ollamaDataDir, ollamaBinDir]) {
          if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); }
        }
        results.push('Ollama paths cleaned');
      } else if (process.platform === 'linux') {
        try { execSync('systemctl stop ollama', { stdio: 'pipe', timeout: 10000 }); } catch { /* ignore */ }
        try { execSync('systemctl disable ollama', { stdio: 'pipe', timeout: 10000 }); } catch { /* ignore */ }
        for (const p of ['/usr/local/bin/ollama', '/usr/bin/ollama', ollamaDataDir, ollamaBinDir]) {
          if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); }
        }
        results.push('Ollama removed');
      }

      // 6. Close SDK and remove database
      if (sdkReady) { await sdk.close(); sdkReady = false; }
      if (existsSync(INSTALL_DIR)) { rmSync(INSTALL_DIR, { recursive: true, force: true }); results.push('Install dir removed'); }

      // 7. Clean backup files
      const backupTargets = [
        { dir: resolve(home, '.claude'), prefix: 'CLAUDE.md.bak.' },
        { dir: resolve(home, '.claude'), prefix: 'mcp-config.json.bak.' },
        { dir: home, prefix: '.claude.json.bak.' },
        { dir: resolve(home, '.github'), prefix: 'copilot-instructions.md.bak.' },
        { dir: resolve(home, '.copilot'), prefix: 'copilot-instructions.md.bak.' },
        { dir: resolve(home, '.copilot'), prefix: 'mcp-config.json.bak.' },
      ];
      for (const target of backupTargets) {
        try {
          if (!existsSync(target.dir)) continue;
          for (const file of readdirSync(target.dir)) {
            if (file.startsWith(target.prefix)) { unlinkSync(resolve(target.dir, file)); }
          }
        } catch { /* skip */ }
      }
      results.push('Backup files cleaned');

      // 8. Self-delete app (increased timeout for response flush)
      reply.send({ success: true, results, errors: errors.length > 0 ? errors : undefined });

      setTimeout(() => {
        if (process.platform === 'darwin') {
          // Use shell command for reliable self-delete on macOS
          const appPaths = ['/Applications/AI Knowledge Base.app', resolve(home, 'Applications', 'AI Knowledge Base.app')];
          for (const p of appPaths) {
            if (existsSync(p)) {
              try { execSync(`rm -rf "${p}"`, { stdio: 'pipe' }); } catch { /* best effort */ }
            }
          }
        }
        if (process.platform === 'linux') {
          const linuxPaths = [resolve(home, '.local', 'bin', 'ai-knowledge-dashboard')];
          for (const p of linuxPaths) {
            if (existsSync(p)) { rmSync(p, { force: true }); }
          }
        }
        process.exit(0);
      }, 3000);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  // ─── Database maintenance ─────────────────────────────────────

  app.post('/api/maintenance/cleanup', async (_request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    try {
      const result = await sdk.cleanupDatabase();
      const dbPath = resolve(INSTALL_DIR, 'knowledge.db');
      const sizeBytes = statSync(dbPath).size;
      return {
        success: true,
        ...result,
        sizeAfter: sizeBytes < 1024 * 1024
          ? `${(sizeBytes / 1024).toFixed(1)} KB`
          : `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`,
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  // ─── Health ────────────────────────────────────────────────────

  const SIDECAR_TOKEN = process.env.SIDECAR_TOKEN || '';

  app.get('/api/health', async () => {
    const health = sdkReady
      ? await sdk.healthCheck()
      : {
          database: { connected: false, error: sdkError || 'Not initialized' },
          ollama: { connected: false, model: null, error: sdkError || 'Not initialized' },
        };
    return { ...health, token: SIDECAR_TOKEN };
  });

  // ─── Knowledge CRUD ────────────────────────────────────────────

  app.get('/api/stats', async (_request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    return sdk.getStats();
  });

  app.get('/api/metrics', async (_request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;

    try {
    const dbPath = resolve(INSTALL_DIR, 'knowledge.db');
    let dbSizeBytes = 0;
    try { dbSizeBytes = statSync(dbPath).size; } catch { /* ignore */ }

    const stats = await sdk.getStats();

    // Query recent entries for activity data
    const recent = await sdk.listRecent(1000);
    const now = new Date();
    const last24h = recent.filter((e: any) => {
      const created = new Date(e.createdAt);
      return (now.getTime() - created.getTime()) < 24 * 60 * 60 * 1000;
    }).length;
    const last7d = recent.filter((e: any) => {
      const created = new Date(e.createdAt);
      return (now.getTime() - created.getTime()) < 7 * 24 * 60 * 60 * 1000;
    }).length;
    const last30d = recent.filter((e: any) => {
      const created = new Date(e.createdAt);
      return (now.getTime() - created.getTime()) < 30 * 24 * 60 * 60 * 1000;
    }).length;

    // Activity by day (last 15 days) for area chart
    const activityByDay: { date: string; count: number }[] = [];
    for (let i = 14; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const count = recent.filter((e: any) => {
        const created = new Date(e.createdAt).toISOString().split('T')[0];
        return created === dateStr;
      }).length;
      activityByDay.push({ date: dateStr, count });
    }

    // Heatmap data (last 90 days) for contribution graph
    const heatmap: { date: string; count: number }[] = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const count = recent.filter((e: any) => {
        const created = new Date(e.createdAt).toISOString().split('T')[0];
        return created === dateStr;
      }).length;
      heatmap.push({ date: dateStr, count });
    }

    // Type distribution for pie chart
    const typeDistribution = stats.byType.map((t: any) => ({
      name: t.type.charAt(0).toUpperCase() + t.type.slice(1),
      value: t.count,
    }));

    // Operation counters (reads/writes last hour + last day)
    let operations = { readsLastHour: 0, readsLastDay: 0, writesLastHour: 0, writesLastDay: 0 };
    try { operations = sdk.getOperationCounts(); } catch { /* silent */ }

    return {
      database: {
        sizeBytes: dbSizeBytes,
        sizeFormatted: dbSizeBytes < 1024 * 1024
          ? `${(dbSizeBytes / 1024).toFixed(1)} KB`
          : `${(dbSizeBytes / (1024 * 1024)).toFixed(1)} MB`,
        path: dbPath,
      },
      activity: {
        last24h,
        last7d,
        last30d,
        total: stats.total,
      },
      activityByDay,
      heatmap,
      typeDistribution,
      operations,
    };
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to load metrics', message: error instanceof Error ? error.message : String(error) };
    }
  });

  app.get('/api/tags', async (_request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    return sdk.listTags();
  });

  app.get('/api/knowledge/recent', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const q = request.query as any;
    const limit = Number(q.limit) || 20;
    const filters: { type?: string; scope?: string } = {};
    if (q.type) filters.type = q.type;
    if (q.scope) filters.scope = q.scope;
    return sdk.listRecent(limit, filters);
  });

  app.get('/api/metrics/top-tags', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const limit = Number((request.query as any).limit) || 10;
    return sdk.getTopTags(limit);
  });

  app.post<{ Body: Record<string, unknown> }>('/api/knowledge/search', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const body = request.body as any;
    const { query, ...options } = body;
    if (!query || typeof query !== 'string') {
      throw new Error('Query is required and must be a string');
    }
    return sdk.getKnowledge(query, options as Partial<SearchOptions>);
  });

  app.get<{ Params: { id: string } }>('/api/knowledge/:id', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const entry = await sdk.getKnowledgeById(request.params.id);
    if (!entry) return { error: 'Not found' };
    return entry;
  });

  app.post<{ Body: CreateKnowledgeInput }>('/api/knowledge', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    return sdk.addKnowledge(request.body);
  });

  app.put<{ Params: { id: string }; Body: UpdateKnowledgeInput }>('/api/knowledge/:id', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const result = await sdk.updateKnowledge(request.params.id, request.body);
    if (!result) return { error: 'Not found' };
    return result;
  });

  app.delete<{ Params: { id: string } }>('/api/knowledge/:id', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const deleted = await sdk.deleteKnowledge(request.params.id);
    return { deleted };
  });

  // ─── Plans endpoints ─────────────────────────────────────────

  app.get('/api/plans', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const q = request.query as any;
    const limit = Number(q.limit) || 20;
    const status = q.status || undefined;
    return sdk.listPlans(limit, status);
  });

  app.get<{ Params: { id: string } }>('/api/plans/:id/relations', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    return sdk.getPlanRelations(request.params.id);
  });

  app.post<{ Params: { id: string }; Body: { knowledgeId: string; relationType: 'input' | 'output' } }>('/api/plans/:id/relations', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const { knowledgeId, relationType } = request.body;
    sdk.addPlanRelation(request.params.id, knowledgeId, relationType);
    return { success: true };
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/plans/:id', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const result = sdk.updatePlan(request.params.id, request.body as any);
    if (!result) return { error: 'Not found' };
    return result;
  });

  app.delete<{ Params: { id: string } }>('/api/plans/:id', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    return { deleted: sdk.deletePlan(request.params.id) };
  });

  // ─── Plan Tasks endpoints ───────────────────────────────────

  app.get<{ Params: { id: string } }>('/api/plans/:id/tasks', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    return sdk.listPlanTasks(request.params.id);
  });

  app.post<{ Params: { id: string }; Body: { description: string; priority?: string; notes?: string } }>('/api/plans/:id/tasks', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    return sdk.createPlanTask({ planId: request.params.id, ...request.body });
  });

  app.put<{ Params: { taskId: string }; Body: Record<string, unknown> }>('/api/plans/tasks/:taskId', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const result = sdk.updatePlanTask(request.params.taskId, request.body as any);
    if (!result) return { error: 'Task not found' };
    return result;
  });

  app.delete<{ Params: { taskId: string } }>('/api/plans/tasks/:taskId', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    return { deleted: sdk.deletePlanTask(request.params.taskId) };
  });

  // ─── Plan Metrics endpoint ──────────────────────────────────

  app.get('/api/metrics/plans', async (_request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;

    try {
      const allPlans = sdk.listPlans(1000);
      const taskStats = sdk.getPlanTaskStats();

      const plansByStatus = { total: 0, draft: 0, active: 0, completed: 0, archived: 0 };
      for (const p of allPlans) {
        plansByStatus.total++;
        const s = (p as any).status as string;
        if (s in plansByStatus) (plansByStatus as any)[s]++;
      }

      // Plans created per day (last 15 days)
      const now = new Date();
      const plansByDay: { date: string; count: number }[] = [];
      for (let i = 14; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const count = allPlans.filter((p: any) => {
          const created = new Date(p.createdAt).toISOString().split('T')[0];
          return created === dateStr;
        }).length;
        plansByDay.push({ date: dateStr, count });
      }

      return {
        plans: plansByStatus,
        tasks: {
          ...taskStats,
          avgPerPlan: plansByStatus.total > 0 ? Math.round((taskStats.total / plansByStatus.total) * 10) / 10 : 0,
        },
        plansByDay,
      };
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to load plan metrics', message: error instanceof Error ? error.message : String(error) };
    }
  });

  // ─── Start server ──────────────────────────────────────────────

  await app.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`Dashboard API running at http://localhost:${PORT}${sdkReady ? '' : ' (degraded mode)'}`);

  const shutdown = async () => {
    if (sdkReady) await sdk.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((error) => {
  console.error('Failed to start dashboard server:', error);
  process.exit(1);
});
