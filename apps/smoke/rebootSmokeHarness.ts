import { Platform } from 'react-native';
import notifee, { AlarmType, AndroidImportance, TriggerType } from 'react-native-notify-kit';
import type { TimestampTrigger, TriggerNotification } from 'react-native-notify-kit';

type RebootSmokeAction = 'schedule' | 'dump' | 'cancel';
type RebootSmokeAlarmTypeName = 'setExactAndAllowWhileIdle' | 'setAlarmClock';

export type RebootSmokeDeepLinkRequest =
  | {
      action: RebootSmokeAction;
      path: string;
      query: Record<string, string>;
      url: string;
    }
  | {
      action: 'error';
      path: string;
      query: Record<string, string>;
      reason: string;
      url: string;
    };

type RebootSmokeScheduleParams = {
  count: 1 | 5 | 50;
  delaySeconds: number;
  spacingSeconds: number;
  alarmTypeName: RebootSmokeAlarmTypeName;
  alarmType: AlarmType;
};

type TriggerSummary = {
  notificationId: string | null;
  title: string | null;
  timestamp: unknown;
  alarmManager: unknown;
};

const REBOOT_SMOKE_PREFIX = 'notifykit://reboot-smoke';
const REBOOT_SMOKE_CHANNEL_ID = 'reboot_smoke';
const REBOOT_SMOKE_NOTIFICATION_PREFIX = 'reboot-smoke-harness-';
const REBOOT_SMOKE_DATA_MARKER = 'reboot-smoke';
const VALID_COUNTS = [1, 5, 50] as const;
const DEFAULT_COUNT = 1;
const DEFAULT_DELAY_SECONDS = 300;
const DEFAULT_SPACING_SECONDS = 5;

function decodeRebootSmokeComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function parseRebootSmokeQuery(queryString: string): Record<string, string> {
  if (queryString.length === 0) {
    return {};
  }

  return queryString.split('&').reduce<Record<string, string>>((query, part) => {
    if (part.length === 0) {
      return query;
    }

    const separatorIndex = part.indexOf('=');
    const rawKey = separatorIndex === -1 ? part : part.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? '' : part.slice(separatorIndex + 1);
    query[decodeRebootSmokeComponent(rawKey)] = decodeRebootSmokeComponent(rawValue);
    return query;
  }, {});
}

function emitRebootSmoke(marker: string, payload: Record<string, unknown>): void {
  console.log(`REBOOT-SMOKE:${marker} ${JSON.stringify({ loggedAt: Date.now(), ...payload })}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}

function emitRebootSmokeError(payload: Record<string, unknown>): void {
  emitRebootSmoke('ERROR', { status: 'FAIL', ...payload });
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number | null {
  if (raw == null || raw.trim().length === 0) {
    return fallback;
  }

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

function parseAlarmType(raw: string | undefined): {
  alarmTypeName: RebootSmokeAlarmTypeName;
  alarmType: AlarmType;
} | null {
  const alarmTypeName = raw?.trim() || 'setExactAndAllowWhileIdle';

  switch (alarmTypeName) {
    case 'setExactAndAllowWhileIdle':
      return {
        alarmTypeName,
        alarmType: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE,
      };
    case 'setAlarmClock':
      return {
        alarmTypeName,
        alarmType: AlarmType.SET_ALARM_CLOCK,
      };
    default:
      return null;
  }
}

function parseScheduleParams(query: Record<string, string>): RebootSmokeScheduleParams | null {
  const count = parsePositiveInteger(query.count, DEFAULT_COUNT);
  if (count == null || !VALID_COUNTS.includes(count as 1 | 5 | 50)) {
    emitRebootSmokeError({
      action: 'schedule',
      reason: 'invalid_count',
      rawCount: query.count ?? null,
      allowed: VALID_COUNTS,
    });
    return null;
  }

  const delaySeconds = parsePositiveInteger(query.delaySeconds, DEFAULT_DELAY_SECONDS);
  if (delaySeconds == null || delaySeconds <= 0) {
    emitRebootSmokeError({
      action: 'schedule',
      reason: 'invalid_delay_seconds',
      rawDelaySeconds: query.delaySeconds ?? null,
    });
    return null;
  }

  const spacingSeconds = parsePositiveInteger(query.spacingSeconds, DEFAULT_SPACING_SECONDS);
  if (spacingSeconds == null || spacingSeconds <= 0) {
    emitRebootSmokeError({
      action: 'schedule',
      reason: 'invalid_spacing_seconds',
      rawSpacingSeconds: query.spacingSeconds ?? null,
    });
    return null;
  }

  const alarmType = parseAlarmType(query.alarmType);
  if (alarmType == null) {
    emitRebootSmokeError({
      action: 'schedule',
      reason: 'invalid_alarm_type',
      rawAlarmType: query.alarmType ?? null,
      allowed: ['setExactAndAllowWhileIdle', 'setAlarmClock'],
    });
    return null;
  }

  return {
    count: count as 1 | 5 | 50,
    delaySeconds,
    spacingSeconds,
    alarmTypeName: alarmType.alarmTypeName,
    alarmType: alarmType.alarmType,
  };
}

function isRebootSmokeNotificationId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.startsWith(REBOOT_SMOKE_NOTIFICATION_PREFIX);
}

function isRebootSmokeHarnessTriggerNotification(item: TriggerNotification): boolean {
  return (
    item.notification.data?.smokeHarness === REBOOT_SMOKE_DATA_MARKER ||
    isRebootSmokeNotificationId(item.notification.id)
  );
}

function summarizeTriggerNotification(item: TriggerNotification): TriggerSummary {
  const trigger = item.trigger as unknown as Record<string, unknown>;

  return {
    notificationId: item.notification.id ?? null,
    title: item.notification.title ?? null,
    timestamp: trigger.timestamp ?? null,
    alarmManager: trigger.alarmManager ?? null,
  };
}

async function ensureRebootSmokeChannel(): Promise<void> {
  await notifee.createChannel({
    id: REBOOT_SMOKE_CHANNEL_ID,
    name: 'Reboot Smoke',
    importance: AndroidImportance.HIGH,
  });
}

async function scheduleRebootSmokeTriggers(query: Record<string, string>): Promise<void> {
  if (Platform.OS !== 'android') {
    emitRebootSmokeError({
      action: 'schedule',
      reason: 'android_only',
      platform: Platform.OS,
    });
    return;
  }

  const params = parseScheduleParams(query);
  if (params == null) {
    return;
  }

  const runId = String(Date.now());
  emitRebootSmoke('PARAMS', {
    action: 'schedule',
    runId,
    count: params.count,
    delaySeconds: params.delaySeconds,
    spacingSeconds: params.spacingSeconds,
    alarmType: params.alarmTypeName,
  });

  await ensureRebootSmokeChannel();
  emitRebootSmoke('CHANNEL_OK', {
    action: 'schedule',
    channelId: REBOOT_SMOKE_CHANNEL_ID,
  });

  const baseTimestamp = Date.now() + params.delaySeconds * 1000;
  const scheduled: Array<{
    id: string;
    index: number;
    timestamp: number;
    fireTimeIso: string;
  }> = [];

  for (let index = 1; index <= params.count; index += 1) {
    const timestamp = baseTimestamp + (index - 1) * params.spacingSeconds * 1000;

    if (timestamp <= Date.now()) {
      emitRebootSmokeError({
        action: 'schedule',
        reason: 'timestamp_not_future',
        runId,
        index,
        timestamp,
      });
      return;
    }

    const fireTimeIso = new Date(timestamp).toISOString();
    const id = `${REBOOT_SMOKE_NOTIFICATION_PREFIX}${runId}-${index}-${timestamp}`;
    const trigger: TimestampTrigger = {
      type: TriggerType.TIMESTAMP,
      timestamp,
      alarmManager: { type: params.alarmType },
    };
    const createdId = await notifee.createTriggerNotification(
      {
        id,
        title: 'Reboot smoke',
        body: `Trigger ${index}/${params.count} at ${fireTimeIso}`,
        data: {
          smokeHarness: REBOOT_SMOKE_DATA_MARKER,
          runId,
          index: String(index),
          count: String(params.count),
          alarmType: params.alarmTypeName,
          timestamp: String(timestamp),
          fireTimeIso,
        },
        android: {
          channelId: REBOOT_SMOKE_CHANNEL_ID,
          pressAction: { id: 'default', launchActivity: 'default' },
        },
      },
      trigger,
    );

    const item = {
      id: createdId,
      index,
      timestamp,
      fireTimeIso,
    };
    scheduled.push(item);
    emitRebootSmoke('SCHEDULED', {
      action: 'schedule',
      runId,
      count: params.count,
      alarmType: params.alarmTypeName,
      ...item,
    });
  }

  emitRebootSmoke('RESULT', {
    action: 'schedule',
    status: 'PASS',
    runId,
    scheduledCount: scheduled.length,
    alarmType: params.alarmTypeName,
    firstTimestamp: scheduled[0]?.timestamp ?? null,
    lastTimestamp: scheduled[scheduled.length - 1]?.timestamp ?? null,
    ids: scheduled.map(item => item.id),
  });
}

async function dumpRebootSmokeTriggers(): Promise<void> {
  const triggerNotifications = await notifee.getTriggerNotifications();
  const triggers = triggerNotifications
    .filter(isRebootSmokeHarnessTriggerNotification)
    .map(summarizeTriggerNotification);

  emitRebootSmoke('DUMP', {
    action: 'dump',
    status: 'PASS',
    count: triggers.length,
    ids: triggers.map(item => item.notificationId),
    triggers,
  });
}

async function cancelRebootSmokeTriggers(): Promise<void> {
  const triggerNotifications = await notifee.getTriggerNotifications();
  const ids = triggerNotifications
    .filter(isRebootSmokeHarnessTriggerNotification)
    .map(item => item.notification.id ?? null)
    .filter((id): id is string => typeof id === 'string');

  if (ids.length > 0) {
    await notifee.cancelTriggerNotifications(ids);
  }

  emitRebootSmoke('RESULT', {
    action: 'cancel',
    status: 'PASS',
    canceledCount: ids.length,
    ids,
  });
}

export function extractRebootSmokeDeepLink(url: string): RebootSmokeDeepLinkRequest | null {
  if (!url.startsWith(REBOOT_SMOKE_PREFIX)) {
    return null;
  }

  const rawRemainder = url.slice(REBOOT_SMOKE_PREFIX.length);
  if (
    rawRemainder.length > 0 &&
    !rawRemainder.startsWith('/') &&
    !rawRemainder.startsWith('?') &&
    !rawRemainder.startsWith('#')
  ) {
    return null;
  }

  const withoutFragment = rawRemainder.split('#')[0];
  const queryStart = withoutFragment.indexOf('?');
  const rawPath = queryStart === -1 ? withoutFragment : withoutFragment.slice(0, queryStart);
  const queryString = queryStart === -1 ? '' : withoutFragment.slice(queryStart + 1);
  const path = rawPath.replace(/^\/+/, '');
  const query = parseRebootSmokeQuery(queryString);
  const action = path.split('/').filter(Boolean).map(decodeRebootSmokeComponent)[0];

  switch (action) {
    case 'schedule':
    case 'dump':
    case 'cancel':
      return { action, path, query, url };
    default:
      return {
        action: 'error',
        path,
        query,
        reason: 'unsupported_reboot_smoke_path',
        url,
      };
  }
}

export async function executeRebootSmokeDeepLink(
  request: RebootSmokeDeepLinkRequest,
): Promise<void> {
  emitRebootSmoke('START', {
    action: request.action,
    path: request.path,
  });

  try {
    switch (request.action) {
      case 'schedule':
        await scheduleRebootSmokeTriggers(request.query);
        break;
      case 'dump':
        await dumpRebootSmokeTriggers();
        break;
      case 'cancel':
        await cancelRebootSmokeTriggers();
        break;
      case 'error':
        emitRebootSmokeError({
          action: 'deep-link',
          reason: request.reason,
          path: request.path,
        });
        break;
    }
  } catch (error: unknown) {
    const marker = request.action === 'dump' ? 'DUMP_ERROR' : 'ERROR';
    emitRebootSmoke(marker, {
      action: request.action,
      status: 'FAIL',
      reason: errorMessage(error),
    });
  }
}
