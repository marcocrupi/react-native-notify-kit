import type {
  ApnsInterruptionLevel,
  NotifyKitApnsAps,
  NotifyKitApnsHeaders,
  NotifyKitApnsOutput,
  NotifyKitIosInterruptionLevel,
  NotifyKitNotification,
  NotifyKitOptions,
  NotifyKitPayloadInput,
} from './types';

const INTERRUPTION_LEVEL_MAP: Record<NotifyKitIosInterruptionLevel, ApnsInterruptionLevel> = {
  passive: 'passive',
  active: 'active',
  timeSensitive: 'time-sensitive',
  critical: 'critical',
};

const PREFIX = '[react-native-notify-kit/server]';

export function toApnsInterruptionLevel(
  level: NotifyKitIosInterruptionLevel,
): ApnsInterruptionLevel {
  const mapped = INTERRUPTION_LEVEL_MAP[level as NotifyKitIosInterruptionLevel];
  if (mapped === undefined) {
    throw new Error(
      `${PREFIX} Validation: invalid interruptionLevel '${String(level)}'. Expected one of: passive, active, timeSensitive, critical`,
    );
  }
  return mapped;
}

type BuildIosContext = {
  notifeeOptions: string;
  notifeeData?: string;
  collapseKey?: string;
  expiration?: string;
};

export function buildIosApnsPayload(
  input: NotifyKitPayloadInput,
  context: BuildIosContext,
): NotifyKitApnsOutput {
  const notification: NotifyKitNotification = input.notification;
  const options: NotifyKitOptions = input.options ?? {};
  const ios = notification.ios;

  const headers: NotifyKitApnsHeaders = {
    'apns-push-type': 'alert',
    'apns-priority': '10',
  };
  if (context.collapseKey !== undefined) {
    if (Buffer.byteLength(context.collapseKey, 'utf8') > 64) {
      throw new Error(`${PREFIX} Validation: apns-collapse-id must be at most 64 UTF-8 bytes`);
    }
    headers['apns-collapse-id'] = context.collapseKey;
  }
  if (context.expiration !== undefined) {
    headers['apns-expiration'] = context.expiration;
  }

  const aps: NotifyKitApnsAps = {
    alert: {
      title: notification.title,
      body: notification.body,
      ...(notification.subtitle !== undefined ? { subtitle: notification.subtitle } : {}),
    },
    'mutable-content': 1,
  };
  if (ios?.sound !== undefined) {
    aps.sound = ios.sound;
  }
  if (ios?.categoryId !== undefined) {
    aps.category = ios.categoryId;
  }
  if (ios?.threadId !== undefined) {
    aps['thread-id'] = ios.threadId;
  }
  if (ios?.interruptionLevel !== undefined) {
    aps['interruption-level'] = toApnsInterruptionLevel(ios.interruptionLevel);
  }
  if (options.iosBadgeCount !== undefined) {
    aps.badge = options.iosBadgeCount;
  }

  const payload: NotifyKitApnsOutput['payload'] = {
    aps,
    notifee_options: context.notifeeOptions,
  };
  if (context.notifeeData !== undefined) {
    payload.notifee_data = context.notifeeData;
  }

  return { headers, payload };
}
