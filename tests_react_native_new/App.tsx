import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  ScrollView,
  Text,
  TouchableOpacity,
  Platform,
  StyleSheet,
  View,
  SafeAreaView,
} from 'react-native';
import notifee, {
  TriggerType,
  EventType,
  AndroidImportance,
} from 'react-native-notify-kit';
import messaging from '@react-native-firebase/messaging';

type LogEntry = { time: string; msg: string };

function App() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logRef = useRef<((msg: string) => void) | undefined>(undefined);

  const log = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [{ time, msg }, ...prev]);
  }, []);

  logRef.current = log;

  // Create default Android channel at startup
  useEffect(() => {
    if (Platform.OS === 'android') {
      notifee
        .createChannel({
          id: 'default',
          name: 'Default Channel',
          importance: AndroidImportance.HIGH,
        })
        .then(() => logRef.current?.('startup: default channel created'))
        .catch(e => logRef.current?.(`startup: channel error ${e.message}`));
    }
  }, []);

  // Display incoming FCM messages as local notifications when app is in foreground.
  // Wrapped in try/catch so the app works without Firebase configured.
  useEffect(() => {
    try {
      const unsubscribe = messaging().onMessage(async remoteMessage => {
        logRef.current?.(
          `FCM received: ${remoteMessage.notification?.title ?? 'no title'}`,
        );
        await notifee.displayNotification({
          title: remoteMessage.notification?.title ?? 'Push Notification',
          body: remoteMessage.notification?.body ?? '',
          android: { channelId: 'default' },
        });
      });
      return unsubscribe;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logRef.current?.(`FCM not available: ${message}`);
    }
  }, []);

  // Register foreground event listener with proper cleanup
  useEffect(() => {
    const unsubscribe = notifee.onForegroundEvent(({ type, detail }) => {
      const typeName = EventType[type] || String(type);
      logRef.current?.(
        `ForegroundEvent: ${typeName} id=${detail.notification?.id ?? '?'}`,
      );
    });
    return unsubscribe;
  }, []);

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

  const cancelAll = () =>
    run('cancelAllNotifications', () => notifee.cancelAllNotifications());

  const requestPermission = () =>
    run('requestPermission', () => notifee.requestPermission());

  const getSettings = () =>
    run('getNotificationSettings', () => notifee.getNotificationSettings());

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

  const setBadge = () =>
    run('setBadgeCount(5)', () => notifee.setBadgeCount(5));

  const buttons: Array<{ label: string; onPress: () => void }> = [
    { label: 'requestPermission', onPress: requestPermission },
    { label: 'createChannel (Android)', onPress: createChannel },
    { label: 'displayNotification', onPress: displayNotification },
    { label: 'cancelAllNotifications', onPress: cancelAll },
    { label: 'getNotificationSettings', onPress: getSettings },
    { label: 'getDisplayedNotifications', onPress: getDisplayed },
    { label: 'createTriggerNotification (+10s)', onPress: createTrigger },
    { label: 'getBadgeCount (iOS)', onPress: getBadge },
    { label: 'setBadgeCount(5) (iOS)', onPress: setBadge },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Notifee Smoke Test</Text>
      <View style={styles.buttons}>
        {buttons.map(b => (
          <TouchableOpacity
            key={b.label}
            style={styles.button}
            onPress={b.onPress}
          >
            <Text style={styles.buttonText}>{b.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.logTitle}>Log</Text>
      <ScrollView style={styles.logContainer}>
        {logs.map((entry, i) => (
          <Text key={i} style={styles.logEntry}>
            [{entry.time}] {entry.msg}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f5f5f5' },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 12 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  buttonText: { color: '#fff', fontSize: 13 },
  logTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  logContainer: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    padding: 8,
  },
  logEntry: {
    color: '#0f0',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 2,
  },
});

export default App;
