import * as fs from 'fs';
import xcode from 'xcode';

export interface PatchXcodeOptions {
  pbxprojPath: string;
  targetName: string;
  bundleId: string;
  iosDir: string;
  dryRun: boolean;
}

/**
 * Adds an NSE target to the .pbxproj file via the xcode library.
 * Idempotent: if a target with the given name already exists, returns false.
 */
export function patchXcodeProject(opts: PatchXcodeOptions): boolean {
  const proj = xcode.project(opts.pbxprojPath);
  proj.parseSync();

  // Idempotency: check if target already exists
  if (targetExists(proj, opts.targetName)) {
    return false;
  }

  // 1. Add the extension target
  const target = proj.addTarget(opts.targetName, 'app_extension', opts.targetName);

  if (!target || !target.uuid) {
    throw new Error(`xcode library failed to create target '${opts.targetName}'`);
  }

  // 2. Add build phases
  proj.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
  proj.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
  proj.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);

  // 3. Create PBX group for the NSE target files, then register the source file
  const group = proj.addPbxGroup([], opts.targetName, opts.targetName);
  proj.addSourceFile(
    `${opts.targetName}/NotificationService.swift`,
    {
      target: target.uuid,
    },
    group.uuid,
  );

  // 4. Set build settings for all configurations
  setBuildSettings(proj, opts.targetName, opts.bundleId);

  // 5. Write — writeSync() returns content as string, must write manually
  if (!opts.dryRun) {
    fs.writeFileSync(opts.pbxprojPath, proj.writeSync());
  }

  return true;
}

function targetExists(proj: ReturnType<typeof xcode.project>, name: string): boolean {
  const targets = proj.pbxNativeTargetSection();
  for (const [, value] of Object.entries(targets)) {
    if (typeof value !== 'object') continue;
    const target = value as Record<string, unknown>;
    const targetName = String(target.name ?? '').replace(/"/g, '');
    if (targetName === name) {
      return true;
    }
  }
  return false;
}

function setBuildSettings(
  proj: ReturnType<typeof xcode.project>,
  targetName: string,
  bundleId: string,
): void {
  const configs = proj.pbxXCBuildConfigurationSection();

  for (const [, value] of Object.entries(configs)) {
    if (typeof value !== 'object') continue;
    const config = value as Record<string, unknown>;
    const settings = config.buildSettings as Record<string, string> | undefined;

    if (!settings) continue;
    if (settings.PRODUCT_NAME !== `"${targetName}"`) continue;

    settings.INFOPLIST_FILE = `"${targetName}/Info.plist"`;
    settings.PRODUCT_BUNDLE_IDENTIFIER = `"${bundleId}"`;
    settings.TARGETED_DEVICE_FAMILY = `"1,2"`;
    settings.IPHONEOS_DEPLOYMENT_TARGET = '15.1';
    settings.SWIFT_VERSION = '5.0';
    settings.CODE_SIGN_ENTITLEMENTS = `"${targetName}/${targetName}.entitlements"`;
    settings.GENERATE_INFOPLIST_FILE = 'NO';
  }
}
