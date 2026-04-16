#!/usr/bin/env node

import { Command } from 'commander';
import { initNse } from './commands/initNse';
import * as logger from './lib/logger';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('react-native-notify-kit')
  .description('CLI tools for react-native-notify-kit')
  .version(pkg.version);

program
  .command('init-nse')
  .description('Scaffold an iOS Notification Service Extension')
  .option('--ios-path <path>', 'Path to iOS project directory')
  .option('--target-name <name>', 'NSE target name', 'NotifyKitNSE')
  .option('--bundle-suffix <str>', 'Bundle ID suffix', '.NotifyKitNSE')
  .option('-f, --force', 'Overwrite existing NSE files')
  .option('-n, --dry-run', 'Print actions without writing')
  .action(async (cmdOpts: Record<string, unknown>) => {
    await initNse({
      iosPath: cmdOpts.iosPath as string | undefined,
      targetName: (cmdOpts.targetName as string) ?? 'NotifyKitNSE',
      bundleSuffix: (cmdOpts.bundleSuffix as string) ?? '.NotifyKitNSE',
      force: Boolean(cmdOpts.force),
      dryRun: Boolean(cmdOpts.dryRun),
    });
  });

(async () => {
  await program.parseAsync();
})().catch((err: Error) => {
  logger.error(err.message ?? String(err));
  process.exit(2);
});
