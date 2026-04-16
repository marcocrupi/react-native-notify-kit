#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { initNse } from './commands/initNse';
import * as logger from './lib/logger';

// Resolve version from whichever package.json is reachable: the CLI's own
// (dev context) or the parent RN package's (prepack/published context).
function resolveVersion(): string {
  for (const rel of ['../package.json', '../../../package.json']) {
    try {
      const p = path.resolve(__dirname, rel);
      if (fs.existsSync(p)) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return (require(p) as { version: string }).version;
      }
    } catch {
      // continue
    }
  }
  return '0.0.0';
}

const program = new Command();

program
  .name('react-native-notify-kit')
  .description('CLI tools for react-native-notify-kit')
  .version(resolveVersion());

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
