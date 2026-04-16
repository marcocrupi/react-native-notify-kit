/**
 * FCM wire contract — shared between the server SDK (Node) and the upcoming
 * Phase 2 client `handleFcmMessage`. Types only, no runtime code.
 *
 * This module is the single source of truth for the shape of `notifee_options`
 * embedded in FCM data / APNs payloads. Both sides (server builder, client
 * reader) import from here to guarantee parity.
 *
 * NOT a public API. Consumers should use `react-native-notify-kit/server` for
 * building payloads and the main `react-native-notify-kit` module for client
 * handling. The `internal/` directory exists to hold cross-module contracts
 * that are not for end users.
 */

export type NotifyKitPressAction = {
  id: string;
  launchActivity?: string;
};

export type NotifyKitAndroidAction = {
  title: string;
  pressAction: NotifyKitPressAction;
  input?: boolean;
};

export type NotifyKitAndroidStyle =
  | { type: 'BIG_TEXT'; text: string }
  | { type: 'BIG_PICTURE'; picture: string };

export type NotifyKitAndroidConfig = {
  channelId?: string;
  smallIcon?: string;
  largeIcon?: string;
  color?: string;
  pressAction?: NotifyKitPressAction;
  actions?: NotifyKitAndroidAction[];
  style?: NotifyKitAndroidStyle;
};

export type NotifyKitIosAttachment = {
  url: string;
  identifier?: string;
};

export type NotifyKitIosInterruptionLevel = 'passive' | 'active' | 'timeSensitive' | 'critical';

export type NotifyKitIosConfig = {
  sound?: string;
  categoryId?: string;
  threadId?: string;
  interruptionLevel?: NotifyKitIosInterruptionLevel;
  attachments?: NotifyKitIosAttachment[];
};

export type NotifyKitNotification = {
  id?: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  android?: NotifyKitAndroidConfig;
  ios?: NotifyKitIosConfig;
};

export type NotifyKitOptions = {
  androidPriority?: 'high' | 'normal';
  iosBadgeCount?: number;
  ttl?: number;
  collapseKey?: string;
};

export type NotifyKitPayloadInput = {
  token?: string;
  topic?: string;
  condition?: string;
  notification: NotifyKitNotification;
  options?: NotifyKitOptions;
};

export type ApnsInterruptionLevel = 'passive' | 'active' | 'time-sensitive' | 'critical';

export type NotifyKitAndroidOutput = {
  priority: 'HIGH' | 'NORMAL';
  collapse_key?: string;
  ttl?: string;
};

export type NotifyKitApnsAps = {
  alert: { title: string; body: string };
  sound?: string;
  category?: string;
  'mutable-content': 1;
  'thread-id'?: string;
  'interruption-level'?: ApnsInterruptionLevel;
  badge?: number;
};

export type NotifyKitApnsHeaders = {
  'apns-push-type': 'alert';
  'apns-priority': '10';
  'apns-collapse-id'?: string;
  'apns-expiration'?: string;
};

export type NotifyKitApnsPayload = {
  aps: NotifyKitApnsAps;
  notifee_options: string;
  notifee_data?: string;
};

export type NotifyKitApnsOutput = {
  headers: NotifyKitApnsHeaders;
  payload: NotifyKitApnsPayload;
};

export type NotifyKitPayloadOutput = {
  token?: string;
  topic?: string;
  condition?: string;
  data: Record<string, string>;
  android: NotifyKitAndroidOutput;
  apns: NotifyKitApnsOutput;
  sizeBytes: number;
};

export type SerializedNotifeeOptions = {
  _v: 1;
  android?: NotifyKitAndroidConfig;
  ios?: NotifyKitIosConfig;
};

// Android output must never carry a `notification` field (the server enforces
// data-only delivery for Android to prevent FCM from auto-displaying). This
// invariant is exercised at runtime by the `never includes a notification
// field` test in buildPayload.test.ts and is enforced structurally by the
// shape of NotifyKitAndroidOutput above.
