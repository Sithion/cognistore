import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import * as ui from '../ui/index.js';
import { ConfigManager } from './config-manager.js';

export interface UninstallerOptions {
  projectRoot: string;
  force?: boolean;
  keepData?: boolean;
}

interface CleanupSummary {
  component: string;
  status: 'removed' | 'not found' | 'skipped' | 'error';
  detail?: string;
}

export class Uninstaller {
  private projectRoot: string;
  private composePath: string;
  private configManager: ConfigManager;
  private force: boolean;
  private keepData: boolean;

  constructor(options: UninstallerOptions) {
    this.projectRoot = options.projectRoot;
    this.composePath = resolve(this.projectRoot, 'docker', 'docker-compose.yml');
    this.configManager = new ConfigManager();
    this.force = options.force ?? false;
    this.keepData = options.keepData ?? false;
  }

  async run(): Promise<void> {
    ui.showUninstallBanner();
    const summary: CleanupSummary[] = [];

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

      const cleanOld = await ui.confirmAction(
        "Also clean up old 'knowledge' MCP server entries (from ai-config)?",
        true
      );

      if (cleanOld) {
        await this.cleanOldKnowledge(summary);
      }
    }

    const TOTAL_STEPS = 6;
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

    // Step 2: Remove Copilot agent config
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

    // Step 3: Remove MCP config from ~/.claude/mcp-config.json
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

    // Step 4: Remove MCP config from ~/.claude.json
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

    // Step 5: Stop Docker containers
    step++;
    ui.step(step, TOTAL_STEPS, 'Stopping Docker containers...');
    try {
      const downCmd = this.keepData ? 'down --remove-orphans' : 'down -v --remove-orphans';
      const composeCmd = this.getComposeCommand();
      this.exec(`${composeCmd} -f "${this.composePath}" --profile dashboard ${downCmd}`);

      const label = this.keepData ? 'stopped (data preserved)' : 'stopped and volumes removed';
      summary.push({ component: 'Docker containers', status: 'removed', detail: label });
      ui.success(`Docker containers ${label}`);
    } catch (err) {
      summary.push({ component: 'Docker containers', status: 'error', detail: String(err) });
      ui.warn(`Could not stop containers: ${err}`);
    }

    // Step 6: Clean Copilot MCP config if exists
    step++;
    ui.step(step, TOTAL_STEPS, 'Cleaning Copilot MCP config...');
    try {
      await this.cleanCopilotMcp(summary);
    } catch (err) {
      summary.push({ component: 'Copilot MCP config', status: 'error', detail: String(err) });
    }

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
    // Clean ~/.copilot/mcp-config.json if it has ai-knowledge
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
        return 'docker compose'; // fallback, will error at runtime
      }
    }
  }

  private exec(cmd: string): void {
    execSync(cmd, { encoding: 'utf-8', stdio: 'inherit', timeout: 120000 });
  }
}
