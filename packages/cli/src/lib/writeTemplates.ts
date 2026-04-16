import * as fs from 'fs';
import * as path from 'path';

// Templates live at dist/templates/ in dev (relative to dist/lib/writeTemplates.js)
// and at cli/dist/templates/ in the bundled prepack (relative to cli/dist/cli.bundle.js).
// The fallback path handles the bundled context where __dirname is the bundle's dir.
const TEMPLATES_DIR = fs.existsSync(path.join(__dirname, 'templates'))
  ? path.join(__dirname, 'templates')
  : path.join(__dirname, '..', 'templates');

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
      template: 'NotificationService.swift.tmpl',
      output: 'NotificationService.swift',
    },
    {
      template: 'Info.plist.tmpl',
      output: 'Info.plist',
    },
    {
      template: 'NotifyKitNSE.entitlements.tmpl',
      output: `${opts.targetName}.entitlements`,
    },
  ];

  const written: string[] = [];
  for (const { template, output } of files) {
    const templatePath = path.join(TEMPLATES_DIR, template);
    let content = fs.readFileSync(templatePath, 'utf-8');
    content = content.replace(/\{\{TARGET_NAME\}\}/g, opts.targetName);
    content = content.replace(/\{\{BUNDLE_ID\}\}/g, opts.bundleId);

    const outputPath = path.join(targetDir, output);
    fs.writeFileSync(outputPath, content, 'utf-8');
    written.push(outputPath);
  }

  return written;
}
