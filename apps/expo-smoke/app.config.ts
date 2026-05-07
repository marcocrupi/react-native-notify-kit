import type { ConfigContext, ExpoConfig } from 'expo/config';

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
  },
  android: {
    ...config.android,
    package: 'com.notifykit.exposmoke',
  },
});
