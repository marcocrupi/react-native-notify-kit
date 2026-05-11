// @ts-nocheck

const { existsSync, statSync } = require('fs');
const path = require('path');

const FCM_ENV = 'EXPO_PUBLIC_NOTIFYKIT_EXPO_SMOKE_FCM';
const GOOGLE_SERVICE_INFO_PLIST_ENV = 'GOOGLE_SERVICE_INFO_PLIST';
const GOOGLE_SERVICES_JSON_ENV = 'GOOGLE_SERVICES_JSON';
const LOCAL_IOS_GOOGLE_SERVICES_FILE = './firebase/GoogleService-Info.plist';
const LOCAL_ANDROID_GOOGLE_SERVICES_FILE = './firebase/google-services.json';
const isFcmModeEnabled = process.env[FCM_ENV] === '1';

const resolveConfigFilePath = (candidate) =>
  path.isAbsolute(candidate) ? candidate : path.join(__dirname, candidate);

const createGoogleServicesFileError = (
  localGoogleServicesFile,
  envName,
  platformName,
  reason,
) =>
  new Error(
    `apps/expo-smoke FCM mode requires the Firebase ${platformName} config file. ${reason} ` +
      `Set ${envName} as an EAS file environment variable, place ${localGoogleServicesFile} locally, ` +
      `or unset ${FCM_ENV}.`,
  );

const requireGoogleServicesFile = (
  localGoogleServicesFile,
  envName,
  platformName,
) => {
  const rawEnvValue = process.env[envName];
  const googleServicesFile =
    rawEnvValue === undefined ? localGoogleServicesFile : rawEnvValue.trim();

  if (rawEnvValue !== undefined && googleServicesFile.length === 0) {
    throw createGoogleServicesFileError(
      localGoogleServicesFile,
      envName,
      platformName,
      `${envName} is set but empty.`,
    );
  }

  const googleServicesFilePath = resolveConfigFilePath(googleServicesFile);

  if (!existsSync(googleServicesFilePath)) {
    throw createGoogleServicesFileError(
      localGoogleServicesFile,
      envName,
      platformName,
      `Requested path ${googleServicesFile} does not exist.`,
    );
  }

  if (!statSync(googleServicesFilePath).isFile()) {
    throw createGoogleServicesFileError(
      localGoogleServicesFile,
      envName,
      platformName,
      `Requested path ${googleServicesFile} resolves to a directory, not a file.`,
    );
  }

  return googleServicesFile;
};

const getFcmGoogleServicesFiles = () => {
  if (!isFcmModeEnabled) {
    return undefined;
  }

  return {
    ios: requireGoogleServicesFile(
      LOCAL_IOS_GOOGLE_SERVICES_FILE,
      GOOGLE_SERVICE_INFO_PLIST_ENV,
      'iOS',
    ),
    android: requireGoogleServicesFile(
      LOCAL_ANDROID_GOOGLE_SERVICES_FILE,
      GOOGLE_SERVICES_JSON_ENV,
      'Android',
    ),
  };
};

const fcmGoogleServicesFiles = getFcmGoogleServicesFiles();

const getFcmPlugins = () => {
  if (!fcmGoogleServicesFiles) {
    return [];
  }

  return [
    '@react-native-firebase/app',
    '@react-native-firebase/messaging',
    [
      'expo-build-properties',
      {
        ios: {
          useFrameworks: 'static',
        },
      },
    ],
    './plugins/withRnfbStaticLibrariesExpo55',
    './plugins/withFirebaseAppDelegateExpo55',
  ];
};

module.exports = ({ config }) => ({
  ...config,
  name: 'NotifyKit Expo Smoke',
  slug: 'notify-kit-expo-smoke',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'notifykitexposmoke',
  ios: {
    ...config.ios,
    bundleIdentifier: 'com.notifykit.exposmoke',
    supportsTablet: true,
    ...(fcmGoogleServicesFiles
      ? {
          googleServicesFile: fcmGoogleServicesFiles.ios,
          entitlements: {
            ...(config.ios?.entitlements ?? {}),
            'aps-environment': 'development',
          },
        }
      : {}),
  },
  android: {
    ...config.android,
    package: 'com.notifykit.exposmoke',
    ...(fcmGoogleServicesFiles
      ? {
          googleServicesFile: fcmGoogleServicesFiles.android,
        }
      : {}),
  },
  extra: {
    ...(config.extra ?? {}),
    eas: {
      ...(config.extra?.eas ?? {}),
      projectId: '003d3e36-87e4-4f68-a8d5-5a9ad0622473',
    },
  },
  plugins: [
    ...(config.plugins ?? []),
    ...getFcmPlugins(),
    [
      'react-native-notify-kit',
      {
        ios: {
          notificationServiceExtension: {
            enabled: true,
            targetName: 'NotifyKitNSE',
            bundleSuffix: '.NotifyKitNSE',
          },
        },
      },
    ],
  ],
});
