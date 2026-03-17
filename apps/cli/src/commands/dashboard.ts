import { Command } from 'commander';
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { printSuccess, printError, printInfo } from '../utils/output.js';

function findTauriApp(): string | null {
  const platform = process.platform;

  if (platform === 'darwin') {
    const paths = [
      '/Applications/AI Knowledge Base.app',
      resolve(homedir(), 'Applications', 'AI Knowledge Base.app'),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  }

  // Linux: check common install paths
  if (platform === 'linux') {
    const paths = [
      '/usr/bin/ai-knowledge-dashboard',
      resolve(homedir(), '.local', 'bin', 'ai-knowledge-dashboard'),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  }

  return null;
}

export const dashboardCommand = new Command('dashboard')
  .description('Open the AI Knowledge Base dashboard')
  .option('--no-app', 'Skip Tauri app detection, use browser mode')
  .option('-p, --port <port>', 'Port for the dashboard server', '3210')
  .action(async (options) => {
    try {
      // Try to open Tauri app if installed
      if (options.app !== false) {
        const appPath = findTauriApp();
        if (appPath) {
          printSuccess(`Opening dashboard app: ${appPath}`);
          if (process.platform === 'darwin') {
            execSync(`open -a "${appPath}"`, { stdio: 'ignore' });
          } else {
            spawn(appPath, { detached: true, stdio: 'ignore' }).unref();
          }
          return;
        }
      }

      // Fallback: run Fastify server directly + open browser
      printInfo('Tauri app not found. Starting dashboard in browser mode...');

      const port = options.port || '3210';
      const sqlitePath = resolve(homedir(), '.ai-knowledge', 'knowledge.db');

      if (!existsSync(sqlitePath)) {
        printError('Database not found. Run `kb install` first.');
        process.exitCode = 1;
        return;
      }

      // Find the dashboard dist-server
      // When running from the repo, it's at apps/dashboard/dist-server/index.js
      // When running from npm, it would need to be bundled differently
      const serverPaths = [
        resolve(process.cwd(), 'apps', 'dashboard', 'dist-server', 'index.js'),
        resolve(homedir(), '.ai-knowledge', 'dashboard-server', 'index.js'),
      ];

      let serverPath: string | null = null;
      for (const p of serverPaths) {
        if (existsSync(p)) {
          serverPath = p;
          break;
        }
      }

      if (!serverPath) {
        printError('Dashboard server not found. Install the Tauri app or run from the repo.');
        process.exitCode = 1;
        return;
      }

      printInfo(`Starting dashboard on http://localhost:${port}`);

      const child = spawn('node', [serverPath], {
        env: {
          ...process.env,
          SQLITE_PATH: sqlitePath,
          OLLAMA_HOST: 'http://localhost:11434',
          DASHBOARD_PORT: port,
          NODE_ENV: 'production',
        },
        stdio: 'inherit',
      });

      // Open browser after a short delay
      setTimeout(() => {
        const url = `http://localhost:${port}`;
        try {
          if (process.platform === 'darwin') {
            execSync(`open "${url}"`, { stdio: 'ignore' });
          } else if (process.platform === 'linux') {
            execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
          }
        } catch {
          printInfo(`Open ${url} in your browser`);
        }
      }, 2000);

      // Handle shutdown
      const shutdown = () => {
        child.kill();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      await new Promise(() => {}); // Keep alive until killed
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });
