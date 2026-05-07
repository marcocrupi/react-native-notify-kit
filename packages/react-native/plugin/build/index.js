'use strict';

const { createRunOncePlugin } = requireExpoConfigPlugins();
const { normalizeNotifyKitPluginOptions } = require('./options');
const {
  withNotifyKitIosNseAppExtension,
} = require('./ios/withNotifyKitIosNseAppExtension');
const {
  withNotifyKitIosNsePodfile,
} = require('./ios/withNotifyKitIosNsePodfile');
const pkg = require('../../package.json');

function withNotifyKit(config, props = {}) {
  const options = normalizeNotifyKitPluginOptions(props);
  const nseOptions = options.ios.notificationServiceExtension;
  const configWithAppExtension = withNotifyKitIosNseAppExtension(config, nseOptions);

  return withNotifyKitIosNsePodfile(configWithAppExtension, nseOptions);
}

const plugin = createRunOncePlugin(withNotifyKit, pkg.name, pkg.version);

module.exports = plugin;
module.exports.default = plugin;
module.exports.withNotifyKit = withNotifyKit;
module.exports.normalizeNotifyKitPluginOptions = normalizeNotifyKitPluginOptions;
module.exports.withNotifyKitIosNseAppExtension = withNotifyKitIosNseAppExtension;
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
