import chalk from 'chalk';

export function info(msg: string): void {
  console.log(chalk.blue('[INFO]'), msg);
}

export function success(msg: string): void {
  console.log(chalk.green('[OK]'), msg);
}

export function warn(msg: string): void {
  console.log(chalk.yellow('[WARN]'), msg);
}

export function error(msg: string): void {
  console.error(chalk.red('[ERROR]'), msg);
}

export function step(current: number, total: number, msg: string): void {
  console.log(chalk.cyan(`[${current}/${total}]`), msg);
}
