import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import notifee, { EventType, TriggerType, AndroidImportance } from 'react-native-notify-kit';

const EVENT_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(EventType)
    .filter(([, v]) => typeof v === 'number')
    .map(([name, value]) => [value, name]),
);

type Props = {
  onBack: () => void;
};

export function DeliveredTestScreen({ onBack }: Props) {
  const [log, setLog] = useState<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    setLog(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    return notifee.onForegroundEvent(({ type, detail }) => {
      const typeName = EVENT_TYPE_NAMES[type] ?? `unknown(${type})`;
      addLog(`FG ${typeName} id=${detail.notification?.id ?? '?'}`);
    });
  }, [addLog]);

  const ensureChannel = useCallback(async () => {
    if (Platform.OS === 'android') {
      await notifee.createChannel({
        id: 'default',
        name: 'Default Channel',
        importance: AndroidImportance.HIGH,
      });
    }
  }, []);

  const displayNow = useCallback(async () => {
    await ensureChannel();
    const id = `imm-${Date.now()}`;
    addLog(`→ displayNotification() id=${id}`);
    try {
      await notifee.displayNotification({
        id,
        title: 'Immediate',
        body: 'Display now',
        android: { channelId: 'default' },
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      addLog(`✗ ERROR: ${message}`);
    }
  }, [addLog, ensureChannel]);

  const triggerIn5s = useCallback(async () => {
    await ensureChannel();
    const id = `trg-${Date.now()}`;
    addLog(`→ trigger +5s id=${id}`);
    try {
      await notifee.createTriggerNotification(
        {
          id,
          title: 'Trigger',
          body: 'Fired after 5s',
          android: { channelId: 'default' },
        },
        { type: TriggerType.TIMESTAMP, timestamp: Date.now() + 5000 },
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      addLog(`✗ ERROR: ${message}`);
    }
  }, [addLog, ensureChannel]);

  const cancelAll = useCallback(async () => {
    await notifee.cancelAllNotifications();
    addLog('→ cancelAllNotifications()');
  }, [addLog]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
          onPress={onBack}
        >
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>DELIVERED Test</Text>
      </View>
      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={displayNow}
        >
          <Text style={styles.buttonText}>displayNotification() now</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={triggerIn5s}
        >
          <Text style={styles.buttonText}>schedule trigger +5s</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={cancelAll}
        >
          <Text style={styles.buttonText}>Cancel all</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.clearButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => setLog([])}
        >
          <Text style={styles.buttonText}>Clear log</Text>
        </Pressable>
      </View>
      <ScrollView ref={scrollRef} style={styles.log} contentContainerStyle={styles.logContent}>
        {log.length === 0 ? (
          <Text style={styles.empty}>No events yet. Tap a button above.</Text>
        ) : (
          log.map((line, i) => (
            <Text key={i} style={styles.line}>
              {line}
            </Text>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f5f5f5' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backButton: {
    backgroundColor: '#555',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 12,
  },
  backText: { color: '#fff', fontSize: 13 },
  title: { fontSize: 20, fontWeight: 'bold' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  clearButton: { backgroundColor: '#888' },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 13 },
  log: { flex: 1, backgroundColor: '#111', borderRadius: 6, padding: 8 },
  logContent: { paddingBottom: 16 },
  line: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#0f0',
    marginVertical: 1,
  },
  empty: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#888',
  },
});
