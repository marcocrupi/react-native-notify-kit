import * as crypto from 'crypto';

export interface XcodeProject {
  addTarget(
    name: string,
    type: string,
    subfolder: string,
  ): { uuid: string; pbxNativeTarget?: Record<string, unknown> } | null;
  addBuildPhase(
    files: string[],
    buildPhaseType: string,
    comment: string,
    target?: string,
    optionOrFolderType?: string,
  ): void;
  addPbxGroup(
    files: string[],
    name: string,
    path: string,
  ): { uuid: string; pbxGroup?: Record<string, unknown> };
  addSourceFile(path: string, opts?: Record<string, unknown>, group?: string): void;
  pbxNativeTargetSection(): Record<string, unknown>;
  pbxXCBuildConfigurationSection(): Record<string, unknown>;
}

export interface NotifyKitNseXcodePatchOptions {
  targetName: string;
  bundleIdentifier: string;
  parentTargetName?: string;
  deploymentTarget?: string;
}

export interface NotifyKitNseXcodePatchResult {
  didChange: boolean;
  targetUuid?: string;
  productUuid?: string;
  hostTargetUuid?: string;
  warnings: string[];
}

export function patchXcodeProjectForNotifyKitNse(
  proj: XcodeProject,
  options: NotifyKitNseXcodePatchOptions,
): NotifyKitNseXcodePatchResult {
  const { targetName, bundleIdentifier, parentTargetName, deploymentTarget = '15.1' } = options;
  const warnings: string[] = [];

  if (targetExists(proj, targetName)) {
    return { didChange: false, warnings };
  }

  const target = proj.addTarget(targetName, 'app_extension', targetName);

  if (!target || !target.uuid) {
    throw new Error(`xcode library failed to create target '${targetName}'`);
  }

  const targetUuid = target.uuid;
  const productUuid = getTargetProductUuid(target);

  fixProductFileReference(proj, targetName);

  proj.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', targetUuid);
  proj.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', targetUuid);
  proj.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', targetUuid);

  const group = proj.addPbxGroup([], targetName, targetName);
  proj.addSourceFile(
    `${targetName}/NotificationService.swift`,
    {
      target: targetUuid,
    },
    group.uuid,
  );

  const hostUuid = findHostTarget(proj, parentTargetName);
  if (hostUuid) {
    addTargetDependencyManual(proj, hostUuid, targetUuid, targetName);
    stripRnfbInfoPlistInputPath(proj, hostUuid);
  }

  setBuildSettings(proj, targetName, bundleIdentifier, deploymentTarget);

  return {
    didChange: true,
    targetUuid,
    productUuid,
    hostTargetUuid: hostUuid ?? undefined,
    warnings,
  };
}

function findHostTarget(proj: XcodeProject, parentTargetName?: string): string | null {
  if (parentTargetName) {
    return findTargetByName(proj, parentTargetName);
  }

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

function findTargetByName(proj: XcodeProject, name: string): string | null {
  const targets = proj.pbxNativeTargetSection();
  for (const [key, value] of Object.entries(targets)) {
    if (typeof value !== 'object') continue;
    const target = value as Record<string, unknown>;
    const targetName = String(target.name ?? '').replace(/"/g, '');
    if (targetName === name) {
      return key;
    }
  }
  return null;
}

function targetExists(proj: XcodeProject, name: string): boolean {
  return findTargetByName(proj, name) !== null;
}

function getTargetProductUuid(target: {
  uuid: string;
  pbxNativeTarget?: Record<string, unknown>;
}): string | undefined {
  const productReference = target.pbxNativeTarget?.productReference;
  return typeof productReference === 'string' ? productReference : undefined;
}

function setBuildSettings(
  proj: XcodeProject,
  targetName: string,
  bundleId: string,
  deploymentTarget: string,
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
    settings.IPHONEOS_DEPLOYMENT_TARGET = deploymentTarget;
    settings.SWIFT_VERSION = '5.0';
    settings.CODE_SIGN_ENTITLEMENTS = `"${targetName}/${targetName}.entitlements"`;
    settings.GENERATE_INFOPLIST_FILE = 'NO';
  }
}

function fixProductFileReference(proj: XcodeProject, targetName: string): void {
  const fileRefs = (proj as any).hash.project.objects.PBXFileReference;
  if (!fileRefs) return;
  for (const [, value] of Object.entries(fileRefs)) {
    if (typeof value !== 'object') continue;
    const ref = value as Record<string, unknown>;
    if (String(ref.name ?? '').replace(/"/g, '') === `${targetName}.appex`) {
      delete ref.fileEncoding;
      delete ref.lastKnownFileType;
    }
  }
}

function genUuid(): string {
  return crypto.randomBytes(12).toString('hex').toUpperCase().slice(0, 24);
}

function addTargetDependencyManual(
  proj: XcodeProject,
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
  objects.PBXContainerItemProxy[`${proxyUuid}_comment`] = 'PBXContainerItemProxy';

  if (!objects.PBXTargetDependency) objects.PBXTargetDependency = {};
  objects.PBXTargetDependency[depUuid] = {
    isa: 'PBXTargetDependency',
    target: extensionUuid,
    targetProxy: proxyUuid,
  };
  objects.PBXTargetDependency[`${depUuid}_comment`] = 'PBXTargetDependency';

  const hostTarget = objects.PBXNativeTarget[hostUuid];
  if (hostTarget && Array.isArray(hostTarget.dependencies)) {
    hostTarget.dependencies.push({ value: depUuid, comment: 'PBXTargetDependency' });
  }
}

function stripRnfbInfoPlistInputPath(proj: XcodeProject, hostUuid: string): void {
  const objects = (proj as any).hash.project.objects;
  const hostTarget = objects.PBXNativeTarget?.[hostUuid];
  const shellPhases = objects.PBXShellScriptBuildPhase;

  if (!hostTarget || !Array.isArray(hostTarget.buildPhases) || !shellPhases) {
    return;
  }

  for (const phaseRef of hostTarget.buildPhases) {
    const phaseUuid = phaseRef?.value;
    if (!phaseUuid) continue;

    const phase = shellPhases[phaseUuid] as Record<string, unknown> | undefined;
    if (!phase) continue;

    const phaseName = String(phase.name ?? '').replace(/"/g, '');
    if (phaseName !== '[CP-User] [RNFB] Core Configuration') {
      continue;
    }

    const inputPaths = Array.isArray(phase.inputPaths) ? phase.inputPaths : [];
    const filteredInputPaths = inputPaths.filter(
      entry => String(entry) !== '"$(BUILT_PRODUCTS_DIR)/$(INFOPLIST_PATH)"',
    );

    if (filteredInputPaths.length > 0) {
      phase.inputPaths = filteredInputPaths;
    } else {
      delete phase.inputPaths;
    }
  }
}
