import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

type ExpoPlugin = NonNullable<ExpoConfig['plugins']>[number];

const FCM_ENV = 'EXPO_PUBLIC_NOTIFYKIT_EXPO_SMOKE_FCM';
const IOS_GOOGLE_SERVICES_FILE = './firebase/GoogleService-Info.plist';
const ANDROID_GOOGLE_SERVICES_FILE = './firebase/google-services.json';
const isFcmModeEnabled = process.env[FCM_ENV] === '1';

const requireGoogleServicesFile = (googleServicesFile: string, platformName: string): void => {
  const googleServicesFilePath = path.join(__dirname, googleServicesFile);

  if (!existsSync(googleServicesFilePath)) {
    throw new Error(
      `apps/expo-smoke FCM mode requires ${googleServicesFile}. ` +
        `Place the local Firebase ${platformName} config there or unset ${FCM_ENV}.`,
    );
  }
};

const requireFcmGoogleServicesFiles = (): void => {
  requireGoogleServicesFile(IOS_GOOGLE_SERVICES_FILE, 'iOS');
  requireGoogleServicesFile(ANDROID_GOOGLE_SERVICES_FILE, 'Android');
};

const getFcmPlugins = (): ExpoPlugin[] => {
  if (!isFcmModeEnabled) {
    return [];
  }

  requireFcmGoogleServicesFiles();

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

export default ({ config }: ConfigContext): ExpoConfig => ({
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
    ...(isFcmModeEnabled
      ? {
          googleServicesFile: IOS_GOOGLE_SERVICES_FILE,
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
    ...(isFcmModeEnabled
      ? {
          googleServicesFile: ANDROID_GOOGLE_SERVICES_FILE,
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
