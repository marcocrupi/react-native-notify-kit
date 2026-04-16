import * as fs from 'fs';
import * as path from 'path';
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
    process.exitCode = 1;
    return;
  }

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

  // 3. Check existing NSE
  const targetDir = path.join(projectInfo.iosDir, targetName);
  if (fs.existsSync(targetDir) && !force) {
    logger.error(
      `NSE target '${targetName}' appears to exist at ${targetDir}.\n` +
        '  Use --force to overwrite or --target-name to use a different name.',
    );
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    logger.info('[DRY RUN] Would create the following files:');
    logger.info(`  ${path.join(targetDir, 'NotificationService.swift')}`);
    logger.info(`  ${path.join(targetDir, 'Info.plist')}`);
    logger.info(`  ${path.join(targetDir, `${targetName}.entitlements`)}`);
    logger.info('[DRY RUN] Would patch Podfile');
    logger.info('[DRY RUN] Would patch .pbxproj');
    return;
  }

  // 4. Create backups
  const podfilePath = path.join(projectInfo.iosDir, 'Podfile');
  const backups: Array<{ original: string; backup: string }> = [];

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
    // Restore from backups on failure
    logger.error(`Failed during NSE scaffolding: ${e instanceof Error ? e.message : String(e)}`);
    for (const { original, backup } of backups) {
      if (fs.existsSync(backup)) {
        fs.copyFileSync(backup, original);
        fs.unlinkSync(backup);
        logger.warn(`Restored ${original} from backup`);
      }
    }
    process.exitCode = 2;
  }
}
