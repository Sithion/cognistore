import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, cpSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
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

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const distPath = process.env.DASHBOARD_DIST_PATH || join(__dirname, '..', 'dist');
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

  app.get('/api/setup/status', async () => {
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
          const content = require('node:fs').readFileSync(ConfigManager.MCP_CONFIG, 'utf-8');
          return content.includes('ai-knowledge');
        } catch { return false; }
      })();

    const allReady = ollamaInstalled && ollamaRunning && databaseReady && modelAvailable && configsReady && sdkReady;

    return {
      ollamaInstalled,
      ollamaRunning,
      databaseReady,
      modelAvailable,
      configsReady,
      sdkReady,
      allReady,
    };
  });

  app.post('/api/setup/ollama', async () => {
    try {
      // Check if already installed
      try { execSync('which ollama', { stdio: 'pipe' }); return { success: true, message: 'Already installed' }; } catch { /* not installed */ }

      const platform = process.platform;
      if (platform === 'darwin') {
        // Try brew first
        try { execSync('brew --version', { stdio: 'pipe' }); } catch {
          // No brew — use curl
          execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'pipe', timeout: 120000 });
          return { success: true, message: 'Installed via curl' };
        }
        execSync('brew install ollama', { stdio: 'pipe', timeout: 120000 });
        return { success: true, message: 'Installed via Homebrew' };
      } else if (platform === 'linux') {
        execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'pipe', timeout: 120000 });
        return { success: true, message: 'Installed via curl' };
      }
      return { success: false, message: 'Unsupported platform' };
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

      // Start ollama serve in background
      const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
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

      // Install skills
      const skillsDir = resolve(TEMPLATES_PATH, 'skills');
      const home = homedir();

      // Claude Code skills
      for (const name of ['ai-knowledge-query', 'ai-knowledge-capture']) {
        const src = resolve(skillsDir, 'claude-code', name, 'SKILL.md');
        if (existsSync(src)) {
          const destDir = resolve(home, '.claude', 'skills', name);
          mkdirSync(destDir, { recursive: true });
          cpSync(src, resolve(destDir, 'SKILL.md'));
          results.push(`Skill ${name} installed (Claude)`);
        }
      }

      // Copilot skills
      for (const name of ['ai-knowledge-query', 'ai-knowledge-capture']) {
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

  // ─── Uninstall endpoint ────────────────────────────────────────

  app.post('/api/uninstall', async (_request, reply) => {
    try {
      const results: string[] = [];

      // 1. Remove configs
      try { await configManager.removeConfig(ConfigManager.CLAUDE_MD); results.push('CLAUDE.md cleaned'); } catch { /* skip */ }
      try { await configManager.removeConfig(ConfigManager.COPILOT_MD); results.push('Copilot config cleaned'); } catch { /* skip */ }
      try { await configManager.removeConfig(ConfigManager.COPILOT_INSTRUCTIONS); results.push('Copilot CLI cleaned'); } catch { /* skip */ }

      // 2. Remove MCP entries
      try { await configManager.removeMcpEntry(ConfigManager.MCP_CONFIG, 'ai-knowledge'); results.push('MCP config cleaned'); } catch { /* skip */ }
      try { await configManager.removeMcpEntry(ConfigManager.CLAUDE_JSON, 'ai-knowledge'); results.push('Claude JSON cleaned'); } catch { /* skip */ }
      try { await configManager.removeMcpEntry(ConfigManager.COPILOT_MCP_CONFIG, 'ai-knowledge'); results.push('Copilot MCP cleaned'); } catch { /* skip */ }

      // 3. Remove skills
      const home = homedir();
      for (const name of ['ai-knowledge-query', 'ai-knowledge-capture']) {
        const claudeDir = resolve(home, '.claude', 'skills', name);
        if (existsSync(claudeDir)) { rmSync(claudeDir, { recursive: true, force: true }); results.push(`Skill ${name} removed (Claude)`); }
        const copilotFile = resolve(home, '.copilot', 'skills', `${name}.md`);
        if (existsSync(copilotFile)) { unlinkSync(copilotFile); results.push(`Skill ${name} removed (Copilot)`); }
      }

      // 4. Remove Ollama model
      try { execSync(`ollama rm ${process.env.OLLAMA_MODEL || 'all-minilm'}`, { stdio: 'pipe', timeout: 30000 }); results.push('Ollama model removed'); } catch { /* skip */ }

      // 5. Uninstall Ollama
      try { execSync('pkill -f "ollama serve"', { stdio: 'pipe' }); } catch { /* may not be running */ }
      if (process.platform === 'darwin') {
        try { execSync('brew list ollama', { stdio: 'pipe' }); execSync('brew uninstall ollama', { stdio: 'pipe', timeout: 60000 }); results.push('Ollama uninstalled (brew)'); } catch { /* not brew */ }
        for (const p of ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', resolve(home, '.ollama')]) {
          if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); }
        }
      } else if (process.platform === 'linux') {
        try { execSync('sudo systemctl stop ollama', { stdio: 'pipe', timeout: 10000 }); } catch { /* ignore */ }
        try { execSync('sudo systemctl disable ollama', { stdio: 'pipe', timeout: 10000 }); } catch { /* ignore */ }
        for (const p of ['/usr/local/bin/ollama', '/usr/bin/ollama', resolve(home, '.ollama')]) {
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

      // 8. Self-delete app
      reply.send({ success: true, results });

      setTimeout(() => {
        // Remove .app on macOS
        if (process.platform === 'darwin') {
          const appPaths = ['/Applications/AI Knowledge Base.app', resolve(home, 'Applications', 'AI Knowledge Base.app')];
          for (const p of appPaths) {
            if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); }
          }
        }
        // Linux: remove AppImage or deb-installed binary
        if (process.platform === 'linux') {
          const linuxPaths = [resolve(home, '.local', 'bin', 'ai-knowledge-dashboard')];
          for (const p of linuxPaths) {
            if (existsSync(p)) { rmSync(p, { force: true }); }
          }
        }
        process.exit(0);
      }, 1000);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  // ─── Health ────────────────────────────────────────────────────

  app.get('/api/health', async () => {
    if (!sdkReady) {
      return {
        database: { connected: false, error: sdkError || 'Not initialized' },
        ollama: { connected: false, model: null, error: sdkError || 'Not initialized' },
      };
    }
    return sdk.healthCheck();
  });

  // ─── Knowledge CRUD ────────────────────────────────────────────

  app.get('/api/stats', async (_request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    return sdk.getStats();
  });

  app.get('/api/tags', async (_request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    return sdk.listTags();
  });

  app.get('/api/knowledge/recent', async (request, reply) => {
    const err = ensureReady(reply);
    if (err) return err;
    const limit = Number((request.query as any).limit) || 20;
    return sdk.listRecent(limit);
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

  // ─── Start server ──────────────────────────────────────────────

  await app.listen({ port: PORT, host: '0.0.0.0' });
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
