'use strict';

const { createRunOncePlugin } = requireExpoConfigPlugins();
const { normalizeNotifyKitPluginOptions } = require('./options');
const {
  withNotifyKitAndroidManifest,
} = require('./android/withNotifyKitAndroidManifest');
const {
  withNotifyKitIosNseAppExtension,
} = require('./ios/withNotifyKitIosNseAppExtension');
const {
  withNotifyKitIosNseFiles,
} = require('./ios/withNotifyKitIosNseFiles');
const {
  withNotifyKitIosNsePodfile,
} = require('./ios/withNotifyKitIosNsePodfile');
const {
  withNotifyKitIosNseXcodeProject,
} = require('./ios/withNotifyKitIosNseXcodeProject');
const pkg = require('../../package.json');

function withNotifyKit(config, props = {}) {
  const options = normalizeNotifyKitPluginOptions(props);
  const foregroundServiceOptions = options.android.foregroundService;
  const nseOptions = options.ios.notificationServiceExtension;
  const configWithAndroidManifest = withNotifyKitAndroidManifest(
    config,
    foregroundServiceOptions,
  );
  const configWithAppExtension = withNotifyKitIosNseAppExtension(
    configWithAndroidManifest,
    nseOptions,
  );
  const configWithFiles = withNotifyKitIosNseFiles(configWithAppExtension, nseOptions);
  const configWithXcodeProject = withNotifyKitIosNseXcodeProject(configWithFiles, nseOptions);

  return withNotifyKitIosNsePodfile(configWithXcodeProject, nseOptions);
}

const plugin = createRunOncePlugin(withNotifyKit, pkg.name, pkg.version);

module.exports = plugin;
module.exports.default = plugin;
module.exports.withNotifyKit = withNotifyKit;
module.exports.normalizeNotifyKitPluginOptions = normalizeNotifyKitPluginOptions;
module.exports.withNotifyKitAndroidManifest = withNotifyKitAndroidManifest;
module.exports.withNotifyKitIosNseAppExtension = withNotifyKitIosNseAppExtension;
module.exports.withNotifyKitIosNseFiles = withNotifyKitIosNseFiles;
module.exports.withNotifyKitIosNseXcodeProject = withNotifyKitIosNseXcodeProject;
module.exports.withNotifyKitIosNsePodfile = withNotifyKitIosNsePodfile;

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
