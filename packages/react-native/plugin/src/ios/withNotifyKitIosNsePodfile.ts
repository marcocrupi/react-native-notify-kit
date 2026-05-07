import * as path from 'path';

import type { NormalizedIosNotificationServiceExtensionOptions } from '../options';
import { patchPodfileForNotifyKitNse } from '../shared/nse/patchPodfile';
import type { ExpoConfigLike } from './withNotifyKitIosNseAppExtension';

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

  return withPodfile(config, modConfig => {
    const { projectRoot, platformProjectRoot } = modConfig.modRequest;
    const packagePathFromIos = resolveNotifyKitPackagePathFromIos(projectRoot, platformProjectRoot);
    const result = patchPodfileForNotifyKitNse(modConfig.modResults.contents, {
      targetName: nseOptions.targetName,
      packagePathFromIos,
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
