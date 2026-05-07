import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import notifee, { AndroidImportance, EventType } from 'react-native-notify-kit';

const CHANNEL_ID = 'expo-smoke-default';

type LogEntry = {
  id: number;
  message: string;
};

const formatValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
};

export default function App(): React.JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((message: string, value?: unknown) => {
    const timestamp = new Date().toLocaleTimeString();
    const suffix = value === undefined ? '' : ` ${formatValue(value)}`;
    const line = `[${timestamp}] ${message}${suffix}`;

    console.log(`[expo-smoke] ${message}`, value ?? '');
    setLogs(currentLogs => [{ id: Date.now(), message: line }, ...currentLogs].slice(0, 40));
  }, []);

  useEffect(() => {
    addLog('App mounted');

    const unsubscribe = notifee.onForegroundEvent(event => {
      const eventName = EventType[event.type] ?? String(event.type);
      addLog(`Foreground event: ${eventName}`, event.detail);
    });

    return unsubscribe;
  }, [addLog]);

  const requestPermission = useCallback(async () => {
    try {
      const settings = await notifee.requestPermission();
      addLog('Permission settings', {
        authorizationStatus: settings.authorizationStatus,
      });
    } catch (error) {
      addLog('requestPermission failed', error instanceof Error ? error.message : error);
    }
  }, [addLog]);

  const ensureAndroidChannel = useCallback(async () => {
    if (Platform.OS !== 'android') {
      return undefined;
    }

    const channelId = await notifee.createChannel({
      id: CHANNEL_ID,
      name: 'Expo Smoke',
      importance: AndroidImportance.DEFAULT,
    });
    addLog('Android channel ready', channelId);

    return channelId;
  }, [addLog]);

  const displayLocalNotification = useCallback(async () => {
    try {
      const channelId = await ensureAndroidChannel();
      const notificationId = await notifee.displayNotification({
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

      addLog('Displayed local notification', notificationId);
    } catch (error) {
      addLog('displayNotification failed', error instanceof Error ? error.message : error);
    }
  }, [addLog, ensureAndroidChannel]);

  const getDisplayedNotifications = useCallback(async () => {
    try {
      const displayedNotifications = await notifee.getDisplayedNotifications();
      addLog('Displayed notifications', {
        count: displayedNotifications.length,
        ids: displayedNotifications.map(item => item.id ?? item.notification.id ?? 'unknown'),
      });
    } catch (error) {
      addLog('getDisplayedNotifications failed', error instanceof Error ? error.message : error);
    }
  }, [addLog]);

  const actions = useMemo(
    () => [
      {
        label: 'Request permission',
        onPress: requestPermission,
      },
      {
        label: 'Display local notification',
        onPress: displayLocalNotification,
      },
      {
        label: 'Get displayed notifications',
        onPress: getDisplayedNotifications,
      },
    ],
    [displayLocalNotification, getDisplayedNotifications, requestPermission],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>NotifyKit Expo Smoke</Text>
          <Text style={styles.subtitle}>Expo CNG fixture for react-native-notify-kit.</Text>
        </View>

        <View style={styles.actions}>
          {actions.map(action => (
            <Pressable
              accessibilityRole="button"
              key={action.label}
              onPress={action.onPress}
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            >
              <Text style={styles.buttonText}>{action.label}</Text>
            </Pressable>
          ))}
        </View>

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
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
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
