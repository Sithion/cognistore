import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, rmSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import * as ui from '../ui/index.js';
import { ConfigManager } from './config-manager.js';

export interface UninstallerOptions {
  force?: boolean;
  keepData?: boolean;
}

interface CleanupSummary {
  component: string;
  status: 'removed' | 'not found' | 'skipped' | 'error';
  detail?: string;
}

export class Uninstaller {
  private installDir: string;
  private configManager: ConfigManager;
  private force: boolean;
  private keepData: boolean;
  private removeOllama = true;
  private removeModel = true;

  constructor(options: UninstallerOptions) {
    this.installDir = resolve(homedir(), '.ai-knowledge');
    this.configManager = new ConfigManager();
    this.force = options.force ?? false;
    this.keepData = options.keepData ?? false;
  }

  async run(): Promise<void> {
    ui.showUninstallBanner();
    const summary: CleanupSummary[] = [];

    // Confirmation prompts
    if (!this.force) {
      const confirmed = await ui.confirmAction(
        'This will remove AI Knowledge Base and its configurations. Continue?',
        false
      );
      if (!confirmed) {
        ui.info('Uninstall cancelled.');
        return;
      }

      if (!this.keepData) {
        const removeData = await ui.confirmAction(
          'Remove the SQLite database (all knowledge data will be lost)?',
          true
        );
        this.keepData = !removeData;
      }

      this.removeModel = await ui.confirmAction(
        'Remove the Ollama embedding model (all-minilm)?',
        true
      );

      this.removeOllama = await ui.confirmAction(
        'Uninstall Ollama from this machine?',
        true
      );

      const cleanOld = await ui.confirmAction(
        "Clean up old 'knowledge' MCP server entries (from ai-config)?",
        true
      );

      if (cleanOld) {
        await this.cleanOldKnowledge(summary);
      }
    }

    const TOTAL_STEPS = 12;
    let step = 0;

    // Step 1: Remove Claude Code agent config
    step++;
    ui.step(step, TOTAL_STEPS, 'Removing Claude Code agent config...');
    try {
      const result = await this.configManager.removeConfig(ConfigManager.CLAUDE_MD);
      if (result.removed) {
        summary.push({ component: 'Claude Code config (~/.claude/CLAUDE.md)', status: 'removed' });
        ui.success('Removed knowledge-first rules from CLAUDE.md');
      } else if (!result.hadMarkers) {
        summary.push({ component: 'Claude Code config (~/.claude/CLAUDE.md)', status: 'not found', detail: 'No markers found' });
        ui.info('No AI-KNOWLEDGE markers found in CLAUDE.md');
      }
    } catch (err) {
      summary.push({ component: 'Claude Code config', status: 'error', detail: String(err) });
      ui.warn(`Could not clean CLAUDE.md: ${err}`);
    }

    // Step 2: Remove Copilot agent config (~/.github/copilot-instructions.md)
    step++;
    ui.step(step, TOTAL_STEPS, 'Removing Copilot agent config...');
    try {
      const result = await this.configManager.removeConfig(ConfigManager.COPILOT_MD);
      if (result.removed) {
        summary.push({ component: 'Copilot config (~/.github/copilot-instructions.md)', status: 'removed' });
        ui.success('Removed knowledge-first rules from copilot-instructions.md');
      } else if (!result.hadMarkers) {
        summary.push({ component: 'Copilot config', status: 'not found', detail: 'No markers found' });
        ui.info('No AI-KNOWLEDGE markers found in copilot-instructions.md');
      }
    } catch (err) {
      summary.push({ component: 'Copilot config', status: 'error', detail: String(err) });
      ui.warn(`Could not clean copilot-instructions.md: ${err}`);
    }

    // Step 3: Remove Copilot CLI instructions (~/.copilot/copilot-instructions.md)
    step++;
    ui.step(step, TOTAL_STEPS, 'Removing Copilot CLI instructions...');
    try {
      const result = await this.configManager.removeConfig(ConfigManager.COPILOT_INSTRUCTIONS);
      if (result.removed) {
        summary.push({ component: 'Copilot CLI (~/.copilot/copilot-instructions.md)', status: 'removed' });
        ui.success('Removed knowledge rules from Copilot CLI instructions');
      } else if (!result.hadMarkers) {
        summary.push({ component: 'Copilot CLI instructions', status: 'not found', detail: 'No markers found' });
        ui.info('No AI-KNOWLEDGE markers found in Copilot CLI instructions');
      }
    } catch (err) {
      summary.push({ component: 'Copilot CLI instructions', status: 'error', detail: String(err) });
      ui.warn(`Could not clean Copilot CLI instructions: ${err}`);
    }

    // Step 4: Remove MCP config from ~/.claude/mcp-config.json
    step++;
    ui.step(step, TOTAL_STEPS, 'Removing MCP server configuration...');
    try {
      const result = await this.configManager.removeMcpEntry(ConfigManager.MCP_CONFIG, 'ai-knowledge');
      if (result.removed) {
        summary.push({ component: 'MCP config (~/.claude/mcp-config.json)', status: 'removed' });
        ui.success('Removed ai-knowledge from mcp-config.json');
      } else {
        summary.push({ component: 'MCP config (mcp-config.json)', status: 'not found' });
        ui.info('No ai-knowledge entry in mcp-config.json');
      }
    } catch (err) {
      summary.push({ component: 'MCP config (mcp-config.json)', status: 'error', detail: String(err) });
    }

    // Step 5: Remove MCP config from ~/.claude.json
    step++;
    ui.step(step, TOTAL_STEPS, 'Removing MCP entry from claude.json...');
    try {
      const result = await this.configManager.removeMcpEntry(ConfigManager.CLAUDE_JSON, 'ai-knowledge');
      if (result.removed) {
        summary.push({ component: 'MCP config (~/.claude.json)', status: 'removed' });
        ui.success('Removed ai-knowledge from .claude.json');
      } else {
        summary.push({ component: 'MCP config (.claude.json)', status: 'not found' });
        ui.info('No ai-knowledge entry in .claude.json');
      }
    } catch (err) {
      summary.push({ component: 'MCP config (.claude.json)', status: 'error', detail: String(err) });
    }

    // Step 6: Clean Copilot MCP config
    step++;
    ui.step(step, TOTAL_STEPS, 'Cleaning Copilot MCP config...');
    try {
      await this.cleanCopilotMcp(summary);
    } catch (err) {
      summary.push({ component: 'Copilot MCP config', status: 'error', detail: String(err) });
    }

    // Step 7: Remove knowledge skills
    step++;
    ui.step(step, TOTAL_STEPS, 'Removing knowledge skills...');
    this.removeSkills(summary);

    // Step 8: Remove Tauri dashboard app
    step++;
    ui.step(step, TOTAL_STEPS, 'Removing dashboard app...');
    this.removeTauriApp(summary);

    // Step 9: Remove install directory (~/.ai-knowledge/) including SQLite database
    step++;
    ui.step(step, TOTAL_STEPS, 'Removing install directory...');
    this.removeInstallDir(summary);

    // Step 9: Remove Ollama embedding model
    step++;
    ui.step(step, TOTAL_STEPS, 'Removing Ollama embedding model...');
    if (this.removeModel) {
      this.removeOllamaModel(summary);
    } else {
      summary.push({ component: 'Ollama model', status: 'skipped', detail: 'User chose to keep' });
      ui.info('Ollama model kept');
    }

    // Step 10: Uninstall Ollama
    step++;
    ui.step(step, TOTAL_STEPS, 'Uninstalling Ollama...');
    if (this.removeOllama) {
      await this.uninstallOllama(summary);
    } else {
      summary.push({ component: 'Ollama', status: 'skipped', detail: 'User chose to keep' });
      ui.info('Ollama kept');
    }

    // Step 11: Clean backup files
    step++;
    ui.step(step, TOTAL_STEPS, 'Cleaning backup files...');
    this.cleanBackupFiles(summary);

    // Print summary
    this.printSummary(summary);
  }

  private async cleanOldKnowledge(summary: CleanupSummary[]): Promise<void> {
    ui.info("Cleaning up old 'knowledge' MCP entries...");
    try {
      const result = await this.configManager.removeOldKnowledgeMcp();
      if (result.cleaned.length > 0) {
        for (const path of result.cleaned) {
          summary.push({ component: `Old knowledge MCP (${path})`, status: 'removed' });
        }
        ui.success(`Removed old knowledge entries from ${result.cleaned.length} file(s)`);
      } else {
        ui.info('No old knowledge MCP entries found');
      }
    } catch (err) {
      summary.push({ component: 'Old knowledge MCP', status: 'error', detail: String(err) });
    }
  }

  private async cleanCopilotMcp(summary: CleanupSummary[]): Promise<void> {
    const copilotMcpPath = resolve(homedir(), '.copilot', 'mcp-config.json');
    try {
      const result = await this.configManager.removeMcpEntry(copilotMcpPath, 'ai-knowledge');
      if (result.removed) {
        summary.push({ component: 'Copilot MCP (~/.copilot/mcp-config.json)', status: 'removed' });
        ui.success('Removed ai-knowledge from Copilot MCP config');
      } else {
        summary.push({ component: 'Copilot MCP config', status: 'not found' });
        ui.info('No ai-knowledge entry in Copilot MCP config');
      }
    } catch {
      summary.push({ component: 'Copilot MCP config', status: 'not found' });
    }
  }

  private removeTauriApp(summary: CleanupSummary[]): void {
    const appPaths = [
      '/Applications/AI Knowledge Base.app',
      resolve(homedir(), 'Applications', 'AI Knowledge Base.app'),
    ];

    for (const appPath of appPaths) {
      if (existsSync(appPath)) {
        rmSync(appPath, { recursive: true, force: true });
        summary.push({ component: 'Dashboard app', status: 'removed', detail: appPath });
        ui.success(`Removed ${appPath}`);
        return;
      }
    }

    // Linux
    const linuxPath = resolve(homedir(), '.local', 'bin', 'ai-knowledge-dashboard');
    if (existsSync(linuxPath)) {
      rmSync(linuxPath, { force: true });
      summary.push({ component: 'Dashboard app', status: 'removed', detail: linuxPath });
      ui.success(`Removed ${linuxPath}`);
      return;
    }

    summary.push({ component: 'Dashboard app', status: 'not found' });
    ui.info('Dashboard app not found');
  }

  private removeSkills(summary: CleanupSummary[]): void {
    const home = homedir();

    const claudeSkillDirs = [
      resolve(home, '.claude', 'skills', 'ai-knowledge-query'),
      resolve(home, '.claude', 'skills', 'ai-knowledge-capture'),
    ];

    for (const dir of claudeSkillDirs) {
      try {
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true, force: true });
          summary.push({ component: `Skill (${dir})`, status: 'removed' });
        } else {
          summary.push({ component: `Skill (${dir})`, status: 'not found' });
        }
      } catch (err) {
        summary.push({ component: `Skill (${dir})`, status: 'error', detail: String(err) });
      }
    }

    const copilotSkillFiles = [
      resolve(home, '.copilot', 'skills', 'ai-knowledge-query.md'),
      resolve(home, '.copilot', 'skills', 'ai-knowledge-capture.md'),
    ];

    for (const file of copilotSkillFiles) {
      try {
        if (existsSync(file)) {
          unlinkSync(file);
          summary.push({ component: `Skill (${file})`, status: 'removed' });
        } else {
          summary.push({ component: `Skill (${file})`, status: 'not found' });
        }
      } catch (err) {
        summary.push({ component: `Skill (${file})`, status: 'error', detail: String(err) });
      }
    }

    const copilotSkillsDir = resolve(home, '.copilot', 'skills');
    this.removeIfEmptyDir(copilotSkillsDir);

    ui.success('Knowledge skills removed');
  }

  private removeInstallDir(summary: CleanupSummary[]): void {
    if (this.keepData) {
      const dbPath = resolve(this.installDir, 'knowledge.db');
      if (existsSync(this.installDir)) {
        const files = readdirSync(this.installDir);
        for (const file of files) {
          const filePath = resolve(this.installDir, file);
          if (filePath !== dbPath) {
            rmSync(filePath, { recursive: true, force: true });
          }
        }
        summary.push({ component: `Install dir (${this.installDir})`, status: 'removed', detail: 'database preserved' });
        ui.success(`Removed ${this.installDir} (database preserved)`);
      } else {
        summary.push({ component: `Install dir (${this.installDir})`, status: 'not found' });
        ui.info('Install directory not found');
      }
      return;
    }

    try {
      if (existsSync(this.installDir)) {
        rmSync(this.installDir, { recursive: true, force: true });
        summary.push({ component: `Install dir (${this.installDir})`, status: 'removed' });
        ui.success(`Removed ${this.installDir}`);
      } else {
        summary.push({ component: `Install dir (${this.installDir})`, status: 'not found' });
        ui.info('Install directory not found');
      }
    } catch (err) {
      summary.push({ component: `Install dir (${this.installDir})`, status: 'error', detail: String(err) });
      ui.warn(`Could not remove install directory: ${err}`);
    }
  }

  private removeOllamaModel(summary: CleanupSummary[]): void {
    const model = process.env.OLLAMA_MODEL || 'all-minilm';
    try {
      execSync(`ollama rm ${model}`, { stdio: 'pipe', timeout: 30000 });
      summary.push({ component: `Ollama model (${model})`, status: 'removed' });
      ui.success(`Removed model '${model}'`);
    } catch {
      summary.push({ component: `Ollama model (${model})`, status: 'not found' });
      ui.info(`Model '${model}' not found or Ollama not running`);
    }
  }

  private hasBrew(): boolean {
    try {
      execSync('brew --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  private isBrewInstalled(pkg: string): boolean {
    try {
      execSync(`brew list ${pkg}`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  private async uninstallOllama(summary: CleanupSummary[]): Promise<void> {
    const platform = process.platform;

    try {
      // Stop ollama process on any platform
      try { execSync('pkill -f "ollama serve"', { stdio: 'pipe' }); } catch { /* may not be running */ }

      if (platform === 'darwin') {
        // macOS: try brew first, then manual removal
        if (this.hasBrew() && this.isBrewInstalled('ollama')) {
          execSync('brew uninstall ollama', { stdio: 'pipe', timeout: 60000 });
          // Also remove data dir
          const ollamaData = resolve(homedir(), '.ollama');
          if (existsSync(ollamaData)) rmSync(ollamaData, { recursive: true, force: true });
          summary.push({ component: 'Ollama (brew)', status: 'removed' });
          ui.success('Ollama uninstalled via Homebrew');
          return;
        }

        // Manual macOS removal (installed via curl)
        const macPaths = [
          '/usr/local/bin/ollama',
          '/opt/homebrew/bin/ollama',
          resolve(homedir(), '.ollama'),
        ];
        let removed = false;
        for (const p of macPaths) {
          if (existsSync(p)) {
            rmSync(p, { recursive: true, force: true });
            removed = true;
          }
        }

        if (removed) {
          summary.push({ component: 'Ollama (manual)', status: 'removed' });
          ui.success('Ollama removed');
        } else {
          summary.push({ component: 'Ollama', status: 'not found' });
          ui.info('Ollama not found on system');
        }
      } else if (platform === 'linux') {
        // Linux: stop systemd service, remove binary + data
        try { execSync('sudo systemctl stop ollama', { stdio: 'pipe', timeout: 10000 }); } catch { /* ignore */ }
        try { execSync('sudo systemctl disable ollama', { stdio: 'pipe', timeout: 10000 }); } catch { /* ignore */ }
        try { rmSync('/etc/systemd/system/ollama.service', { force: true }); } catch { /* ignore */ }

        const linuxPaths = ['/usr/local/bin/ollama', '/usr/bin/ollama', resolve(homedir(), '.ollama')];
        let removed = false;
        for (const p of linuxPaths) {
          try {
            if (existsSync(p)) {
              rmSync(p, { recursive: true, force: true });
              removed = true;
            }
          } catch {
            // May need sudo — skip
          }
        }

        if (removed) {
          summary.push({ component: 'Ollama', status: 'removed' });
          ui.success('Ollama removed');
        } else {
          summary.push({ component: 'Ollama', status: 'not found' });
          ui.info('Ollama not found on system');
        }
      } else {
        // Windows or other
        summary.push({ component: 'Ollama', status: 'skipped', detail: 'Please uninstall manually via system settings' });
        ui.warn('Please uninstall Ollama manually via your system settings or control panel');
      }
    } catch (err) {
      summary.push({ component: 'Ollama', status: 'error', detail: String(err) });
      ui.warn(`Could not uninstall Ollama: ${err}`);
    }
  }

  private cleanBackupFiles(summary: CleanupSummary[]): void {
    const backupTargets = [
      { dir: resolve(homedir(), '.claude'), prefix: 'CLAUDE.md.bak.' },
      { dir: resolve(homedir(), '.claude'), prefix: 'mcp-config.json.bak.' },
      { dir: homedir(), prefix: '.claude.json.bak.' },
      { dir: resolve(homedir(), '.github'), prefix: 'copilot-instructions.md.bak.' },
      { dir: resolve(homedir(), '.copilot'), prefix: 'copilot-instructions.md.bak.' },
      { dir: resolve(homedir(), '.copilot'), prefix: 'mcp-config.json.bak.' },
    ];

    let totalCleaned = 0;

    for (const target of backupTargets) {
      try {
        if (!existsSync(target.dir)) continue;
        const files = readdirSync(target.dir);
        for (const file of files) {
          if (file.startsWith(target.prefix)) {
            unlinkSync(resolve(target.dir, file));
            totalCleaned++;
          }
        }
      } catch {
        // skip
      }
    }

    if (totalCleaned > 0) {
      summary.push({ component: 'Backup files', status: 'removed', detail: `${totalCleaned} file(s)` });
      ui.success(`Cleaned ${totalCleaned} backup file(s)`);
    } else {
      summary.push({ component: 'Backup files', status: 'not found' });
      ui.info('No backup files found');
    }
  }

  private removeIfEmptyDir(dirPath: string): void {
    try {
      if (existsSync(dirPath) && readdirSync(dirPath).length === 0) {
        rmdirSync(dirPath);
      }
    } catch {
      // Not critical
    }
  }

  private printSummary(summary: CleanupSummary[]): void {
    console.log('');
    ui.info('═══ Uninstall Summary ═══');
    console.log('');
    for (const item of summary) {
      const icon = item.status === 'removed' ? '✅' : item.status === 'not found' ? '⬜' : item.status === 'skipped' ? '⏭️' : '❌';
      const detail = item.detail ? ` (${item.detail})` : '';
      console.log(`  ${icon} ${item.component}: ${item.status}${detail}`);
    }
    console.log('');
    ui.success('Uninstall complete.');
  }
}
