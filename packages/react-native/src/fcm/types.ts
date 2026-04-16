/*
 * Types for the FCM message handler. Declared structurally to avoid a peer
 * dependency on @react-native-firebase/messaging.
 */

/**
 * Minimal subset of `@react-native-firebase/messaging`'s RemoteMessage that
 * `handleFcmMessage` actually reads.
 */
export type FcmRemoteMessage = {
  messageId?: string;
  data?: Record<string, string>;
  notification?: {
    title?: string;
    body?: string;
  };
};

/**
 * Configuration for `handleFcmMessage`. Call `setFcmConfig` once
 * at app startup (typically in `index.js` before `registerComponent`).
 */
export type FcmConfig = {
  /**
   * Default channelId used when `notifee_options.android.channelId` is absent.
   * If this is also absent and the payload has no channelId,
   * `displayNotification` will throw on Android — same behavior as calling
   * `displayNotification` without a channel.
   */
  defaultChannelId?: string;

  /**
   * Default pressAction when `notifee_options.android.pressAction` is absent.
   * Mirrors the existing behavior: `{ id: 'default', launchActivity: 'default' }`.
   */
  defaultPressAction?: { id: string; launchActivity?: string };

  /**
   * What to do when `remoteMessage.data.notifee_options` is absent entirely.
   * - `'display'`: build a minimal notification from `remoteMessage.notification`
   *   title/body (or `data.title`/`data.body` as a fallback). Uses `defaultChannelId`.
   * - `'ignore'`: return `null` without displaying anything.
   *
   * @default 'display'
   */
  fallbackBehavior?: 'display' | 'ignore';

  /** iOS-specific options. */
  ios?: {
    /**
     * When `true`, foreground notifications delivered via `handleFcmMessage`
     * are NOT displayed (only events are emitted).
     * @default false
     */
    suppressForegroundBanner?: boolean;
  };
};
