import type { NormalizedIosNotificationServiceExtensionOptions } from '../options';

export interface ExpoConfigLike {
  ios?: {
    bundleIdentifier?: string;
    [key: string]: unknown;
  };
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EasAppExtensionConfig {
  targetName?: string;
  bundleIdentifier?: string;
  entitlements?: Record<string, unknown>;
  [key: string]: unknown;
}

export function withNotifyKitIosNseAppExtension<TConfig extends ExpoConfigLike>(
  config: TConfig,
  nseOptions: NormalizedIosNotificationServiceExtensionOptions,
): TConfig {
  if (!nseOptions.enabled) {
    return config;
  }

  const bundleIdentifier = resolveNotifyKitIosNseBundleIdentifier(config, nseOptions);
  const currentAppExtensions = getCurrentAppExtensions(config);
  const nextAppExtensions = upsertNotifyKitIosNseAppExtension(currentAppExtensions, {
    targetName: nseOptions.targetName,
    bundleIdentifier,
  });

  return {
    ...config,
    extra: setNestedAppExtensions(config.extra, nextAppExtensions),
  } as TConfig;
}

export function resolveNotifyKitIosNseBundleIdentifier(
  config: ExpoConfigLike,
  nseOptions: NormalizedIosNotificationServiceExtensionOptions,
): string {
  const hostBundleIdentifier = config.ios?.bundleIdentifier;
  if (!hostBundleIdentifier) {
    throw new Error(
      '[react-native-notify-kit] ios.bundleIdentifier is required when ios.notificationServiceExtension.enabled is true.',
    );
  }

  return `${hostBundleIdentifier}${nseOptions.bundleSuffix}`;
}

export function upsertNotifyKitIosNseAppExtension(
  appExtensions: EasAppExtensionConfig[],
  nextExtension: Required<Pick<EasAppExtensionConfig, 'targetName' | 'bundleIdentifier'>>,
): EasAppExtensionConfig[] {
  const nextAppExtensions: EasAppExtensionConfig[] = [];
  let didUpsert = false;

  for (const appExtension of appExtensions) {
    if (!isPlainObject(appExtension)) {
      throw new Error(
        '[react-native-notify-kit] extra.eas.build.experimental.ios.appExtensions must contain objects.',
      );
    }

    if (appExtension.targetName === nextExtension.targetName) {
      if (
        appExtension.bundleIdentifier !== undefined &&
        appExtension.bundleIdentifier !== nextExtension.bundleIdentifier
      ) {
        throw new Error(
          `[react-native-notify-kit] EAS app extension targetName '${nextExtension.targetName}' already uses bundleIdentifier '${appExtension.bundleIdentifier}'. ` +
            `Expected '${nextExtension.bundleIdentifier}'.`,
        );
      }

      if (!didUpsert) {
        nextAppExtensions.push({
          ...appExtension,
          targetName: nextExtension.targetName,
          bundleIdentifier: nextExtension.bundleIdentifier,
        });
        didUpsert = true;
      }
      continue;
    }

    if (appExtension.bundleIdentifier === nextExtension.bundleIdentifier) {
      throw new Error(
        `[react-native-notify-kit] EAS app extension bundleIdentifier '${nextExtension.bundleIdentifier}' already belongs to targetName '${appExtension.targetName}'. ` +
          `Expected '${nextExtension.targetName}'.`,
      );
    }

    nextAppExtensions.push(appExtension);
  }

  if (!didUpsert) {
    nextAppExtensions.push({
      targetName: nextExtension.targetName,
      bundleIdentifier: nextExtension.bundleIdentifier,
    });
  }

  return nextAppExtensions;
}

function getCurrentAppExtensions(config: ExpoConfigLike): EasAppExtensionConfig[] {
  const appExtensions = getObject(config.extra)?.eas;
  const build = getObject(appExtensions)?.build;
  const experimental = getObject(build)?.experimental;
  const ios = getObject(experimental)?.ios;
  const currentAppExtensions = getObject(ios)?.appExtensions;

  if (currentAppExtensions === undefined) {
    return [];
  }

  if (!Array.isArray(currentAppExtensions)) {
    throw new Error(
      '[react-native-notify-kit] extra.eas.build.experimental.ios.appExtensions must be an array.',
    );
  }

  return currentAppExtensions as EasAppExtensionConfig[];
}

function setNestedAppExtensions(
  currentExtra: Record<string, unknown> | undefined,
  appExtensions: EasAppExtensionConfig[],
): Record<string, unknown> {
  const extra = getObject(currentExtra) ?? {};
  const eas = getObject(extra.eas) ?? {};
  const build = getObject(eas.build) ?? {};
  const experimental = getObject(build.experimental) ?? {};
  const ios = getObject(experimental.ios) ?? {};

  return {
    ...extra,
    eas: {
      ...eas,
      build: {
        ...build,
        experimental: {
          ...experimental,
          ios: {
            ...ios,
            appExtensions,
          },
        },
      },
    },
  };
}

function getObject(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
