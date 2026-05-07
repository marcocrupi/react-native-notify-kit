import * as fs from 'fs';
import * as path from 'path';
import {
  renderNotificationServiceSwift,
  renderNseEntitlementsPlist,
  renderNseInfoPlist,
} from './initNseCore';

export interface WriteTemplatesOptions {
  iosDir: string;
  targetName: string;
  bundleId: string;
  force: boolean;
}

/**
 * Writes the NSE template files (Swift, Info.plist, entitlements) to the
 * target directory under the iOS project.
 */
export function writeTemplates(opts: WriteTemplatesOptions): string[] {
  const targetDir = path.join(opts.iosDir, opts.targetName);

  if (fs.existsSync(targetDir) && !opts.force) {
    throw new Error(
      `NSE target '${opts.targetName}' appears to exist at ${targetDir}.\n` +
        '  Use --force to overwrite or --target-name to use a different name.',
    );
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const files = [
    {
      output: 'NotificationService.swift',
      content: renderNotificationServiceSwift(),
    },
    {
      output: 'Info.plist',
      content: renderNseInfoPlist({ targetName: opts.targetName }),
    },
    {
      output: `${opts.targetName}.entitlements`,
      content: renderNseEntitlementsPlist(),
    },
  ];

  const written: string[] = [];
  for (const { output, content } of files) {
    const outputPath = path.join(targetDir, output);
    fs.writeFileSync(outputPath, content, 'utf-8');
    written.push(outputPath);
  }

  return written;
}
