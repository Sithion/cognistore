import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  unlink,
  access,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const MARKER_BEGIN = '<!-- AI-KNOWLEDGE:BEGIN -->';
const MARKER_END = '<!-- AI-KNOWLEDGE:END -->';

export interface InjectResult {
  action: 'created' | 'appended' | 'updated';
  path: string;
}

export interface RemoveResult {
  removed: boolean;
  hadMarkers: boolean;
  path: string;
}

export interface McpSetupResult {
  action: 'created' | 'updated' | 'skipped';
  path: string;
}

export interface McpRemoveResult {
  removed: boolean;
  path: string;
}

export class ConfigManager {
  // Well-known paths
  static readonly CLAUDE_MD = join(homedir(), '.claude', 'CLAUDE.md');
  static readonly COPILOT_MD = join(
    homedir(),
    '.github',
    'copilot-instructions.md'
  );
  static readonly MCP_CONFIG = join(homedir(), '.claude', 'mcp-config.json');
  static readonly CLAUDE_JSON = join(homedir(), '.claude.json');
  static readonly COPILOT_MCP_CONFIG = join(
    homedir(),
    '.copilot',
    'mcp-config.json'
  );
  static readonly COPILOT_INSTRUCTIONS = join(
    homedir(),
    '.copilot',
    'copilot-instructions.md'
  );

  /**
   * Inject template content into a target file using markers.
   * - If target doesn't exist: create with template content
   * - If target exists but no markers: backup and append template
   * - If target exists with markers: replace content between markers
   */
  async injectConfig(
    targetPath: string,
    templatePath: string,
    label: string
  ): Promise<InjectResult> {
    await mkdir(dirname(targetPath), { recursive: true });

    const template = await readFile(templatePath, 'utf-8');

    if (!(await this.fileExists(targetPath))) {
      await writeFile(targetPath, template, 'utf-8');
      return { action: 'created', path: targetPath };
    }

    const content = await readFile(targetPath, 'utf-8');

    if (!content.includes(MARKER_BEGIN)) {
      // Backup and append
      await copyFile(
        targetPath,
        `${targetPath}.bak.${Date.now()}`
      );
      await writeFile(targetPath, content + '\n' + template, 'utf-8');
      return { action: 'appended', path: targetPath };
    }

    // Replace between markers
    await copyFile(
      targetPath,
      `${targetPath}.bak.${Date.now()}`
    );
    const beginIdx = content.indexOf(MARKER_BEGIN);
    const endIdx = content.indexOf(MARKER_END);
    if (beginIdx === -1 || endIdx === -1) {
      // Fallback: append
      await writeFile(targetPath, content + '\n' + template, 'utf-8');
      return { action: 'appended', path: targetPath };
    }
    const newContent =
      content.substring(0, beginIdx) +
      template +
      content.substring(endIdx + MARKER_END.length);
    await writeFile(targetPath, newContent, 'utf-8');
    return { action: 'updated', path: targetPath };
  }

  /**
   * Remove content between AI-KNOWLEDGE markers from a file.
   * If the file only contains the marked section (plus whitespace), delete the file.
   */
  async removeConfig(targetPath: string): Promise<RemoveResult> {
    if (!(await this.fileExists(targetPath))) {
      return { removed: false, hadMarkers: false, path: targetPath };
    }

    const content = await readFile(targetPath, 'utf-8');

    if (!content.includes(MARKER_BEGIN)) {
      return { removed: false, hadMarkers: false, path: targetPath };
    }

    await copyFile(
      targetPath,
      `${targetPath}.bak.${Date.now()}`
    );

    const beginIdx = content.indexOf(MARKER_BEGIN);
    const endIdx = content.indexOf(MARKER_END);

    if (beginIdx === -1 || endIdx === -1) {
      return { removed: false, hadMarkers: false, path: targetPath };
    }

    const before = content.substring(0, beginIdx);
    const after = content.substring(endIdx + MARKER_END.length);
    const remaining = (before + after).trim();

    if (remaining.length === 0) {
      await unlink(targetPath);
      return { removed: true, hadMarkers: true, path: targetPath };
    }

    await writeFile(targetPath, remaining + '\n', 'utf-8');
    return { removed: true, hadMarkers: true, path: targetPath };
  }

  /**
   * Add or update the ai-knowledge MCP server entry in an MCP JSON config file.
   */
  async setupMcpConfig(
    configPath: string,
    mcpEntry: Record<string, unknown>
  ): Promise<McpSetupResult> {
    await mkdir(dirname(configPath), { recursive: true });

    if (!(await this.fileExists(configPath))) {
      const config = { mcpServers: { 'ai-knowledge': mcpEntry } };
      await writeFile(
        configPath,
        JSON.stringify(config, null, 2) + '\n',
        'utf-8'
      );
      return { action: 'created', path: configPath };
    }

    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    if (config.mcpServers?.['ai-knowledge']) {
      // Check if already identical
      if (
        JSON.stringify(config.mcpServers['ai-knowledge']) ===
        JSON.stringify(mcpEntry)
      ) {
        return { action: 'skipped', path: configPath };
      }
    }

    await copyFile(
      configPath,
      `${configPath}.bak.${Date.now()}`
    );

    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    config.mcpServers['ai-knowledge'] = mcpEntry;
    await writeFile(
      configPath,
      JSON.stringify(config, null, 2) + '\n',
      'utf-8'
    );
    return { action: 'updated', path: configPath };
  }

  /**
   * Remove a named MCP server entry from a JSON config file.
   */
  async removeMcpEntry(
    configPath: string,
    entryName: string
  ): Promise<McpRemoveResult> {
    if (!(await this.fileExists(configPath))) {
      return { removed: false, path: configPath };
    }

    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    if (!config.mcpServers?.[entryName]) {
      return { removed: false, path: configPath };
    }

    await copyFile(
      configPath,
      `${configPath}.bak.${Date.now()}`
    );
    delete config.mcpServers[entryName];

    // If mcpServers is now empty and it's a standalone mcp-config file, remove the file
    if (
      Object.keys(config.mcpServers).length === 0 &&
      Object.keys(config).length === 1
    ) {
      await unlink(configPath);
    } else {
      await writeFile(
        configPath,
        JSON.stringify(config, null, 2) + '\n',
        'utf-8'
      );
    }

    return { removed: true, path: configPath };
  }

  /**
   * Find and remove old 'knowledge' (not 'ai-knowledge') MCP entries from known config files.
   */
  async removeOldKnowledgeMcp(): Promise<{ cleaned: string[] }> {
    const cleaned: string[] = [];
    const targets = [ConfigManager.MCP_CONFIG, ConfigManager.CLAUDE_JSON];

    for (const configPath of targets) {
      try {
        const result = await this.removeMcpEntry(configPath, 'knowledge');
        if (result.removed) {
          cleaned.push(configPath);
        }
      } catch {
        // File doesn't exist or isn't valid JSON - skip
      }
    }

    return { cleaned };
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
