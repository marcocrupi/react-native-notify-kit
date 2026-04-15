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

export function toApnsInterruptionLevel(
  level: NotifyKitIosInterruptionLevel,
): ApnsInterruptionLevel {
  return INTERRUPTION_LEVEL_MAP[level];
}

export type BuildIosContext = {
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
    headers['apns-collapse-id'] = context.collapseKey;
  }
  if (context.expiration !== undefined) {
    headers['apns-expiration'] = context.expiration;
  }

  const aps: NotifyKitApnsAps = {
    alert: { title: notification.title, body: notification.body },
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
