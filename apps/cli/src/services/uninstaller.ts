import { execSync } from 'node:child_process';
import { resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, rmSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import * as ui from '../ui/index.js';
import { ConfigManager } from './config-manager.js';

export interface UninstallerOptions {
  projectRoot?: string;
  installDir?: string;
  force?: boolean;
  keepData?: boolean;
}

interface CleanupSummary {
  component: string;
  status: 'removed' | 'not found' | 'skipped' | 'error';
  detail?: string;
}

const DOCKER_IMAGES = [
  'pgvector/pgvector:pg17',
  'ollama/ollama:latest',
  'traefik:v3.3',
  'ghcr.io/sithion/kb-dashboard:latest',
];

export class Uninstaller {
  private projectRoot: string | undefined;
  private installDir: string;
  private configManager: ConfigManager;
  private force: boolean;
  private keepData: boolean;

  constructor(options: UninstallerOptions) {
    this.projectRoot = options.projectRoot;
    this.installDir = options.installDir ?? resolve(homedir(), '.ai-knowledge');
    this.configManager = new ConfigManager();
    this.force = options.force ?? false;
    this.keepData = options.keepData ?? false;
  }

  async run(): Promise<void> {
    ui.showUninstallBanner();
    const summary: CleanupSummary[] = [];
    let removeImages = true;

    // Confirmation
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
          'Also remove Docker volumes (database data will be lost)?',
          false
        );
        this.keepData = !removeData;
      }

      removeImages = await ui.confirmAction(
        'Also remove Docker images (pgvector, ollama)? They are large and will need to be re-downloaded on next install.',
        true
      );

      const cleanOld = await ui.confirmAction(
        "Also clean up old 'knowledge' MCP server entries (from ai-config)?",
        true
      );

      if (cleanOld) {
        await this.cleanOldKnowledge(summary);
      }
    }

    const TOTAL_STEPS = 11;
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

    // Step 8: Stop Docker containers and remove volumes/network
    step++;
    ui.step(step, TOTAL_STEPS, 'Stopping Docker containers...');
    try {
      this.stopDockerContainers(summary);
    } catch (err) {
      summary.push({ component: 'Docker containers', status: 'error', detail: String(err) });
      ui.warn(`Could not stop containers: ${err}`);
    }

    // Step 9: Remove Docker images
    step++;
    ui.step(step, TOTAL_STEPS, 'Removing Docker images...');
    if (removeImages) {
      this.removeDockerImages(summary);
    } else {
      summary.push({ component: 'Docker images', status: 'skipped', detail: 'User chose to keep' });
      ui.info('Docker images kept');
    }

    // Step 10: Remove install directory (~/.ai-knowledge/)
    step++;
    ui.step(step, TOTAL_STEPS, 'Removing install directory...');
    this.removeInstallDir(summary);

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

  private removeSkills(summary: CleanupSummary[]): void {
    const home = homedir();

    // Claude Code skills: directories with SKILL.md inside
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

    // Copilot skills: individual .md files
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

    // Clean up empty skill directories
    const copilotSkillsDir = resolve(home, '.copilot', 'skills');
    this.removeIfEmptyDir(copilotSkillsDir);

    ui.success('Knowledge skills removed');
  }

  private stopDockerContainers(summary: CleanupSummary[]): void {
    const composeCmd = this.getComposeCommand();
    const downCmd = this.keepData ? 'down --remove-orphans' : 'down -v --remove-orphans';

    // Use the installed compose file (same one used to start containers)
    const installedCompose = resolve(this.installDir, 'docker-compose.yml');
    // Fall back to repo compose if installed one doesn't exist and we're in the repo
    const repoCompose = this.projectRoot
      ? resolve(this.projectRoot, 'docker', 'docker-compose.yml')
      : undefined;
    const composePath = existsSync(installedCompose)
      ? installedCompose
      : (repoCompose && existsSync(repoCompose) ? repoCompose : undefined);

    if (!composePath) {
      // No compose file found — try to stop containers directly by name
      ui.warn('No docker-compose.yml found, stopping containers by name...');
      for (const name of ['kb-traefik', 'kb-dashboard', 'kb-ollama', 'kb-postgres']) {
        try {
          execSync(`docker rm -f ${name}`, { stdio: 'pipe', timeout: 30000 });
        } catch {
          // Container may not exist
        }
      }
      if (!this.keepData) {
        for (const vol of ['kb_pgdata', 'kb_ollama']) {
          try {
            execSync(`docker volume rm ${vol}`, { stdio: 'pipe', timeout: 30000 });
          } catch {
            // Volume may not exist
          }
        }
        try {
          execSync('docker network rm kb-network', { stdio: 'pipe', timeout: 30000 });
        } catch {
          // Network may not exist
        }
      }
      summary.push({ component: 'Docker containers', status: 'removed', detail: 'stopped by name (no compose file)' });
      ui.success('Docker containers stopped');
      return;
    }

    this.exec(`${composeCmd} -f "${composePath}" --profile dashboard ${downCmd}`);

    const label = this.keepData ? 'stopped (data preserved)' : 'stopped and volumes removed';
    summary.push({ component: 'Docker containers', status: 'removed', detail: label });
    ui.success(`Docker containers ${label}`);
  }

  private removeDockerImages(summary: CleanupSummary[]): void {
    // Remove known images
    for (const image of DOCKER_IMAGES) {
      try {
        execSync(`docker rmi ${image}`, { stdio: 'pipe', timeout: 60000 });
        summary.push({ component: `Docker image (${image})`, status: 'removed' });
      } catch {
        summary.push({ component: `Docker image (${image})`, status: 'not found' });
      }
    }

    // Remove dashboard image (locally built, name derived from compose project)
    // The project name comes from the directory: .ai-knowledge -> ai-knowledge
    const dashboardImageNames = [
      'ai-knowledge-dashboard',
      'docker-dashboard', // fallback if started from repo's docker/ dir
    ];
    for (const name of dashboardImageNames) {
      try {
        execSync(`docker rmi ${name}`, { stdio: 'pipe', timeout: 60000 });
        summary.push({ component: `Docker image (${name})`, status: 'removed' });
      } catch {
        // Image doesn't exist with this name — that's fine
      }
    }

    ui.success('Docker images removed');
  }

  private removeInstallDir(summary: CleanupSummary[]): void {
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

  private cleanBackupFiles(summary: CleanupSummary[]): void {
    // Directories and file prefixes where .bak.* files may have been created
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
        // Directory might not be readable — skip
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

  private getComposeCommand(): string {
    try {
      execSync('docker compose version', { stdio: 'pipe' });
      return 'docker compose';
    } catch {
      try {
        execSync('docker-compose version', { stdio: 'pipe' });
        return 'docker-compose';
      } catch {
        return 'docker compose';
      }
    }
  }

  private exec(cmd: string): void {
    execSync(cmd, { encoding: 'utf-8', stdio: 'inherit', timeout: 120000 });
  }
}
