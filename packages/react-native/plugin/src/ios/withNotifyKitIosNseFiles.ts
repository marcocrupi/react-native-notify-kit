import * as fs from 'fs';
import * as path from 'path';

import type { NormalizedIosNotificationServiceExtensionOptions } from '../options';
import {
  renderNotificationServiceSwift,
  renderNseEntitlementsPlist,
  renderNseInfoPlist,
} from '../shared/nse/initNseCore';
import type { ExpoConfigLike } from './withNotifyKitIosNseAppExtension';

type DangerousModConfig<TConfig extends ExpoConfigLike> = TConfig & {
  modRequest: {
    platformProjectRoot: string;
    [key: string]: unknown;
  };
};

type WithDangerousMod = <TConfig extends ExpoConfigLike>(
  config: TConfig,
  action: [
    'ios',
    (
      config: DangerousModConfig<TConfig>,
    ) => DangerousModConfig<TConfig> | Promise<DangerousModConfig<TConfig>>,
  ],
) => TConfig;

declare const require: {
  (id: string): unknown;
  resolve(id: string, options?: { paths?: string[] }): string;
};

declare const process: {
  cwd(): string;
};

export function withNotifyKitIosNseFiles<TConfig extends ExpoConfigLike>(
  config: TConfig,
  nseOptions: NormalizedIosNotificationServiceExtensionOptions,
): TConfig {
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

export function writeNotifyKitIosNseFiles(
  platformProjectRoot: string,
  targetName: string,
): void {
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

function writeFileIfMissingOrIdentical(filePath: string, contents: string): void {
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

function requireExpoConfigPlugins(): {
  withDangerousMod: WithDangerousMod;
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
