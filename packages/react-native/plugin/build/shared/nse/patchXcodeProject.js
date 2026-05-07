'use strict';

const crypto = require('crypto');

function patchXcodeProjectForNotifyKitNse(proj, options) {
  const { targetName, bundleIdentifier, parentTargetName, deploymentTarget = '15.1' } = options;
  const warnings = [];

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

function findHostTarget(proj, parentTargetName) {
  if (parentTargetName) {
    return findTargetByName(proj, parentTargetName);
  }

  const targets = proj.pbxNativeTargetSection();
  for (const [key, value] of Object.entries(targets)) {
    if (typeof value !== 'object' || key.endsWith('_comment')) continue;
    const target = value;
    const productType = String(target.productType ?? '');
    if (productType.includes('application')) {
      return key;
    }
  }
  return null;
}

function findTargetByName(proj, name) {
  const targets = proj.pbxNativeTargetSection();
  for (const [key, value] of Object.entries(targets)) {
    if (typeof value !== 'object') continue;
    const target = value;
    const targetName = String(target.name ?? '').replace(/"/g, '');
    if (targetName === name) {
      return key;
    }
  }
  return null;
}

function targetExists(proj, name) {
  return findTargetByName(proj, name) !== null;
}

function getTargetProductUuid(target) {
  const productReference = target.pbxNativeTarget && target.pbxNativeTarget.productReference;
  return typeof productReference === 'string' ? productReference : undefined;
}

function setBuildSettings(proj, targetName, bundleId, deploymentTarget) {
  const configs = proj.pbxXCBuildConfigurationSection();

  for (const [, value] of Object.entries(configs)) {
    if (typeof value !== 'object') continue;
    const config = value;
    const settings = config.buildSettings;

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

function fixProductFileReference(proj, targetName) {
  const fileRefs = proj.hash.project.objects.PBXFileReference;
  if (!fileRefs) return;
  for (const [, value] of Object.entries(fileRefs)) {
    if (typeof value !== 'object') continue;
    const ref = value;
    if (String(ref.name ?? '').replace(/"/g, '') === `${targetName}.appex`) {
      delete ref.fileEncoding;
      delete ref.lastKnownFileType;
    }
  }
}

function genUuid() {
  return crypto.randomBytes(12).toString('hex').toUpperCase().slice(0, 24);
}

function addTargetDependencyManual(proj, hostUuid, extensionUuid, extensionName) {
  const proxyUuid = genUuid();
  const depUuid = genUuid();

  const objects = proj.hash.project.objects;

  const rootObject = proj.hash.project.rootObject;

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

function stripRnfbInfoPlistInputPath(proj, hostUuid) {
  const objects = proj.hash.project.objects;
  const hostTarget = objects.PBXNativeTarget?.[hostUuid];
  const shellPhases = objects.PBXShellScriptBuildPhase;

  if (!hostTarget || !Array.isArray(hostTarget.buildPhases) || !shellPhases) {
    return;
  }

  for (const phaseRef of hostTarget.buildPhases) {
    const phaseUuid = phaseRef?.value;
    if (!phaseUuid) continue;

    const phase = shellPhases[phaseUuid];
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

module.exports = {
  patchXcodeProjectForNotifyKitNse,
};
