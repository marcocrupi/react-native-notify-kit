import * as crypto from 'crypto';
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

  // Fix xcode@3.x bug: addTarget creates a .appex file reference with
  // `fileEncoding = undefined` and `lastKnownFileType = undefined` (literal
  // JS undefined serialized as strings). CocoaPods' xcodeproj gem rejects
  // these. Remove the broken fields from the product file reference.
  fixProductFileReference(proj, opts.targetName);

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

  // 4. Add target dependency from host → extension.
  // xcode@3.x's addTargetDependency is broken (doesn't serialize), so we
  // manually inject PBXContainerItemProxy + PBXTargetDependency entries.
  // CocoaPods requires this to detect the host→extension relationship.
  // NOTE: we do NOT add an "Embed App Extensions" build phase here —
  // the xcode library creates inconsistent file references that cause
  // CocoaPods' post_install to crash. Instead, Xcode auto-creates the
  // embed phase when the user opens the project and sees the dependency.
  const hostUuid = findHostTarget(proj);
  if (hostUuid) {
    addTargetDependencyManual(proj, hostUuid, target.uuid, opts.targetName);
  }

  // 5. Set build settings for all configurations
  setBuildSettings(proj, opts.targetName, opts.bundleId);

  // 6. Write — writeSync() returns content as string, must write manually
  if (!opts.dryRun) {
    fs.writeFileSync(opts.pbxprojPath, proj.writeSync());
  }

  return true;
}

function findHostTarget(proj: ReturnType<typeof xcode.project>): string | null {
  const targets = proj.pbxNativeTargetSection();
  for (const [key, value] of Object.entries(targets)) {
    if (typeof value !== 'object' || key.endsWith('_comment')) continue;
    const target = value as Record<string, unknown>;
    const productType = String(target.productType ?? '');
    if (productType.includes('application')) {
      return key;
    }
  }
  return null;
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

function fixProductFileReference(proj: ReturnType<typeof xcode.project>, targetName: string): void {
  const fileRefs = (proj as any).hash.project.objects.PBXFileReference;
  if (!fileRefs) return;
  for (const [, value] of Object.entries(fileRefs)) {
    if (typeof value !== 'object') continue;
    const ref = value as Record<string, unknown>;
    if (String(ref.name ?? '').replace(/"/g, '') === `${targetName}.appex`) {
      // Remove broken fields that xcode@3.x sets to literal 'undefined'
      delete ref.fileEncoding;
      delete ref.lastKnownFileType;
    }
  }
}

function genUuid(): string {
  return crypto.randomBytes(12).toString('hex').toUpperCase().slice(0, 24);
}

/**
 * Manually adds PBXTargetDependency + PBXContainerItemProxy to the project
 * hash. The xcode@3.x library's addTargetDependency() exists but doesn't
 * serialize to the output — so we inject directly into the internal hash.
 * CocoaPods requires these entries to detect the host→extension relationship.
 */
function addTargetDependencyManual(
  proj: ReturnType<typeof xcode.project>,
  hostUuid: string,
  extensionUuid: string,
  extensionName: string,
): void {
  const proxyUuid = genUuid();
  const depUuid = genUuid();

  const objects = (proj as any).hash.project.objects;

  const rootObject = (proj as any).hash.project.rootObject as string;

  if (!objects.PBXContainerItemProxy) objects.PBXContainerItemProxy = {};
  objects.PBXContainerItemProxy[proxyUuid] = {
    isa: 'PBXContainerItemProxy',
    containerPortal: rootObject,
    proxyType: 1,
    remoteGlobalIDString: extensionUuid,
    remoteInfo: `"${extensionName}"`,
  };
  objects.PBXContainerItemProxy[proxyUuid + '_comment'] = 'PBXContainerItemProxy';

  if (!objects.PBXTargetDependency) objects.PBXTargetDependency = {};
  objects.PBXTargetDependency[depUuid] = {
    isa: 'PBXTargetDependency',
    target: extensionUuid,
    targetProxy: proxyUuid,
  };
  objects.PBXTargetDependency[depUuid + '_comment'] = 'PBXTargetDependency';

  const hostTarget = objects.PBXNativeTarget[hostUuid];
  if (hostTarget && Array.isArray(hostTarget.dependencies)) {
    hostTarget.dependencies.push({ value: depUuid, comment: 'PBXTargetDependency' });
  }
}
