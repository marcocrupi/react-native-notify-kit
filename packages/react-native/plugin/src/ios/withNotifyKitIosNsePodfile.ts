import * as path from 'path';

import type { NormalizedIosNotificationServiceExtensionOptions } from '../options';
import { patchPodfileForNotifyKitNse } from '../shared/nse/patchPodfile';
import type { ExpoConfigLike } from './withNotifyKitIosNseAppExtension';

type PodfileUseFrameworks = false | true | 'static' | 'dynamic';

type PodfileModConfig<TConfig extends ExpoConfigLike> = TConfig & {
  modRequest: {
    projectRoot: string;
    platformProjectRoot: string;
    [key: string]: unknown;
  };
  modResults: {
    contents: string;
    [key: string]: unknown;
  };
};

type WithPodfile = <TConfig extends ExpoConfigLike>(
  config: TConfig,
  action: (
    config: PodfileModConfig<TConfig>,
  ) => PodfileModConfig<TConfig> | Promise<PodfileModConfig<TConfig>>,
) => TConfig;

declare const require: {
  (id: string): unknown;
  resolve(id: string, options?: { paths?: string[] }): string;
};

declare const process: {
  cwd(): string;
};

export function withNotifyKitIosNsePodfile<TConfig extends ExpoConfigLike>(
  config: TConfig,
  nseOptions: NormalizedIosNotificationServiceExtensionOptions,
): TConfig {
  if (!nseOptions.enabled) {
    return config;
  }

  const { withPodfile } = requireExpoConfigPlugins();
  const configuredUseFrameworks = detectConfiguredExpoBuildPropertiesUseFrameworks(config);

  return withPodfile(config, modConfig => {
    const { projectRoot, platformProjectRoot } = modConfig.modRequest;
    const packagePathFromIos = resolveNotifyKitPackagePathFromIos(projectRoot, platformProjectRoot);
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

export function resolveNotifyKitPackagePathFromIos(
  projectRoot: string,
  platformProjectRoot: string,
): string {
  const packageJsonPath = require.resolve('react-native-notify-kit/package.json', {
    paths: [projectRoot],
  });
  const packageDir = path.dirname(packageJsonPath);

  return normalizePodfilePath(path.relative(platformProjectRoot, packageDir));
}

export function normalizePodfilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function detectPodfileUseFrameworks(contents: string): PodfileUseFrameworks {
  let detected: PodfileUseFrameworks = false;

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

function resolveNseUseFrameworks(
  hostUseFrameworks: PodfileUseFrameworks,
  configuredUseFrameworks: PodfileUseFrameworks,
): PodfileUseFrameworks {
  if (hostUseFrameworks === false) {
    return false;
  }

  if (hostUseFrameworks === true && configuredUseFrameworks !== false) {
    return configuredUseFrameworks;
  }

  return hostUseFrameworks;
}

function detectConfiguredExpoBuildPropertiesUseFrameworks(
  config: ExpoConfigLike,
): PodfileUseFrameworks {
  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  let detected: PodfileUseFrameworks = false;

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireExpoConfigPlugins(): {
  withPodfile: WithPodfile;
} {
  try {
    return require('expo/config-plugins') as ReturnType<typeof requireExpoConfigPlugins>;
  } catch (error) {
    try {
      const expoConfigPluginsPath = require.resolve('expo/config-plugins', {
        paths: [process.cwd()],
      });

      return require(expoConfigPluginsPath) as ReturnType<typeof requireExpoConfigPlugins>;
    } catch {
      throw error;
    }
  }
}
