import * as fs from 'fs';
import * as path from 'path';
import xcode from 'xcode';
import { detectIosProject, deriveBundleId } from '../lib/detectProject';
import { writeTemplates } from '../lib/writeTemplates';
import { patchPodfile } from '../lib/patchPodfile';
import { patchXcodeProject } from '../lib/patchXcodeProject';
import * as logger from '../lib/logger';

export interface InitNseOptions {
  iosPath?: string;
  targetName: string;
  bundleSuffix: string;
  force: boolean;
  dryRun: boolean;
}

/**
 * Orchestrates the init-nse command: detect project → check existing →
 * backup → write templates → patch Podfile → patch .pbxproj → summary.
 */
export async function initNse(opts: InitNseOptions): Promise<void> {
  const {
    targetName = 'NotifyKitNSE',
    bundleSuffix = '.NotifyKitNSE',
    force = false,
    dryRun = false,
  } = opts;

  // 1. Detect project
  let projectInfo;
  try {
    projectInfo = detectIosProject(opts.iosPath);
  } catch (e: unknown) {
    logger.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const absIosDir = path.resolve(projectInfo.iosDir);
  logger.success(`Detected iOS project at ${projectInfo.xcodeProjectPath}`);

  // 2. Derive bundle ID
  const bundleId = deriveBundleId(projectInfo.parentBundleId, bundleSuffix);
  if (projectInfo.parentBundleId?.includes('$(')) {
    logger.warn(
      `Parent bundle ID uses a variable: ${projectInfo.parentBundleId}\n` +
        '  The NSE bundle ID will need to be set manually in Xcode.',
    );
  }
  logger.success(`Bundle ID: ${projectInfo.parentBundleId ?? '(variable)'} → ${bundleId}`);

  // 3. Check existing NSE — check BOTH filesystem AND pbxproj (Rule F3)
  const targetDir = path.join(projectInfo.iosDir, targetName);
  const dirExists = fs.existsSync(targetDir);
  const pbxprojHasTarget = checkPbxprojTarget(projectInfo.pbxprojPath, targetName);

  if ((dirExists || pbxprojHasTarget) && !force) {
    const where =
      dirExists && pbxprojHasTarget
        ? `directory ${targetDir} and .pbxproj`
        : dirExists
          ? `directory ${targetDir}`
          : '.pbxproj';
    logger.error(
      `NSE target '${targetName}' already exists in ${where}.\n` +
        '  Use --force to overwrite or --target-name to use a different name.',
    );
    process.exit(1);
  }

  if (dryRun) {
    logger.info('[DRY RUN] Would perform the following actions:');
    logger.info(`  iOS project: ${absIosDir}`);
    logger.info(`  Target name: ${targetName}`);
    logger.info(`  NSE bundle ID: ${bundleId}`);
    logger.info(`  Create: ${path.join(absIosDir, targetName, 'NotificationService.swift')}`);
    logger.info(`  Create: ${path.join(absIosDir, targetName, 'Info.plist')}`);
    logger.info(`  Create: ${path.join(absIosDir, targetName, `${targetName}.entitlements`)}`);
    logger.info(`  Patch: ${path.join(absIosDir, 'Podfile')}`);
    logger.info(`  Patch: ${projectInfo.pbxprojPath}`);
    return;
  }

  // 4. Create backups
  const podfilePath = path.join(projectInfo.iosDir, 'Podfile');
  const backups: Array<{ original: string; backup: string }> = [];
  const templateDirCreated = !dirExists; // Track if WE created the dir (for rollback)

  try {
    if (fs.existsSync(podfilePath)) {
      const podfileBackup = podfilePath + '.bak';
      fs.copyFileSync(podfilePath, podfileBackup);
      backups.push({ original: podfilePath, backup: podfileBackup });
    }

    const pbxprojBackup = projectInfo.pbxprojPath + '.bak';
    fs.copyFileSync(projectInfo.pbxprojPath, pbxprojBackup);
    backups.push({ original: projectInfo.pbxprojPath, backup: pbxprojBackup });

    // 5. Write templates
    const written = writeTemplates({
      iosDir: projectInfo.iosDir,
      targetName,
      bundleId,
      force,
    });
    for (const f of written) {
      logger.success(`Created ${f}`);
    }

    // 6. Patch Podfile
    if (fs.existsSync(podfilePath)) {
      const patched = patchPodfile(podfilePath, targetName, false);
      if (patched) {
        logger.success(`Updated ${podfilePath} (added ${targetName} target)`);
      } else {
        logger.info(`Podfile already contains ${targetName} target (skipped)`);
      }
    } else {
      logger.warn('No Podfile found — skipping Podfile patch');
    }

    // 7. Patch .pbxproj
    const xcodePatched = patchXcodeProject({
      pbxprojPath: projectInfo.pbxprojPath,
      targetName,
      bundleId,
      iosDir: projectInfo.iosDir,
      dryRun: false,
    });
    if (xcodePatched) {
      logger.success(
        `Updated ${projectInfo.xcodeProjectPath} (added ${targetName} target, signing inherited)`,
      );
    } else {
      logger.info(`.pbxproj already contains ${targetName} target (skipped)`);
    }

    // 8. Success — delete backups
    for (const { backup } of backups) {
      fs.unlinkSync(backup);
    }

    // 9. Print next steps
    console.log('');
    console.log('Next steps:');
    console.log('  1. cd ios && pod install');
    console.log('  2. Open the .xcworkspace in Xcode');
    console.log(`  3. Verify signing: Targets → ${targetName} → Signing & Capabilities`);
    console.log('  4. Build and run');
    console.log('');
    console.log('Docs: https://github.com/marcocrupi/react-native-notify-kit#nse-setup');
  } catch (e: unknown) {
    // Rollback: remove template dir first (C3), then restore backups
    if (templateDirCreated && fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      logger.warn(`Removed ${targetDir} (rollback)`);
    }
    for (const { original, backup } of backups) {
      if (fs.existsSync(backup)) {
        fs.copyFileSync(backup, original);
        fs.unlinkSync(backup);
        logger.warn(`Restored ${original} from backup`);
      }
    }
    logger.error(`Failed during NSE scaffolding: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}

function checkPbxprojTarget(pbxprojPath: string, targetName: string): boolean {
  try {
    const proj = xcode.project(pbxprojPath);
    proj.parseSync();
    const targets = proj.pbxNativeTargetSection();
    for (const [, value] of Object.entries(targets)) {
      if (typeof value !== 'object') continue;
      const name = String((value as Record<string, unknown>).name ?? '').replace(/"/g, '');
      if (name === targetName) return true;
    }
  } catch {
    // If we can't parse, let the later patchXcodeProject step handle the error
  }
  return false;
}
