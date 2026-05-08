'use strict';

const path = require('path');

const { patchPodfileForNotifyKitNse } = require('../shared/nse/patchPodfile');

function withNotifyKitIosNsePodfile(config, nseOptions) {
  if (!nseOptions.enabled) {
    return config;
  }

  const { withPodfile } = requireExpoConfigPlugins();
  const configuredUseFrameworks = detectConfiguredExpoBuildPropertiesUseFrameworks(config);

  return withPodfile(config, modConfig => {
    const { projectRoot, platformProjectRoot } = modConfig.modRequest;
    const packagePathFromIos = resolveNotifyKitPackagePathFromIos(
      projectRoot,
      platformProjectRoot,
    );
    const hostUseFrameworks = detectPodfileUseFrameworks(modConfig.modResults.contents);
    const useFrameworks = resolveNseUseFrameworks(hostUseFrameworks, configuredUseFrameworks);
    const result = patchPodfileForNotifyKitNse(modConfig.modResults.contents, {
      targetName: nseOptions.targetName,
      packagePathFromIos,
      placement: 'topLevel',
      useFrameworks,
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

function detectPodfileUseFrameworks(contents) {
  let detected = false;

  for (const line of contents.split('\n')) {
    const stripped = line.replace(/#.*$/, '').trim();
    if (!/^use_frameworks!(?:\s|$)/.test(stripped)) {
      continue;
    }

    if (/:linkage\s*=>\s*:static\b/.test(stripped) || /\blinkage:\s*:static\b/.test(stripped)) {
      return 'static';
    }

    if (
      /:linkage\s*=>\s*:dynamic\b/.test(stripped) ||
      /\blinkage:\s*:dynamic\b/.test(stripped)
    ) {
      return 'dynamic';
    }

    detected = true;
  }

  return detected;
}

function resolveNseUseFrameworks(hostUseFrameworks, configuredUseFrameworks) {
  if (hostUseFrameworks === false) {
    return false;
  }

  if (hostUseFrameworks === true && configuredUseFrameworks !== false) {
    return configuredUseFrameworks;
  }

  return hostUseFrameworks;
}

function detectConfiguredExpoBuildPropertiesUseFrameworks(config) {
  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  let detected = false;

  for (const plugin of plugins) {
    if (!Array.isArray(plugin) || plugin[0] !== 'expo-build-properties') {
      continue;
    }

    const options = isPlainObject(plugin[1]) ? plugin[1] : null;
    const ios = isPlainObject(options?.ios) ? options.ios : null;
    const useFrameworks = ios?.useFrameworks;

    if (useFrameworks === 'static' || useFrameworks === 'dynamic') {
      detected = useFrameworks;
    } else if (useFrameworks === true || useFrameworks === false) {
      detected = useFrameworks;
    }
  }

  return detected;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  detectPodfileUseFrameworks,
};
