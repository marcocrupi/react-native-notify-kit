import { Platform } from 'react-native';
import notifee, { AndroidImportance } from 'react-native-notify-kit';

export const FCM_SMOKE_CHANNEL_ID = 'expo-smoke-default';
export const FCM_SMOKE_CHANNEL_NAME = 'Expo Smoke Default';
export const FCM_SMOKE_ENV = 'EXPO_PUBLIC_NOTIFYKIT_EXPO_SMOKE_FCM';
export const FCM_SMOKE_ENABLED = process.env[FCM_SMOKE_ENV] === '1';

export const isFcmSmokeRuntimePlatform = (): boolean =>
  Platform.OS === 'android' || Platform.OS === 'ios';

export const configureNotifyKitFcm = async (): Promise<void> => {
  await notifee.setFcmConfig({
    defaultChannelId: FCM_SMOKE_CHANNEL_ID,
    defaultPressAction: {
      id: 'default',
      launchActivity: 'default',
    },
    fallbackBehavior: 'display',
  });
};

export const ensureAndroidFcmChannel = async (): Promise<string | undefined> => {
  if (Platform.OS !== 'android') {
    return undefined;
  }

  return notifee.createChannel({
    id: FCM_SMOKE_CHANNEL_ID,
    name: FCM_SMOKE_CHANNEL_NAME,
    importance: AndroidImportance.HIGH,
  });
};

export const prepareNotifyKitFcm = async (): Promise<string | undefined> => {
  await configureNotifyKitFcm();
  return ensureAndroidFcmChannel();
};
