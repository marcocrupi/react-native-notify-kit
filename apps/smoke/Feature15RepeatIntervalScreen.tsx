import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import notifee, {
  AlarmType,
  AndroidImportance,
  RepeatFrequency,
  TriggerType,
} from 'react-native-notify-kit';
import type { TimestampTrigger, TriggerNotification } from 'react-native-notify-kit';

type Props = {
  onBack: () => void;
  request?: { scenario: string; nonce: number } | null;
};

type F15Event = 'START' | 'RESULT' | 'TRIGGERS' | 'DONE' | 'ERROR';
type F15Payload = Record<string, unknown>;

type TriggerSummary = {
  notificationId: string | null;
  triggerType: unknown;
  timestamp: unknown;
  repeatFrequency: unknown;
  repeatInterval: unknown;
  alarmManager: unknown;
};

const CHANNEL_ID = 'default';
const FEATURE_PREFIX = 'f15-';
const VALID_SCENARIOS = new Set([
  'one-shot',
  'daily-2',
  'weekly-2',
  'monthly-3',
  'invalid-monthly-workmanager',
  'invalid-repeat-interval',
  'dump-triggers',
  'cancel-feature',
  'request-permission',
  'get-notification-settings',
  'open-alarm-permission-settings',
]);

function SmokeButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled ? styles.buttonPressed : null,
        disabled ? styles.buttonDisabled : null,
      ]}
    >
      <Text style={[styles.buttonText, disabled ? styles.buttonTextDisabled : null]}>{title}</Text>
    </Pressable>
  );
}

function normalizeForJson(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (Array.isArray(value)) {
    return value.map(normalizeForJson);
  }

  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      normalized[key] = normalizeForJson(entry);
    }
    return normalized;
  }

  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function ensureChannel() {
  if (Platform.OS === 'android') {
    await notifee.createChannel({
      id: CHANNEL_ID,
      name: 'Default Channel',
      importance: AndroidImportance.HIGH,
    });
  }
}

function summarizeTriggerNotification(item: TriggerNotification): TriggerSummary {
  const trigger = item.trigger as unknown as Record<string, unknown>;

  return {
    notificationId: item.notification.id ?? null,
    triggerType: trigger.type ?? null,
    timestamp: trigger.timestamp ?? null,
    repeatFrequency: trigger.repeatFrequency ?? null,
    repeatInterval: trigger.repeatInterval ?? null,
    alarmManager: trigger.alarmManager ?? null,
  };
}

export function Feature15RepeatIntervalScreen({ onBack, request }: Props) {
  const [busy, setBusy] = useState(false);
  const [lastScenario, setLastScenario] = useState<string>('none');
  const [lastResult, setLastResult] = useState<string>('No Feature #15 scenario has run yet.');
  const [logLines, setLogLines] = useState<string[]>([]);
  const lastRequestNonce = useRef<number | null>(null);

  const addLog = useCallback((line: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    setLogLines(prev => [`[${ts}] ${line}`, ...prev].slice(0, 120));
  }, []);

  const emit = useCallback(
    (event: F15Event, payload: F15Payload) => {
      const normalized = normalizeForJson({
        loggedAt: Date.now(),
        ...payload,
      });
      const line = `F15:${event} ${JSON.stringify(normalized)}`;
      console.log(line);
      setLastResult(line);
      addLog(line);
    },
    [addLog],
  );

  const dumpTriggers = useCallback(
    async (scenario = 'dump-triggers') => {
      const ids = await notifee.getTriggerNotificationIds();
      const triggerNotifications = await notifee.getTriggerNotifications();
      const triggers = triggerNotifications.map(summarizeTriggerNotification);

      emit('TRIGGERS', {
        scenario,
        ok: true,
        count: ids.length,
        ids,
        triggers,
      });

      return { ids, triggers };
    },
    [emit],
  );

  const scheduleTimestampScenario = useCallback(
    async (
      scenario: string,
      notificationId: string,
      repeatFrequency?: RepeatFrequency,
      repeatInterval?: number,
    ) => {
      await ensureChannel();
      await notifee.cancelTriggerNotifications([notificationId]);

      const scheduledAt = Date.now() + 60_000;
      let trigger: TimestampTrigger = {
        type: TriggerType.TIMESTAMP,
        timestamp: scheduledAt,
      };

      if (repeatFrequency !== undefined) {
        trigger = {
          ...trigger,
          repeatFrequency,
          alarmManager: { type: AlarmType.SET_ALARM_CLOCK },
        };
      }

      if (repeatInterval !== undefined) {
        trigger = {
          ...trigger,
          repeatInterval,
        };
      }

      const createdId = await notifee.createTriggerNotification(
        {
          id: notificationId,
          title: `Feature #15 ${scenario}`,
          body: `Scheduled at ${new Date(scheduledAt).toISOString()}`,
          data: {
            feature: '15',
            scenario,
            scheduledAt,
          },
          android: {
            channelId: CHANNEL_ID,
            pressAction: { id: 'default', launchActivity: 'default' },
          },
        },
        trigger,
      );

      const payload = {
        scenario,
        ok: true,
        notificationId: createdId,
        timestamp: scheduledAt,
        scheduledAt,
        repeatFrequency: repeatFrequency ?? null,
        repeatInterval: repeatInterval ?? null,
      };

      emit('RESULT', payload);
      emit('DONE', payload);
    },
    [emit],
  );

  const runInvalidMonthlyWorkManager = useCallback(async () => {
    await ensureChannel();

    const scenario = 'invalid-monthly-workmanager';
    const notificationId = `${FEATURE_PREFIX}invalid-monthly-workmanager`;
    const scheduledAt = Date.now() + 60_000;

    await notifee.cancelTriggerNotifications([notificationId]);

    try {
      await notifee.createTriggerNotification(
        {
          id: notificationId,
          title: 'Feature #15 invalid monthly WorkManager',
          body: 'This should be rejected',
          android: { channelId: CHANNEL_ID },
        },
        {
          type: TriggerType.TIMESTAMP,
          timestamp: scheduledAt,
          repeatFrequency: RepeatFrequency.MONTHLY,
          repeatInterval: 1,
          alarmManager: false,
        },
      );

      await notifee.cancelTriggerNotifications([notificationId]);

      emit('RESULT', {
        scenario,
        ok: true,
        expectedFailure: true,
        unexpectedSuccess: true,
        notificationId,
        timestamp: scheduledAt,
        scheduledAt,
        repeatFrequency: RepeatFrequency.MONTHLY,
        repeatInterval: 1,
      });
      emit('ERROR', {
        scenario,
        ok: false,
        notificationId,
        message: 'invalid monthly WorkManager trigger was unexpectedly accepted',
      });
    } catch (error) {
      emit('RESULT', {
        scenario,
        ok: false,
        expectedFailure: true,
        rejected: true,
        notificationId,
        timestamp: scheduledAt,
        scheduledAt,
        repeatFrequency: RepeatFrequency.MONTHLY,
        repeatInterval: 1,
        message: errorMessage(error),
      });
      emit('DONE', {
        scenario,
        ok: true,
        rejected: true,
        notificationId,
      });
    }
  }, [emit]);

  const runInvalidRepeatIntervals = useCallback(async () => {
    await ensureChannel();

    const scenario = 'invalid-repeat-interval';
    const cases = [
      {
        name: 'zero',
        repeatFrequency: RepeatFrequency.DAILY,
        repeatInterval: 0,
        trigger: (timestamp: number) => ({
          type: TriggerType.TIMESTAMP,
          timestamp,
          repeatFrequency: RepeatFrequency.DAILY,
          repeatInterval: 0,
        }),
      },
      {
        name: 'negative',
        repeatFrequency: RepeatFrequency.DAILY,
        repeatInterval: -1,
        trigger: (timestamp: number) => ({
          type: TriggerType.TIMESTAMP,
          timestamp,
          repeatFrequency: RepeatFrequency.DAILY,
          repeatInterval: -1,
        }),
      },
      {
        name: 'fraction',
        repeatFrequency: RepeatFrequency.DAILY,
        repeatInterval: 1.5,
        trigger: (timestamp: number) => ({
          type: TriggerType.TIMESTAMP,
          timestamp,
          repeatFrequency: RepeatFrequency.DAILY,
          repeatInterval: 1.5,
        }),
      },
      {
        name: 'nan',
        repeatFrequency: RepeatFrequency.DAILY,
        repeatInterval: Number.NaN,
        repeatIntervalLabel: 'NaN',
        trigger: (timestamp: number) => ({
          type: TriggerType.TIMESTAMP,
          timestamp,
          repeatFrequency: RepeatFrequency.DAILY,
          repeatInterval: Number.NaN,
        }),
      },
      {
        name: 'infinity',
        repeatFrequency: RepeatFrequency.DAILY,
        repeatInterval: Number.POSITIVE_INFINITY,
        repeatIntervalLabel: 'Infinity',
        trigger: (timestamp: number) => ({
          type: TriggerType.TIMESTAMP,
          timestamp,
          repeatFrequency: RepeatFrequency.DAILY,
          repeatInterval: Number.POSITIVE_INFINITY,
        }),
      },
      {
        name: 'string',
        repeatFrequency: RepeatFrequency.DAILY,
        repeatInterval: '2',
        trigger: (timestamp: number) => ({
          type: TriggerType.TIMESTAMP,
          timestamp,
          repeatFrequency: RepeatFrequency.DAILY,
          repeatInterval: '2',
        }),
      },
      {
        name: 'without-repeat-frequency',
        repeatFrequency: null,
        repeatInterval: 2,
        trigger: (timestamp: number) => ({
          type: TriggerType.TIMESTAMP,
          timestamp,
          repeatInterval: 2,
        }),
      },
      {
        name: 'repeat-frequency-none',
        repeatFrequency: RepeatFrequency.NONE,
        repeatInterval: 2,
        trigger: (timestamp: number) => ({
          type: TriggerType.TIMESTAMP,
          timestamp,
          repeatFrequency: RepeatFrequency.NONE,
          repeatInterval: 2,
        }),
      },
    ];

    const results: F15Payload[] = [];

    for (const invalidCase of cases) {
      const notificationId = `${FEATURE_PREFIX}invalid-repeat-${invalidCase.name}`;
      const scheduledAt = Date.now() + 60_000;
      await notifee.cancelTriggerNotifications([notificationId]);

      try {
        await notifee.createTriggerNotification(
          {
            id: notificationId,
            title: `Feature #15 invalid ${invalidCase.name}`,
            body: 'This should be rejected',
            android: { channelId: CHANNEL_ID },
          },
          invalidCase.trigger(scheduledAt) as unknown as TimestampTrigger,
        );

        await notifee.cancelTriggerNotifications([notificationId]);

        const result = {
          scenario,
          case: invalidCase.name,
          ok: true,
          expectedFailure: true,
          unexpectedSuccess: true,
          notificationId,
          timestamp: scheduledAt,
          scheduledAt,
          repeatFrequency: invalidCase.repeatFrequency,
          repeatInterval: invalidCase.repeatInterval,
          repeatIntervalLabel: invalidCase.repeatIntervalLabel ?? null,
        };
        results.push(result);
        emit('RESULT', result);
      } catch (error) {
        const result = {
          scenario,
          case: invalidCase.name,
          ok: false,
          expectedFailure: true,
          rejected: true,
          notificationId,
          timestamp: scheduledAt,
          scheduledAt,
          repeatFrequency: invalidCase.repeatFrequency,
          repeatInterval: invalidCase.repeatInterval,
          repeatIntervalLabel: invalidCase.repeatIntervalLabel ?? null,
          message: errorMessage(error),
        };
        results.push(result);
        emit('RESULT', result);
      }
    }

    const rejected = results.filter(result => result.rejected === true).length;
    const unexpectedSuccesses = results.filter(result => result.unexpectedSuccess === true).length;

    emit('DONE', {
      scenario,
      ok: unexpectedSuccesses === 0,
      total: results.length,
      rejected,
      unexpectedSuccesses,
    });
  }, [emit]);

  const cancelFeatureTriggers = useCallback(async () => {
    const scenario = 'cancel-feature';
    const ids = await notifee.getTriggerNotificationIds();
    const featureIds = ids.filter(id => id.startsWith(FEATURE_PREFIX));

    if (featureIds.length > 0) {
      await notifee.cancelTriggerNotifications(featureIds);
    }

    const remainingIds = await notifee.getTriggerNotificationIds();
    const remainingFeatureIds = remainingIds.filter(id => id.startsWith(FEATURE_PREFIX));

    emit('DONE', {
      scenario,
      ok: true,
      beforeCount: ids.length,
      cancelledCount: featureIds.length,
      cancelledIds: featureIds,
      remainingFeatureIds,
    });
  }, [emit]);

  const requestNotificationPermission = useCallback(async () => {
    const scenario = 'request-permission';
    const settings = await notifee.requestPermission();

    emit('RESULT', {
      scenario,
      ok: true,
      settings,
    });
    emit('DONE', {
      scenario,
      ok: true,
    });
  }, [emit]);

  const getNotificationSettings = useCallback(async () => {
    const scenario = 'get-notification-settings';
    const settings = await notifee.getNotificationSettings();

    emit('RESULT', {
      scenario,
      ok: true,
      settings,
    });
    emit('DONE', {
      scenario,
      ok: true,
    });
  }, [emit]);

  const openAlarmPermissionSettings = useCallback(async () => {
    const scenario = 'open-alarm-permission-settings';
    await notifee.openAlarmPermissionSettings();

    emit('DONE', {
      scenario,
      ok: true,
    });
  }, [emit]);

  const runScenario = useCallback(
    async (scenario: string) => {
      if (busy) {
        emit('ERROR', {
          scenario,
          ok: false,
          message: 'another Feature #15 scenario is already running',
        });
        return;
      }

      setBusy(true);
      setLastScenario(scenario);
      emit('START', {
        scenario,
        ok: true,
        timestamp: Date.now(),
      });

      try {
        if (!VALID_SCENARIOS.has(scenario)) {
          emit('ERROR', {
            scenario,
            ok: false,
            message: `unknown Feature #15 scenario: ${scenario}`,
          });
          return;
        }

        switch (scenario) {
          case 'one-shot':
            await scheduleTimestampScenario(scenario, `${FEATURE_PREFIX}one-shot`);
            break;
          case 'daily-2':
            await scheduleTimestampScenario(
              scenario,
              `${FEATURE_PREFIX}daily-2`,
              RepeatFrequency.DAILY,
              2,
            );
            break;
          case 'weekly-2':
            await scheduleTimestampScenario(
              scenario,
              `${FEATURE_PREFIX}weekly-2`,
              RepeatFrequency.WEEKLY,
              2,
            );
            break;
          case 'monthly-3':
            await scheduleTimestampScenario(
              scenario,
              `${FEATURE_PREFIX}monthly-3`,
              RepeatFrequency.MONTHLY,
              3,
            );
            break;
          case 'invalid-monthly-workmanager':
            await runInvalidMonthlyWorkManager();
            break;
          case 'invalid-repeat-interval':
            await runInvalidRepeatIntervals();
            break;
          case 'dump-triggers':
            await dumpTriggers(scenario);
            emit('DONE', { scenario, ok: true });
            break;
          case 'cancel-feature':
            await cancelFeatureTriggers();
            break;
          case 'request-permission':
            await requestNotificationPermission();
            break;
          case 'get-notification-settings':
            await getNotificationSettings();
            break;
          case 'open-alarm-permission-settings':
            await openAlarmPermissionSettings();
            break;
        }
      } catch (error) {
        emit('ERROR', {
          scenario,
          ok: false,
          message: errorMessage(error),
        });
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      cancelFeatureTriggers,
      dumpTriggers,
      emit,
      getNotificationSettings,
      openAlarmPermissionSettings,
      requestNotificationPermission,
      runInvalidMonthlyWorkManager,
      runInvalidRepeatIntervals,
      scheduleTimestampScenario,
    ],
  );

  useEffect(() => {
    if (!request || lastRequestNonce.current === request.nonce) {
      return;
    }

    lastRequestNonce.current = request.nonce;
    runScenario(request.scenario);
  }, [request, runScenario]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <SmokeButton title="Back" onPress={onBack} disabled={busy} />
        <Text style={styles.title}>Feature #15 / Repeat Interval Tests</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={styles.status}>
          <Text style={styles.statusLabel}>Last scenario</Text>
          <Text style={styles.statusText}>{lastScenario}</Text>
          <Text style={styles.statusLabel}>Last result</Text>
          <Text style={styles.resultText}>{lastResult}</Text>
          <Text style={styles.instructions}>
            Deep link format: notifykit://feature15/run/&lt;scenario&gt;. Grant notification
            permission manually if Android shows the permission prompt.
          </Text>
        </View>

        <View style={styles.buttons}>
          <SmokeButton
            title="One-shot +60s"
            onPress={() => runScenario('one-shot')}
            disabled={busy}
          />
          <SmokeButton
            title="Daily repeatInterval 2 +60s"
            onPress={() => runScenario('daily-2')}
            disabled={busy}
          />
          <SmokeButton
            title="Weekly repeatInterval 2 +60s"
            onPress={() => runScenario('weekly-2')}
            disabled={busy}
          />
          <SmokeButton
            title="Monthly repeatInterval 3 +60s"
            onPress={() => runScenario('monthly-3')}
            disabled={busy}
          />
          <SmokeButton
            title="Invalid monthly WorkManager"
            onPress={() => runScenario('invalid-monthly-workmanager')}
            disabled={busy}
          />
          <SmokeButton
            title="Invalid repeatInterval cases"
            onPress={() => runScenario('invalid-repeat-interval')}
            disabled={busy}
          />
          <SmokeButton
            title="Dump trigger notifications"
            onPress={() => runScenario('dump-triggers')}
            disabled={busy}
          />
          <SmokeButton
            title="Cancel Feature #15 triggers"
            onPress={() => runScenario('cancel-feature')}
            disabled={busy}
          />
          <SmokeButton
            title="Request notification permission"
            onPress={() => runScenario('request-permission')}
            disabled={busy}
          />
          <SmokeButton
            title="Get notification settings"
            onPress={() => runScenario('get-notification-settings')}
            disabled={busy}
          />
          {Platform.OS === 'android' ? (
            <SmokeButton
              title="Open alarm permission settings"
              onPress={() => runScenario('open-alarm-permission-settings')}
              disabled={busy}
            />
          ) : (
            <Text style={styles.platformNote}>
              Exact alarm settings are Android-only. iOS uses the normal notification permission for
              local notifications.
            </Text>
          )}
        </View>

        <View style={styles.log}>
          {logLines.length === 0 ? (
            <Text style={styles.empty}>No F15 logs yet.</Text>
          ) : (
            logLines.map((line, index) => (
              <Text key={`${line}-${index}`} style={styles.line}>
                {line}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f5f5f5' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  title: { flex: 1, fontSize: 20, fontWeight: 'bold' },
  content: { flex: 1 },
  contentContainer: { paddingBottom: 24 },
  status: { marginBottom: 12 },
  statusLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#555',
    textTransform: 'uppercase',
    marginTop: 6,
  },
  statusText: { fontSize: 14, color: '#111', marginTop: 2 },
  resultText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#111',
    marginTop: 2,
  },
  instructions: { marginTop: 8, color: '#444', fontSize: 13 },
  buttons: { gap: 8, marginBottom: 12 },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    borderRadius: 6,
    backgroundColor: '#1565c0',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buttonPressed: { backgroundColor: '#0d47a1' },
  buttonDisabled: { backgroundColor: '#9e9e9e' },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  buttonTextDisabled: { color: '#eeeeee' },
  platformNote: {
    color: '#555',
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 2,
    paddingVertical: 6,
  },
  log: { flex: 1, minHeight: 220, backgroundColor: '#111', borderRadius: 6, padding: 8 },
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
