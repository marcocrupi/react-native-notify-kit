'use strict';

const {
  patchXcodeProjectForNotifyKitNse,
} = require('../shared/nse/patchXcodeProject');
const {
  resolveNotifyKitIosNseBundleIdentifier,
} = require('./withNotifyKitIosNseAppExtension');

function withNotifyKitIosNseXcodeProject(config, nseOptions) {
  if (!nseOptions.enabled) {
    return config;
  }

  const { withXcodeProject } = requireExpoConfigPlugins();
  const bundleIdentifier = resolveNotifyKitIosNseBundleIdentifier(config, nseOptions);

  return withXcodeProject(config, modConfig => {
    const result = patchXcodeProjectForNotifyKitNse(modConfig.modResults, {
      targetName: nseOptions.targetName,
      bundleIdentifier,
      parentTargetName: modConfig.modRequest.projectName,
    });

    if (result.didChange && !result.hostTargetUuid) {
      throw new Error(
        '[react-native-notify-kit] Failed to link NotifyKit NSE target to the host app target.',
      );
    }

    return modConfig;
  });
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
  withNotifyKitIosNseXcodeProject,
};
