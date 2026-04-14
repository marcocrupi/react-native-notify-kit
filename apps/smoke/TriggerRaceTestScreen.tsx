import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import notifee, { TriggerType, AndroidImportance } from 'react-native-notify-kit';

type Props = {
  onBack: () => void;
  autoRun?: boolean;
};

const CHANNEL_ID = 'default';
const FAR_FUTURE = () => Date.now() + 24 * 60 * 60 * 1000;
// NOTE: no square brackets — verify-549-fix.sh greps logcat for this tag and
// bracket characters would require escaping at every call site (see commit 11
// in the PR history for the original bug this avoided).
const TAG = 'RACE549:';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function ensureChannel() {
  if (Platform.OS === 'android') {
    await notifee.createChannel({
      id: CHANNEL_ID,
      name: 'Default Channel',
      importance: AndroidImportance.HIGH,
    });
  }
}

async function seedTrigger(id: string, offset = 0) {
  await notifee.createTriggerNotification(
    { id, title: `s-${id}`, android: { channelId: CHANNEL_ID } },
    { type: TriggerType.TIMESTAMP, timestamp: FAR_FUTURE() + offset },
  );
}

type ScenarioACheck = { delay: number; total: number; canaryPresent: boolean };
type ScenarioAIter = {
  iteration: number;
  beforeCancel: number;
  cancelDurationMs: number;
  createDurationMs: number;
  checks: ScenarioACheck[];
  canarySurvived2s: boolean;
};

async function scenarioA(iterations = 20, seedCount = 50): Promise<ScenarioAIter[]> {
  const results: ScenarioAIter[] = [];
  for (let i = 0; i < iterations; i++) {
    for (let j = 0; j < seedCount; j++) {
      await seedTrigger(`seed-${i}-${j}`, j * 1000);
    }
    const beforeCancel = (await notifee.getTriggerNotificationIds()).length;

    const cancelStart = Date.now();
    await notifee.cancelTriggerNotifications();
    const cancelReturned = Date.now();

    const canaryId = `canary-${i}`;
    await notifee.createTriggerNotification(
      { id: canaryId, title: 'canary', android: { channelId: CHANNEL_ID } },
      { type: TriggerType.TIMESTAMP, timestamp: FAR_FUTURE() },
    );
    const createReturned = Date.now();

    const checks: ScenarioACheck[] = [];
    const delays = [0, 10, 50, 100, 250, 500, 1000, 2000];
    let elapsed = 0;
    for (const delay of delays) {
      const wait = delay - elapsed;
      if (wait > 0) await sleep(wait);
      elapsed = delay;
      const ids = await notifee.getTriggerNotificationIds();
      checks.push({ delay, total: ids.length, canaryPresent: ids.includes(canaryId) });
    }

    results.push({
      iteration: i,
      beforeCancel,
      cancelDurationMs: cancelReturned - cancelStart,
      createDurationMs: createReturned - cancelReturned,
      checks,
      canarySurvived2s: checks[checks.length - 1].canaryPresent,
    });

    await notifee.cancelTriggerNotifications();
    await sleep(500);
  }
  return results;
}

type ScenarioBIter = {
  iteration: number;
  before: number;
  immediately: number;
  after50ms: number;
  after500ms: number;
};

async function scenarioB(iterations = 30): Promise<ScenarioBIter[]> {
  const results: ScenarioBIter[] = [];
  for (let i = 0; i < iterations; i++) {
    for (let j = 0; j < 20; j++) {
      await seedTrigger(`b-${i}-${j}`, j * 1000);
    }
    await sleep(200);
    const before = (await notifee.getTriggerNotificationIds()).length;

    await notifee.cancelTriggerNotifications();
    const immediately = (await notifee.getTriggerNotificationIds()).length;
    await sleep(50);
    const after50ms = (await notifee.getTriggerNotificationIds()).length;
    await sleep(450);
    const after500ms = (await notifee.getTriggerNotificationIds()).length;

    results.push({ iteration: i, before, immediately, after50ms, after500ms });
    await sleep(200);
  }
  return results;
}

type ScenarioCIter = {
  iteration: number;
  createDurationMs: number;
  immediately: boolean;
  after50ms: boolean;
  after500ms: boolean;
};

async function scenarioC(iterations = 30): Promise<ScenarioCIter[]> {
  const results: ScenarioCIter[] = [];
  for (let i = 0; i < iterations; i++) {
    await notifee.cancelTriggerNotifications();
    await sleep(300);

    const id = `c-${i}`;
    const createStart = Date.now();
    await notifee.createTriggerNotification(
      { id, title: 'c', android: { channelId: CHANNEL_ID } },
      { type: TriggerType.TIMESTAMP, timestamp: FAR_FUTURE() },
    );
    const createReturned = Date.now();

    const immediately = (await notifee.getTriggerNotificationIds()).includes(id);
    await sleep(50);
    const after50ms = (await notifee.getTriggerNotificationIds()).includes(id);
    await sleep(450);
    const after500ms = (await notifee.getTriggerNotificationIds()).includes(id);

    results.push({
      iteration: i,
      createDurationMs: createReturned - createStart,
      immediately,
      after50ms,
      after500ms,
    });
  }
  return results;
}

type ScenarioDResult = { finalCount: number; finalIds: string[] };

async function scenarioD(): Promise<ScenarioDResult> {
  await notifee.cancelTriggerNotifications();
  await sleep(500);

  const ops: Promise<unknown>[] = [];
  for (let i = 0; i < 20; i++) {
    ops.push(
      notifee.createTriggerNotification(
        { id: `d-${i}`, title: 'd', android: { channelId: CHANNEL_ID } },
        { type: TriggerType.TIMESTAMP, timestamp: FAR_FUTURE() + i * 1000 },
      ),
    );
    if (i % 3 === 0) ops.push(notifee.cancelTriggerNotifications());
  }
  await Promise.all(ops);

  await sleep(2000);
  const finalIds = await notifee.getTriggerNotificationIds();
  return { finalCount: finalIds.length, finalIds };
}

function summarizeA(results: ScenarioAIter[]) {
  const total = results.length;
  const canaryMissingAtZero = results.filter(r => !r.checks[0].canaryPresent).length;
  const canaryMissingAt100 = results.filter(
    r => !(r.checks.find(c => c.delay === 100)?.canaryPresent ?? true),
  ).length;
  const canaryLostPermanent = results.filter(r => !r.canarySurvived2s).length;
  const avgCancelMs = (results.reduce((a, r) => a + r.cancelDurationMs, 0) / total).toFixed(1);
  const avgCreateMs = (results.reduce((a, r) => a + r.createDurationMs, 0) / total).toFixed(1);
  return {
    total,
    canaryMissingAtZero,
    canaryMissingAt100,
    canaryLostPermanent,
    avgCancelMs,
    avgCreateMs,
  };
}

function summarizeB(results: ScenarioBIter[]) {
  const total = results.length;
  const immediatelyNonZero = results.filter(r => r.immediately > 0).length;
  const after50NonZero = results.filter(r => r.after50ms > 0).length;
  const after500NonZero = results.filter(r => r.after500ms > 0).length;
  const maxImmediately = Math.max(...results.map(r => r.immediately));
  return { total, immediatelyNonZero, after50NonZero, after500NonZero, maxImmediately };
}

function summarizeC(results: ScenarioCIter[]) {
  const total = results.length;
  const immediatelyMissing = results.filter(r => !r.immediately).length;
  const after50Missing = results.filter(r => !r.after50ms).length;
  const after500Missing = results.filter(r => !r.after500ms).length;
  const avgCreateMs = (results.reduce((a, r) => a + r.createDurationMs, 0) / total).toFixed(1);
  return { total, immediatelyMissing, after50Missing, after500Missing, avgCreateMs };
}

export function TriggerRaceTestScreen({ onBack, autoRun = false }: Props) {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    setLog(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 200));
  }, []);

  useEffect(() => {
    (async () => {
      await ensureChannel();
      if (Platform.OS === 'android') {
        try {
          const res = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          );
          addLog(`POST_NOTIFICATIONS: ${res}`);
        } catch (e) {
          addLog(`POST_NOTIFICATIONS error: ${String(e)}`);
        }
      }
      await notifee.requestPermission();
      addLog('channel + permission ready');
    })();
  }, [addLog]);

  const guarded = useCallback(
    async (name: string, fn: () => Promise<unknown>) => {
      if (busy) {
        addLog('busy, ignoring');
        return;
      }
      setBusy(true);
      addLog(`→ ${name} START`);
      const started = Date.now();
      try {
        const result = await fn();
        const dur = Date.now() - started;
        const payload = JSON.stringify({ scenario: name, durationMs: dur, result });
        console.log(`${TAG} ${payload}`);
        addLog(`✓ ${name} ${dur}ms`);
        if (result !== undefined) {
          const summaryLine = JSON.stringify(result).slice(0, 500);
          addLog(summaryLine);
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        addLog(`✗ ${name} ERROR: ${message}`);
        console.log(`${TAG} ${JSON.stringify({ scenario: name, error: message })}`);
      } finally {
        setBusy(false);
      }
    },
    [addLog, busy],
  );

  const runA = () =>
    guarded('A', async () => {
      const results = await scenarioA(20, 50);
      const summary = summarizeA(results);
      console.log(`${TAG}A-full ${JSON.stringify(results)}`);
      return summary;
    });

  const runAQuick = () =>
    guarded('A-quick', async () => {
      const results = await scenarioA(5, 20);
      const summary = summarizeA(results);
      console.log(`${TAG}Aq-full ${JSON.stringify(results)}`);
      return summary;
    });

  const runB = () =>
    guarded('B', async () => {
      const results = await scenarioB(30);
      const summary = summarizeB(results);
      console.log(`${TAG}B-full ${JSON.stringify(results)}`);
      return summary;
    });

  const runC = () =>
    guarded('C', async () => {
      const results = await scenarioC(30);
      const summary = summarizeC(results);
      console.log(`${TAG}C-full ${JSON.stringify(results)}`);
      return summary;
    });

  const runD = () =>
    guarded('D', async () => {
      const result = await scenarioD();
      return result;
    });

  const runAll = useCallback(
    () =>
      guarded('ALL', async () => {
        // Emit one compact summary line per scenario so the verify-549-fix.sh
        // script can parse each independently without hitting logcat's per-line
        // size limit. Each line is a single-line JSON payload prefixed by a
        // scenario-specific tag (RACE549:A / RACE549:B / RACE549:C / RACE549:D)
        // and terminated by a RACE549:DONE signal so the script knows when
        // the run is complete.
        const a = await scenarioA(20, 50);
        const aSummary = summarizeA(a);
        console.log(`${TAG}A ${JSON.stringify(aSummary)}`);

        const b = await scenarioB(30);
        const bSummary = summarizeB(b);
        console.log(`${TAG}B ${JSON.stringify(bSummary)}`);

        const c = await scenarioC(30);
        const cSummary = summarizeC(c);
        console.log(`${TAG}C ${JSON.stringify(cSummary)}`);

        const d = await scenarioD();
        console.log(`${TAG}D ${JSON.stringify(d)}`);

        console.log(`${TAG}DONE ${new Date().toISOString()}`);

        return {
          A: aSummary,
          B: bSummary,
          C: cSummary,
          D: d,
        };
      }),
    [guarded],
  );

  const autoRunRef = useRef(false);
  useEffect(() => {
    if (!autoRun || autoRunRef.current) return;
    autoRunRef.current = true;
    const t = setTimeout(() => {
      runAll();
    }, 3000);
    return () => clearTimeout(t);
  }, [autoRun, runAll]);

  const cleanReset = () =>
    guarded('reset', async () => {
      await notifee.cancelTriggerNotifications();
      await sleep(1000);
      const remaining = (await notifee.getTriggerNotificationIds()).length;
      return { remaining };
    });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
          onPress={onBack}
        >
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>#549 Race Test</Text>
      </View>
      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            busy && styles.buttonBusy,
            pressed && styles.buttonPressed,
          ]}
          onPress={runA}
          disabled={busy}
        >
          <Text style={styles.buttonText}>A: cancel+create race (20×50)</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            busy && styles.buttonBusy,
            pressed && styles.buttonPressed,
          ]}
          onPress={runAQuick}
          disabled={busy}
        >
          <Text style={styles.buttonText}>A-quick (5×20)</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            busy && styles.buttonBusy,
            pressed && styles.buttonPressed,
          ]}
          onPress={runB}
          disabled={busy}
        >
          <Text style={styles.buttonText}>B: cancel consistency (30)</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            busy && styles.buttonBusy,
            pressed && styles.buttonPressed,
          ]}
          onPress={runC}
          disabled={busy}
        >
          <Text style={styles.buttonText}>C: create persistence (30)</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            busy && styles.buttonBusy,
            pressed && styles.buttonPressed,
          ]}
          onPress={runD}
          disabled={busy}
        >
          <Text style={styles.buttonText}>D: stress</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.allButton,
            busy && styles.buttonBusy,
            pressed && styles.buttonPressed,
          ]}
          onPress={runAll}
          disabled={busy}
        >
          <Text style={styles.buttonText}>Run ALL</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.resetButton,
            busy && styles.buttonBusy,
            pressed && styles.buttonPressed,
          ]}
          onPress={cleanReset}
          disabled={busy}
        >
          <Text style={styles.buttonText}>Cancel all & reset</Text>
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
  allButton: { backgroundColor: '#d9534f' },
  resetButton: { backgroundColor: '#f0ad4e' },
  clearButton: { backgroundColor: '#888' },
  buttonBusy: { opacity: 0.5 },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 13 },
  log: { flex: 1, backgroundColor: '#111', borderRadius: 6, padding: 8 },
  logContent: { paddingBottom: 16 },
  line: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#0f0',
    marginVertical: 1,
  },
  empty: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#888',
  },
});
