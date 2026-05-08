import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import notifee, { EventType } from 'react-native-notify-kit';

import App from './App';
import {
  FCM_SMOKE_CHANNEL_ID,
  FCM_SMOKE_ENABLED,
  configureNotifyKitFcm,
  ensureAndroidFcmChannel,
  isFcmSmokeRuntimePlatform,
  prepareNotifyKitFcm,
} from './fcmSmoke';

const isFcmModeEnabled = FCM_SMOKE_ENABLED && isFcmSmokeRuntimePlatform();

type MessagingModule = typeof import('@react-native-firebase/messaging');
type NotifyKitFcmMessage = Parameters<typeof notifee.handleFcmMessage>[0];

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const trimMarkerDetail = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(0, 160);

const getMessaging = (): FirebaseMessagingTypes.Module => {
  require('@react-native-firebase/app');
  const messagingModule = require('@react-native-firebase/messaging') as MessagingModule;
  return messagingModule.default();
};

const getMessageMarkerDetail = (remoteMessage: FirebaseMessagingTypes.RemoteMessage): string =>
  remoteMessage.messageId ?? remoteMessage.from ?? 'unknown';

const logAndroidChannelReady = (channelId?: string): void => {
  if (Platform.OS !== 'android') {
    return;
  }

  console.log(`SMOKE:FCM_ANDROID_CHANNEL_READY ${channelId ?? FCM_SMOKE_CHANNEL_ID}`);
};

const configureFcmMode = (): void => {
  if (!isFcmModeEnabled) {
    return;
  }

  try {
    void configureNotifyKitFcm().catch(error => {
      console.log(`SMOKE:FCM_ERROR config ${trimMarkerDetail(getErrorMessage(error))}`);
    });
    void ensureAndroidFcmChannel()
      .then(logAndroidChannelReady)
      .catch(error => {
        console.log(`SMOKE:FCM_ERROR channel ${trimMarkerDetail(getErrorMessage(error))}`);
      });

    const messaging = getMessaging();

    messaging.setBackgroundMessageHandler(async remoteMessage => {
      console.log(`SMOKE:FCM_BACKGROUND_MESSAGE ${getMessageMarkerDetail(remoteMessage)}`);

      try {
        const channelId = await prepareNotifyKitFcm();
        logAndroidChannelReady(channelId);

        const result = await notifee.handleFcmMessage(remoteMessage as NotifyKitFcmMessage);
        console.log(`SMOKE:FCM_HANDLE_OK ${result ?? 'null'}`);
        console.log(`SMOKE:FCM_BACKGROUND_HANDLE_OK ${result ?? 'null'}`);
        return result;
      } catch (error) {
        console.log(
          `SMOKE:FCM_BACKGROUND_HANDLE_ERROR ${trimMarkerDetail(getErrorMessage(error))}`,
        );
        console.log(`SMOKE:FCM_ERROR background ${trimMarkerDetail(getErrorMessage(error))}`);
        return undefined;
      }
    });
    console.log(`SMOKE:FCM_BACKGROUND_HANDLER_REGISTERED ${Platform.OS}`);

    notifee.onBackgroundEvent(async ({ type, detail }) => {
      if (type === EventType.PRESS || type === EventType.ACTION_PRESS) {
        console.log(
          `SMOKE:BACKGROUND_EVENT_PRESS ${
            detail.pressAction?.id ?? detail.notification?.id ?? 'unknown'
          }`,
        );
      }
    });
  } catch (error) {
    console.log(`SMOKE:FCM_ERROR setup ${trimMarkerDetail(getErrorMessage(error))}`);
  }
};

configureFcmMode();

registerRootComponent(App);
