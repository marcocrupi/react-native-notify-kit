import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import notifee, { EventType, type NotificationSettings } from 'react-native-notify-kit';

import {
  FCM_SMOKE_CHANNEL_ID,
  FCM_SMOKE_ENABLED,
  ensureAndroidFcmChannel,
  isFcmSmokeRuntimePlatform,
  prepareNotifyKitFcm,
} from './fcmSmoke';

const MAX_LOG_ENTRIES = 80;

type LogEntry = {
  id: number;
  message: string;
};

type LogOptions = {
  marker?: string;
  markerDetail?: string | number;
  value?: unknown;
};

type SmokeAction = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

type MessagingModule = typeof import('@react-native-firebase/messaging');
type NotifyKitFcmMessage = Parameters<typeof notifee.handleFcmMessage>[0];

const formatValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return formatValue(error);
};

const getEventTypeName = (eventType: EventType): string =>
  (EventType as Record<number, string>)[eventType] ?? String(eventType);

const summarizeSettings = (settings: NotificationSettings) => ({
  authorizationStatus: settings.authorizationStatus,
  android: {
    alarm: settings.android.alarm,
  },
  ios: {
    alert: settings.ios.alert,
    badge: settings.ios.badge,
    sound: settings.ios.sound,
    notificationCenter: settings.ios.notificationCenter,
    authorizationStatus: settings.ios.authorizationStatus,
  },
});

const getDisplayedNotificationId = (
  displayedNotification: Awaited<ReturnType<typeof notifee.getDisplayedNotifications>>[number],
): string => displayedNotification.id ?? displayedNotification.notification.id ?? 'unknown';

const getChannelIds = (channels: Awaited<ReturnType<typeof notifee.getChannels>>): string[] =>
  channels.map(channel => channel.id);

const getMarkerLine = (marker: string, markerDetail?: string | number): string =>
  markerDetail === undefined ? marker : `${marker} ${markerDetail}`;

const trimMarkerDetail = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(0, 160);

const getLocalNotificationId = (): string => `expo-smoke-local-${Date.now()}`;

const hasGetChannels = (): boolean => typeof notifee.getChannels === 'function';

const logSkip = 'Skip: Android-only action.';

const getErrorMarkerDetail = (scenario: string, error: unknown): string =>
  trimMarkerDetail(`${scenario} ${getErrorMessage(error)}`);

const getSettingsLogValue = (settings: NotificationSettings): unknown =>
  summarizeSettings(settings);

const getChannelsLogValue = (
  channels: Awaited<ReturnType<typeof notifee.getChannels>>,
): unknown => ({
  count: channels.length,
  ids: getChannelIds(channels).slice(0, 8),
});

const getDisplayedLogValue = (
  displayedNotifications: Awaited<ReturnType<typeof notifee.getDisplayedNotifications>>,
): unknown => ({
  count: displayedNotifications.length,
  ids: displayedNotifications.map(getDisplayedNotificationId),
});

const getForegroundLogValue = (eventName: string, notificationId: string | undefined): unknown => ({
  type: eventName,
  notificationId: notificationId ?? 'none',
});

const getRemoteMessageMarkerDetail = (
  remoteMessage: FirebaseMessagingTypes.RemoteMessage,
): string => remoteMessage.messageId ?? remoteMessage.from ?? 'unknown';

export default function App(): React.JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastNotificationId, setLastNotificationId] = useState<string | undefined>();
  const fcmTokenRef = useRef<string | undefined>(undefined);
  const nextLogIdRef = useRef(0);
  const isFcmRuntimeEnabled = FCM_SMOKE_ENABLED && isFcmSmokeRuntimePlatform();

  const addLog = useCallback((message: string, options: LogOptions = {}) => {
    const timestamp = new Date().toLocaleTimeString();
    const suffix = options.value === undefined ? '' : ` ${formatValue(options.value)}`;
    const line = `[${timestamp}] ${message}${suffix}`;
    const consoleLine = options.marker
      ? getMarkerLine(options.marker, options.markerDetail)
      : `[expo-smoke] ${message}${suffix}`;

    console.log(consoleLine);
    setLogs(currentLogs => {
      nextLogIdRef.current += 1;
      return [{ id: nextLogIdRef.current, message: line }, ...currentLogs].slice(
        0,
        MAX_LOG_ENTRIES,
      );
    });
  }, []);

  const logError = useCallback(
    (scenario: string, error: unknown) => {
      const message = getErrorMessage(error);
      addLog(`${scenario} failed`, {
        marker: 'SMOKE:ERROR',
        markerDetail: getErrorMarkerDetail(scenario, error),
        value: message,
      });
    },
    [addLog],
  );

  const logFcmError = useCallback(
    (scenario: string, error: unknown) => {
      const message = getErrorMessage(error);
      addLog(`FCM ${scenario} failed`, {
        marker: 'SMOKE:FCM_ERROR',
        markerDetail: getErrorMarkerDetail(scenario, error),
        value: message,
      });
    },
    [addLog],
  );

  const getMessaging = useCallback((): FirebaseMessagingTypes.Module => {
    require('@react-native-firebase/app');
    const messagingModule = require('@react-native-firebase/messaging') as MessagingModule;
    return messagingModule.default();
  }, []);

  const logAndroidFcmChannelReady = useCallback(
    (channelId?: string) => {
      if (Platform.OS !== 'android') {
        return;
      }

      const markerDetail = channelId ?? FCM_SMOKE_CHANNEL_ID;
      addLog('FCM Android channel ready', {
        marker: 'SMOKE:FCM_ANDROID_CHANNEL_READY',
        markerDetail,
        value: {
          id: markerDetail,
        },
      });
    },
    [addLog],
  );

  useEffect(() => {
    addLog('App started', {
      marker: 'SMOKE:APP_STARTED',
    });
    addLog('NotifyKit JS import ready', {
      marker: 'SMOKE:NOTIFEE_IMPORTED',
    });

    const unsubscribe = notifee.onForegroundEvent(event => {
      try {
        const eventName = getEventTypeName(event.type);
        const notificationId = event.detail.notification?.id;
        const value = getForegroundLogValue(eventName, notificationId);

        if (event.type === EventType.DELIVERED) {
          addLog('Foreground event delivered', {
            marker: 'SMOKE:FOREGROUND_EVENT_DELIVERED',
            markerDetail: notificationId,
            value,
          });
          return;
        }

        if (event.type === EventType.PRESS) {
          addLog('Foreground event press', {
            marker: 'SMOKE:FOREGROUND_EVENT_PRESS',
            markerDetail: notificationId,
            value,
          });
          return;
        }

        addLog('Foreground event', {
          value,
        });
      } catch (error) {
        logError('foreground', error);
      }
    });

    return unsubscribe;
  }, [addLog, logError]);

  useEffect(() => {
    if (!FCM_SMOKE_ENABLED) {
      return undefined;
    }

    if (!isFcmRuntimeEnabled) {
      addLog('Skip: FCM mode supports iOS and Android only.');
      return undefined;
    }

    try {
      const messaging = getMessaging();

      void prepareNotifyKitFcm()
        .then(logAndroidFcmChannelReady)
        .catch(error => {
          logFcmError('bootstrap', error);
        });

      addLog('FCM foreground listener registered', {
        marker: 'SMOKE:FCM_ON_MESSAGE_REGISTERED',
        markerDetail: Platform.OS,
      });

      const unsubscribeMessage = messaging.onMessage(async remoteMessage => {
        addLog('FCM foreground message', {
          marker: 'SMOKE:FCM_ON_MESSAGE',
          markerDetail: getRemoteMessageMarkerDetail(remoteMessage),
        });

        try {
          const channelId = await prepareNotifyKitFcm();
          logAndroidFcmChannelReady(channelId);

          const result = await notifee.handleFcmMessage(remoteMessage as NotifyKitFcmMessage);
          addLog('FCM foreground handled', {
            marker: 'SMOKE:FCM_HANDLE_OK',
            markerDetail: result ?? 'null',
            value: {
              result,
            },
          });
          addLog('FCM foreground handled', {
            marker: 'SMOKE:FCM_FOREGROUND_HANDLE_OK',
            markerDetail: result ?? 'null',
            value: {
              result,
            },
          });
        } catch (error) {
          addLog('FCM foreground handle failed', {
            marker: 'SMOKE:FCM_FOREGROUND_HANDLE_ERROR',
            markerDetail: getErrorMarkerDetail('foreground', error),
            value: getErrorMessage(error),
          });
          logFcmError('foreground', error);
        }
      });

      const unsubscribeToken = messaging.onTokenRefresh(token => {
        fcmTokenRef.current = token;
        addLog('FCM token refreshed', {
          marker: 'SMOKE:FCM_TOKEN_REFRESH',
          markerDetail: token,
          value: token,
        });
      });

      return () => {
        unsubscribeMessage();
        unsubscribeToken();
      };
    } catch (error) {
      logFcmError('listener', error);
      return undefined;
    }
  }, [addLog, getMessaging, isFcmRuntimeEnabled, logAndroidFcmChannelReady, logFcmError]);

  const getNotificationSettings = useCallback(async () => {
    try {
      const settings = await notifee.getNotificationSettings();
      addLog('Notification settings', {
        marker: 'SMOKE:SETTINGS_OK',
        value: getSettingsLogValue(settings),
      });
    } catch (error) {
      logError('settings', error);
    }
  }, [addLog, logError]);

  const requestPermission = useCallback(async () => {
    try {
      const settings = await notifee.requestPermission();
      addLog('Permission settings', {
        marker: 'SMOKE:PERMISSION_OK',
        markerDetail: settings.authorizationStatus,
        value: {
          authorizationStatus: settings.authorizationStatus,
        },
      });
    } catch (error) {
      logError('permission', error);
    }
  }, [addLog, logError]);

  const ensureAndroidChannel = useCallback(
    async (showIosSkip = false) => {
      if (Platform.OS !== 'android') {
        if (showIosSkip) {
          addLog(logSkip);
        }
        return undefined;
      }

      const channelId = await ensureAndroidFcmChannel();
      addLog('Android channel ready', {
        marker: 'SMOKE:CHANNEL_CREATED',
        markerDetail: channelId ?? FCM_SMOKE_CHANNEL_ID,
        value: {
          id: channelId ?? FCM_SMOKE_CHANNEL_ID,
        },
      });
      logAndroidFcmChannelReady(channelId);

      if (hasGetChannels()) {
        const channels = await notifee.getChannels();
        addLog('Android channels', {
          marker: 'SMOKE:CHANNELS_COUNT',
          markerDetail: channels.length,
          value: getChannelsLogValue(channels),
        });
      }

      return channelId;
    },
    [addLog, logAndroidFcmChannelReady],
  );

  const ensureAndroidChannelFromButton = useCallback(async () => {
    try {
      await ensureAndroidChannel(true);
    } catch (error) {
      logError('channel', error);
    }
  }, [ensureAndroidChannel, logError]);

  const displayLocalNotification = useCallback(async () => {
    try {
      const channelId = await ensureAndroidChannel();
      const notificationId = getLocalNotificationId();
      const displayedNotificationId = await notifee.displayNotification({
        id: notificationId,
        title: 'NotifyKit Expo smoke',
        body: 'Local notification from the Expo CNG fixture.',
        data: {
          source: 'expo-smoke',
        },
        android: channelId
          ? {
              channelId,
              pressAction: {
                id: 'default',
              },
            }
          : undefined,
      });

      setLastNotificationId(displayedNotificationId);
      addLog('Displayed local notification', {
        marker: 'SMOKE:DISPLAY_LOCAL_OK',
        markerDetail: displayedNotificationId,
        value: {
          id: displayedNotificationId,
        },
      });
    } catch (error) {
      logError('display', error);
    }
  }, [addLog, ensureAndroidChannel, logError]);

  const getDisplayedNotifications = useCallback(async () => {
    try {
      const displayedNotifications = await notifee.getDisplayedNotifications();
      addLog('Displayed notifications', {
        marker: 'SMOKE:DISPLAYED_COUNT',
        markerDetail: displayedNotifications.length,
        value: getDisplayedLogValue(displayedNotifications),
      });
    } catch (error) {
      logError('displayed', error);
    }
  }, [addLog, logError]);

  const cancelLastNotification = useCallback(async () => {
    if (!lastNotificationId) {
      addLog('Skip: no last notification id.');
      return;
    }

    try {
      await notifee.cancelNotification(lastNotificationId);
      addLog('Cancelled last notification', {
        marker: 'SMOKE:CANCEL_OK',
        markerDetail: lastNotificationId,
        value: {
          id: lastNotificationId,
        },
      });
    } catch (error) {
      logError('cancel', error);
    }
  }, [addLog, lastNotificationId, logError]);

  const cancelAllNotifications = useCallback(async () => {
    try {
      await notifee.cancelAllNotifications();
      addLog('Cancelled all notifications', {
        marker: 'SMOKE:CANCEL_ALL_OK',
      });
    } catch (error) {
      logError('cancel-all', error);
    }
  }, [addLog, logError]);

  const registerFcm = useCallback(async () => {
    if (!isFcmRuntimeEnabled) {
      addLog('Skip: FCM mode supports iOS and Android only.');
      return;
    }

    try {
      const messaging = getMessaging();
      const channelId = await prepareNotifyKitFcm();
      logAndroidFcmChannelReady(channelId);
      const authorizationStatus = await messaging.requestPermission();

      await messaging.registerDeviceForRemoteMessages();

      const token = await messaging.getToken();
      fcmTokenRef.current = token;

      addLog('FCM token', {
        marker: 'SMOKE:FCM_TOKEN',
        markerDetail: token,
        value: token,
      });
      addLog('FCM registered', {
        marker: 'SMOKE:FCM_REGISTERED',
        markerDetail: authorizationStatus,
        value: {
          authorizationStatus,
          tokenLength: token.length,
        },
      });
    } catch (error) {
      logFcmError('register', error);
    }
  }, [addLog, getMessaging, isFcmRuntimeEnabled, logAndroidFcmChannelReady, logFcmError]);

  const clearLog = useCallback(() => {
    setLogs([]);
  }, []);

  const actions = useMemo<SmokeAction[]>(
    () => [
      {
        label: 'Get notification settings',
        onPress: getNotificationSettings,
      },
      {
        label: 'Request permission',
        onPress: requestPermission,
      },
      {
        label: 'Ensure Android channel',
        onPress: ensureAndroidChannelFromButton,
      },
      {
        label: 'Display local notification',
        onPress: displayLocalNotification,
      },
      {
        label: 'Get displayed notifications',
        onPress: getDisplayedNotifications,
      },
      {
        label: 'Cancel last notification',
        onPress: cancelLastNotification,
        disabled: !lastNotificationId,
      },
      {
        label: 'Cancel all notifications',
        onPress: cancelAllNotifications,
      },
      {
        label: 'Clear log',
        onPress: clearLog,
      },
    ],
    [
      cancelAllNotifications,
      cancelLastNotification,
      clearLog,
      displayLocalNotification,
      ensureAndroidChannelFromButton,
      getDisplayedNotifications,
      getNotificationSettings,
      lastNotificationId,
      requestPermission,
    ],
  );

  const fcmActions = useMemo<SmokeAction[]>(
    () =>
      FCM_SMOKE_ENABLED
        ? [
            {
              label: 'Register FCM',
              onPress: registerFcm,
              disabled: !isFcmRuntimeEnabled,
            },
          ]
        : [],
    [isFcmRuntimeEnabled, registerFcm],
  );

  const renderActionButton = (action: SmokeAction) => (
    <Pressable
      accessibilityRole="button"
      disabled={action.disabled}
      key={action.label}
      onPress={action.onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.buttonPressed,
        action.disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={[styles.buttonText, action.disabled && styles.buttonTextDisabled]}>
        {action.label}
      </Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>NotifyKit Expo Smoke</Text>
          <Text style={styles.subtitle}>Expo CNG fixture for react-native-notify-kit.</Text>
        </View>

        <View style={styles.actions}>{actions.map(renderActionButton)}</View>

        {fcmActions.length > 0 ? (
          <View style={styles.fcmSection}>
            <Text style={styles.sectionTitle}>FCM</Text>
            {fcmActions.map(renderActionButton)}
          </View>
        ) : null}

        <View style={styles.logPanel}>
          <Text style={styles.logTitle}>Log</Text>
          <ScrollView style={styles.logScroll} contentContainerStyle={styles.logContent}>
            {logs.length === 0 ? (
              <Text style={styles.logLine}>No events yet.</Text>
            ) : (
              logs.map(entry => (
                <Text key={entry.id} style={styles.logLine}>
                  {entry.message}
                </Text>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f6f8fa',
  },
  container: {
    flex: 1,
    gap: 20,
    padding: 20,
  },
  header: {
    gap: 8,
  },
  title: {
    color: '#102033',
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    color: '#52616f',
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    gap: 12,
  },
  fcmSection: {
    gap: 10,
  },
  sectionTitle: {
    color: '#102033',
    fontSize: 14,
    fontWeight: '700',
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#0f766e',
    borderRadius: 8,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonPressed: {
    backgroundColor: '#115e59',
  },
  buttonDisabled: {
    backgroundColor: '#c5cfd8',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonTextDisabled: {
    color: '#5f6b76',
  },
  logPanel: {
    backgroundColor: '#ffffff',
    borderColor: '#d7dee7',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    overflow: 'hidden',
  },
  logTitle: {
    borderBottomColor: '#d7dee7',
    borderBottomWidth: StyleSheet.hairlineWidth,
    color: '#102033',
    fontSize: 16,
    fontWeight: '700',
    padding: 14,
  },
  logScroll: {
    flex: 1,
  },
  logContent: {
    gap: 8,
    padding: 14,
  },
  logLine: {
    color: '#263645',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined }),
    fontSize: 12,
    lineHeight: 18,
  },
});
