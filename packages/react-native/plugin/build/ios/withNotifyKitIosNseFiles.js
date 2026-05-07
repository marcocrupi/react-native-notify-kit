'use strict';

const fs = require('fs');
const path = require('path');

const {
  renderNotificationServiceSwift,
  renderNseEntitlementsPlist,
  renderNseInfoPlist,
} = require('../shared/nse/initNseCore');

function withNotifyKitIosNseFiles(config, nseOptions) {
  if (!nseOptions.enabled) {
    return config;
  }

  const { withDangerousMod } = requireExpoConfigPlugins();

  return withDangerousMod(config, [
    'ios',
    modConfig => {
      writeNotifyKitIosNseFiles(
        modConfig.modRequest.platformProjectRoot,
        nseOptions.targetName,
      );
      return modConfig;
    },
  ]);
}

function writeNotifyKitIosNseFiles(platformProjectRoot, targetName) {
  const targetDir = path.join(platformProjectRoot, targetName);
  fs.mkdirSync(targetDir, { recursive: true });

  writeFileIfMissingOrIdentical(
    path.join(targetDir, 'NotificationService.swift'),
    renderNotificationServiceSwift(),
  );
  writeFileIfMissingOrIdentical(
    path.join(targetDir, 'Info.plist'),
    renderNseInfoPlist({ targetName }),
  );
  writeFileIfMissingOrIdentical(
    path.join(targetDir, `${targetName}.entitlements`),
    renderNseEntitlementsPlist(),
  );
}

function writeFileIfMissingOrIdentical(filePath, contents) {
  if (fs.existsSync(filePath)) {
    const currentContents = fs.readFileSync(filePath, 'utf8');
    if (currentContents !== contents) {
      throw new Error(
        `[react-native-notify-kit] Refusing to overwrite existing ${filePath}. ` +
          'Delete it or make it match the generated NotifyKit NSE template.',
      );
    }
    return;
  }

  fs.writeFileSync(filePath, contents, 'utf8');
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
  withNotifyKitIosNseFiles,
  writeNotifyKitIosNseFiles,
};
