'use strict';

const path = require('path');

const { patchPodfileForNotifyKitNse } = require('../shared/nse/patchPodfile');

function withNotifyKitIosNsePodfile(config, nseOptions) {
  if (!nseOptions.enabled) {
    return config;
  }

  const { withPodfile } = requireExpoConfigPlugins();

  return withPodfile(config, modConfig => {
    const { projectRoot, platformProjectRoot } = modConfig.modRequest;
    const packagePathFromIos = resolveNotifyKitPackagePathFromIos(
      projectRoot,
      platformProjectRoot,
    );
    const result = patchPodfileForNotifyKitNse(modConfig.modResults.contents, {
      targetName: nseOptions.targetName,
      packagePathFromIos,
    });

    modConfig.modResults.contents = result.contents;
    return modConfig;
  });
}

function resolveNotifyKitPackagePathFromIos(projectRoot, platformProjectRoot) {
  const packageJsonPath = require.resolve('react-native-notify-kit/package.json', {
    paths: [projectRoot],
  });
  const packageDir = path.dirname(packageJsonPath);

  return normalizePodfilePath(path.relative(platformProjectRoot, packageDir));
}

function normalizePodfilePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function requireExpoConfigPlugins() {
  try {
    return require('expo/config-plugins');
  } catch (error) {
    try {
      return require(require.resolve('expo/config-plugins', { paths: [process.cwd()] }));
    } catch {
      throw error;
    }
  }
}

module.exports = {
  withNotifyKitIosNsePodfile,
  resolveNotifyKitPackagePathFromIos,
  normalizePodfilePath,
};
