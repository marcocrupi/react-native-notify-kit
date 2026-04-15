// Source of truth: packages/react-native/src/internal/fcmContract.ts
// Re-exported here so the server SDK can be consumed via
// `react-native-notify-kit/server` without a deep import of the internal path.
// The shared file is included in the server tsconfig via a relative path.
export type {
  NotifyKitPressAction,
  NotifyKitAndroidAction,
  NotifyKitAndroidStyle,
  NotifyKitAndroidConfig,
  NotifyKitIosAttachment,
  NotifyKitIosInterruptionLevel,
  NotifyKitIosConfig,
  NotifyKitNotification,
  NotifyKitOptions,
  NotifyKitPayloadInput,
  ApnsInterruptionLevel,
  NotifyKitAndroidOutput,
  NotifyKitApnsAps,
  NotifyKitApnsHeaders,
  NotifyKitApnsPayload,
  NotifyKitApnsOutput,
  NotifyKitPayloadOutput,
  SerializedNotifeeOptions,
  _AssertAndroidHasNoNotification,
} from '../../src/internal/fcmContract';
