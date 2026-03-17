import chalk from 'chalk';
import boxen from 'boxen';

export function showWelcomeBanner(): void {
  const banner = boxen(
    chalk.bold.cyan('🧠 AI Knowledge Base') + '\n' +
    chalk.dim('Interactive Installation Wizard'),
    {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
    }
  );
  console.log(banner);
}

export function showSuccessBanner(urls: { dashboard: string; postgres: string; ollama: string }): void {
  const content = [
    chalk.bold.green('✅ AI Knowledge Base — Ready!'),
    '',
    `  Dashboard:   ${chalk.blue(urls.dashboard)}`,
    `  PostgreSQL:  ${chalk.blue(urls.postgres)}`,
    `  Ollama:      ${chalk.blue(urls.ollama)}`,
    '',
    chalk.dim('Run "kb health" to check service status'),
  ].join('\n');

  const banner = boxen(content, {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    borderColor: 'green',
  });
  console.log(banner);
}

export function showUninstallBanner(): void {
  const banner = boxen(
    chalk.bold.yellow('⚠️  AI Knowledge Base') + '\n' +
    chalk.dim('Uninstall Wizard'),
    {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'yellow',
    }
  );
  console.log(banner);
}
