import chalk from 'chalk';

export const success = (msg: string): void => {
  console.log(chalk.green('✓') + ' ' + msg);
};

export const error = (msg: string): void => {
  console.error(chalk.red('✗') + ' ' + msg);
};

export const warn = (msg: string): void => {
  console.warn(chalk.yellow('⚠') + ' ' + msg);
};

export const info = (msg: string): void => {
  console.log(chalk.cyan('ℹ') + ' ' + msg);
};
