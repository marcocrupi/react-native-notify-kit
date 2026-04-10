import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, Pressable, Platform, StyleSheet, View, Alert } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import notifee, {
  TriggerType,
  EventType,
  AndroidImportance,
  AndroidForegroundServiceType,
  AlarmType,
} from 'react-native-notify-kit';
import {
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  getInitialNotification,
} from '@react-native-firebase/messaging/lib/modular';
import { DeliveredTestScreen } from './DeliveredTestScreen';

// Uncomment to test cold start with remote notification handling disabled (fix #912)
// notifee.setNotificationConfig({ ios: { handleRemoteNotifications: false } });

type Section = {
  title: string;
  buttons: Array<{ label: string; onPress: () => void; testID?: string }>;
};

function App() {
  const [screen, setScreen] = useState<'main' | 'delivered'>('main');
  const log = useCallback((msg: string) => {
    console.log(`[Notifee] ${msg}`);
  }, []);

  // Check initial notification (cold start test for #1128)
  useEffect(() => {
    notifee.getInitialNotification().then(initialNotification => {
      if (initialNotification) {
        log(`getInitialNotification: ${JSON.stringify(initialNotification)}`);
        Alert.alert(
          'Notifee getInitialNotification',
          `ID: ${initialNotification.notification.id}\n` +
            `Title: ${initialNotification.notification.title}\n` +
            `Data: ${JSON.stringify(initialNotification.notification.data)}`,
        );
      } else {
        log('getInitialNotification: null');
      }
    });
  }, [log]);

  // Create default Android channel at startup
  useEffect(() => {
    if (Platform.OS === 'android') {
      notifee
        .createChannel({
          id: 'default',
          name: 'Default Channel',
          importance: AndroidImportance.HIGH,
        })
        .then(() => log('startup: default channel created'))
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e);
          log(`startup: channel error ${message}`);
        });
    }
  }, [log]);

  // Display incoming FCM messages as local notifications when app is in foreground.
  // Wrapped in try/catch so the app works without Firebase configured.
  useEffect(() => {
    try {
      const messaging = getMessaging();
      const unsubscribe = onMessage(messaging, async remoteMessage => {
        log(`FCM received: ${remoteMessage.notification?.title ?? 'no title'}`);
        await notifee.displayNotification({
          title: remoteMessage.notification?.title ?? 'Push Notification',
          body: remoteMessage.notification?.body ?? '',
          android: { channelId: 'default' },
        });
      });
      return unsubscribe;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      log(`FCM not available: ${message}`);
    }
  }, [log]);

  // Register foreground event listener with proper cleanup
  useEffect(() => {
    const unsubscribe = notifee.onForegroundEvent(({ type, detail }) => {
      const typeName = EventType[type] || String(type);
      log(
        `ForegroundEvent: ${typeName} id=${detail.notification?.id ?? '?'} ` +
          `title=${detail.notification?.title ?? '?'} ` +
          `data=${JSON.stringify(detail.notification?.data)}`,
      );
      if (type === EventType.PRESS) {
        Alert.alert(
          'Notifee PRESS (foreground)',
          `Title: ${detail.notification?.title}\n` +
            `Data: ${JSON.stringify(detail.notification?.data)}`,
        );
      }
    });
    return unsubscribe;
  }, [log]);

  // RNFB: detect notification tap when app is in background (not killed)
  useEffect(() => {
    const messaging = getMessaging();
    const unsubscribe = onNotificationOpenedApp(messaging, remoteMessage => {
      const data = JSON.stringify(remoteMessage.data ?? {});
      log(`[RNFB] onNotificationOpenedApp: ${data}`);
      Alert.alert('RNFB onNotificationOpenedApp', data);
    });
    return unsubscribe;
  }, [log]);

  // RNFB: detect notification tap when app was killed (cold start)
  useEffect(() => {
    const messaging = getMessaging();
    getInitialNotification(messaging).then(remoteMessage => {
      if (remoteMessage) {
        const data = JSON.stringify(remoteMessage.data ?? {});
        log(`[RNFB] getInitialNotification: ${data}`);
        Alert.alert('RNFB getInitialNotification', data);
      }
    });
  }, [log]);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      try {
        const result = await fn();
        log(`${label}: OK ${result != null ? JSON.stringify(result) : ''}`);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        log(`${label}: ERROR ${message}`);
      }
    },
    [log],
  );

  const createChannel = () =>
    run('createChannel', () =>
      notifee.createChannel({
        id: 'default',
        name: 'Default Channel',
        importance: AndroidImportance.HIGH,
      }),
    );

  const displayNotification = () =>
    run('displayNotification', async () => {
      if (Platform.OS === 'android') {
        await notifee.createChannel({
          id: 'default',
          name: 'Default Channel',
          importance: AndroidImportance.HIGH,
        });
      }
      return notifee.displayNotification({
        title: 'Test Notification',
        body: `Sent at ${new Date().toLocaleTimeString()}`,
        android: { channelId: 'default' },
      });
    });

  const cancelAll = () => run('cancelAllNotifications', () => notifee.cancelAllNotifications());

  const requestPermission = () => run('requestPermission', () => notifee.requestPermission());

  const getFCMToken = () =>
    run('getFCMToken', async () => {
      const messaging = getMessaging();
      const token = await getToken(messaging);
      console.log('FCM Token:', token);
      Alert.alert('FCM Token', token);
      return token;
    });

  const setRemoteOff = () =>
    run('setNotificationConfig(OFF)', () =>
      notifee.setNotificationConfig({ ios: { handleRemoteNotifications: false } }),
    );

  const setRemoteOn = () =>
    run('setNotificationConfig(ON)', () =>
      notifee.setNotificationConfig({ ios: { handleRemoteNotifications: true } }),
    );

  const getSettings = async () => {
    try {
      const settings = await notifee.getNotificationSettings();
      console.log('[Notifee] getNotificationSettings:', JSON.stringify(settings));
      log(`getNotificationSettings: ${JSON.stringify(settings)}`);
      Alert.alert(
        'Notification Settings',
        `authorizationStatus: ${settings.authorizationStatus}\n` +
          `(-1 = NOT_DETERMINED, 0 = DENIED, 1 = AUTHORIZED)`,
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      log(`getNotificationSettings: ERROR ${message}`);
    }
  };

  const getDisplayed = () =>
    run('getDisplayedNotifications', () => notifee.getDisplayedNotifications());

  const createTrigger = () =>
    run('createTriggerNotification', async () => {
      if (Platform.OS === 'android') {
        await notifee.createChannel({
          id: 'default',
          name: 'Default Channel',
          importance: AndroidImportance.HIGH,
        });
      }
      return notifee.createTriggerNotification(
        {
          title: 'Scheduled',
          body: 'This was scheduled 10s ago',
          android: { channelId: 'default' },
        },
        { type: TriggerType.TIMESTAMP, timestamp: Date.now() + 10000 },
      );
    });

  const getBadge = () => run('getBadgeCount', () => notifee.getBadgeCount());

  const setBadge = () => run('setBadgeCount(5)', () => notifee.setBadgeCount(5));

  const displayWithData = () =>
    run('displayWithData', async () => {
      if (Platform.OS === 'android') {
        await notifee.createChannel({
          id: 'default',
          name: 'Default Channel',
          importance: AndroidImportance.HIGH,
        });
      }
      return notifee.displayNotification({
        title: 'Test #1128',
        body: 'Tap me to check data',
        data: { screen: 'profile', userId: '42' },
        android: { channelId: 'default' },
      });
    });

  const displayWithoutPressAction = () =>
    run('displayWithoutPressAction', async () => {
      if (Platform.OS === 'android') {
        await notifee.createChannel({
          id: 'default',
          name: 'Default Channel',
          importance: AndroidImportance.HIGH,
        });
      }
      return notifee.displayNotification({
        title: 'Test #1128 (no pressAction)',
        body: 'Tap me - no pressAction set',
        data: { screen: 'settings', testId: 'no-press-action' },
        android: { channelId: 'default' },
      });
    });

  const displayDelayedNoPressAction = () =>
    run('displayDelayedNoPressAction', async () => {
      if (Platform.OS === 'android') {
        await notifee.createChannel({
          id: 'default',
          name: 'Default Channel',
          importance: AndroidImportance.HIGH,
        });
      }
      return notifee.createTriggerNotification(
        {
          title: 'Test #1128 (no pressAction)',
          body: 'Tap me - no pressAction set',
          data: { screen: 'settings', testId: 'no-press-action' },
          android: { channelId: 'default' },
        },
        {
          type: TriggerType.TIMESTAMP,
          timestamp: Date.now() + 10000,
          alarmManager: { type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE },
        },
      );
    });

  const displayWithPressAction = () =>
    run('displayWithPressAction', async () => {
      if (Platform.OS === 'android') {
        await notifee.createChannel({
          id: 'default',
          name: 'Default Channel',
          importance: AndroidImportance.HIGH,
        });
      }
      return notifee.displayNotification({
        title: 'Test #1128 (with pressAction)',
        body: 'Tap me to check cold start data',
        data: { screen: 'profile', userId: '42' },
        android: {
          channelId: 'default',
          pressAction: { id: 'default', launchActivity: 'default' },
        },
      });
    });

  const displayDelayedNullPressAction = () =>
    run('displayDelayedNullPressAction', async () => {
      if (Platform.OS === 'android') {
        await notifee.createChannel({
          id: 'default',
          name: 'Default Channel',
          importance: AndroidImportance.HIGH,
        });
      }
      return notifee.createTriggerNotification(
        {
          title: 'Opt-out test (pressAction: null)',
          body: 'Tap should NOT open the app',
          data: { testId: 'null-press-action' },
          android: {
            channelId: 'default',
            pressAction: null,
          },
        },
        {
          type: TriggerType.TIMESTAMP,
          timestamp: Date.now() + 10000,
          alarmManager: { type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE },
        },
      );
    });

  const displayDelayedWithPressAction = () =>
    run('displayDelayedWithPressAction', async () => {
      if (Platform.OS === 'android') {
        await notifee.createChannel({
          id: 'default',
          name: 'Default Channel',
          importance: AndroidImportance.HIGH,
        });
      }
      return notifee.createTriggerNotification(
        {
          title: 'Test #1128 delayed (with pressAction)',
          body: 'Tap me after killing app',
          data: { screen: 'profile', userId: '42' },
          android: {
            channelId: 'default',
            pressAction: { id: 'default', launchActivity: 'default' },
          },
        },
        {
          type: TriggerType.TIMESTAMP,
          timestamp: Date.now() + 10000,
          alarmManager: { type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE },
        },
      );
    });

  const startForegroundService = () =>
    run('startForegroundService', async () => {
      await notifee.createChannel({
        id: 'default',
        name: 'Default Channel',
        importance: AndroidImportance.HIGH,
      });
      return notifee.displayNotification({
        title: 'Foreground Service',
        body: 'Running as shortService (3 min timeout)',
        android: {
          channelId: 'default',
          ongoing: true,
          asForegroundService: true,
          foregroundServiceTypes: [
            AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE,
          ],
        },
      });
    });

  const stopForegroundService = () =>
    run('stopForegroundService', () => notifee.stopForegroundService());

  const startFgsNoType = () =>
    run('startFgsNoType', async () => {
      await notifee.createChannel({
        id: 'default',
        name: 'Default Channel',
        importance: AndroidImportance.HIGH,
      });
      return notifee.displayNotification({
        title: 'FGS (no type)',
        body: 'Should abort immediately on API 34+',
        android: {
          channelId: 'default',
          ongoing: true,
          asForegroundService: true,
        },
      });
    });

  const prewarmFgs = () =>
    run('prewarmForegroundService', () => notifee.prewarmForegroundService());

  const startFgsNoOngoing = () =>
    run('startFgsNoOngoing', async () => {
      await notifee.createChannel({
        id: 'default',
        name: 'Default Channel',
        importance: AndroidImportance.HIGH,
      });
      return notifee.displayNotification({
        title: 'FGS (no ongoing)',
        body: 'ongoing not set — should auto-default to true',
        android: {
          channelId: 'default',
          asForegroundService: true,
          foregroundServiceTypes: [
            AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE,
          ],
        },
      });
    });

  const sections: Section[] = [
    {
      title: 'Permissions',
      buttons: [{ label: 'requestPermission', onPress: requestPermission }],
    },
    {
      title: 'Firebase',
      buttons: [{ label: 'getFCMToken', onPress: getFCMToken }],
    },
    {
      title: 'Remote Notification Config (iOS)',
      buttons: [
        { label: 'RNFB Mode (Remote OFF)', onPress: setRemoteOff },
        { label: 'Notifee Mode (Remote ON)', onPress: setRemoteOn },
      ],
    },
    {
      title: 'Channels',
      buttons: [{ label: 'createChannel (Android)', onPress: createChannel }],
    },
    {
      title: 'Foreground Service',
      buttons: [
        {
          label: 'Start Foreground Service',
          onPress: startForegroundService,
          testID: 'fgs-trigger-button',
        },
        { label: 'Stop Foreground Service', onPress: stopForegroundService },
        { label: 'Prewarm FGS', onPress: prewarmFgs },
        { label: 'Start FGS (no type)', onPress: startFgsNoType },
        { label: 'Start FGS (no ongoing)', onPress: startFgsNoOngoing },
      ],
    },
    {
      title: 'Notifications',
      buttons: [
        { label: 'displayNotification', onPress: displayNotification },
        { label: 'cancelAllNotifications', onPress: cancelAll },
        { label: 'getDisplayedNotifications', onPress: getDisplayed },
        { label: 'getNotificationSettings', onPress: getSettings },
      ],
    },
    {
      title: 'Triggers',
      buttons: [{ label: 'createTriggerNotification (+10s)', onPress: createTrigger }],
    },
    {
      title: 'Badge',
      buttons: [
        { label: 'getBadgeCount (iOS)', onPress: getBadge },
        { label: 'setBadgeCount(5) (iOS)', onPress: setBadge },
      ],
    },
    {
      title: 'DELIVERED Test (9.3.0)',
      buttons: [{ label: 'Open DELIVERED Test', onPress: () => setScreen('delivered') }],
    },
    {
      title: 'Bug #1128 Tests',
      buttons: [
        { label: 'Display with Data', onPress: displayWithData },
        { label: 'Display without pressAction', onPress: displayWithoutPressAction },
        { label: 'Display Delayed (no pressAction)', onPress: displayDelayedNoPressAction },
        { label: 'Display with pressAction', onPress: displayWithPressAction },
        { label: 'Display Delayed (with pressAction)', onPress: displayDelayedWithPressAction },
        { label: 'Delayed (pressAction: null opt-out)', onPress: displayDelayedNullPressAction },
      ],
    },
  ];

  if (screen === 'delivered') {
    return (
      <SafeAreaProvider>
        <DeliveredTestScreen onBack={() => setScreen('main')} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Notifee Smoke Test</Text>
        <ScrollView style={styles.sectionsContainer}>
          {sections.map(section => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <View style={styles.sectionButtons}>
                {section.buttons.map(b => (
                  <Pressable
                    key={b.label}
                    testID={b.testID}
                    style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                    onPress={b.onPress}
                    android_ripple={{ color: 'rgba(255,255,255,0.3)' }}
                  >
                    <Text style={styles.buttonText}>{b.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f5f5f5' },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 12 },
  sectionsContainer: { flex: 1 },
  section: { marginBottom: 12 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    paddingLeft: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
  },
  sectionButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 13 },
});

export default App;
