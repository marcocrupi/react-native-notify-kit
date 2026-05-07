'use strict';

function withNotifyKitIosNseAppExtension(config, nseOptions) {
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
  };
}

function resolveNotifyKitIosNseBundleIdentifier(config, nseOptions) {
  const hostBundleIdentifier = config.ios && config.ios.bundleIdentifier;
  if (!hostBundleIdentifier) {
    throw new Error(
      '[react-native-notify-kit] ios.bundleIdentifier is required when ios.notificationServiceExtension.enabled is true.',
    );
  }

  return `${hostBundleIdentifier}${nseOptions.bundleSuffix}`;
}

function upsertNotifyKitIosNseAppExtension(appExtensions, nextExtension) {
  const nextAppExtensions = [];
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

function getCurrentAppExtensions(config) {
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

  return currentAppExtensions;
}

function setNestedAppExtensions(currentExtra, appExtensions) {
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

function getObject(value) {
  return isPlainObject(value) ? value : null;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

module.exports = {
  withNotifyKitIosNseAppExtension,
  resolveNotifyKitIosNseBundleIdentifier,
  upsertNotifyKitIosNseAppExtension,
};
