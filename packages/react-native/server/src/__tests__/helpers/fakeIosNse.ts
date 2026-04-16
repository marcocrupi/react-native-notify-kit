/**
 * Simulates what the Phase 3 iOS Notification Service Extension will do when
 * it receives an APNs payload built by `buildNotifyKitPayload`.
 *
 * iOS NSE receives `apns.payload`. It:
 *   1. Reads aps.alert.title / .body → notification title/body
 *   2. Reads apns.payload.notifee_options → JSON.parse → extract ios config
 *   3. Reads apns.payload.notifee_data if present → JSON.parse → notification.data
 *   4. Maps aps fields (sound, category, thread-id, badge, interruption-level)
 *      back to their camelCase equivalents
 */

import type { NotifyKitApnsPayload } from '../../types';

const INTERRUPTION_LEVEL_REVERSE: Record<string, string> = {
  passive: 'passive',
  active: 'active',
  'time-sensitive': 'timeSensitive',
  critical: 'critical',
};

export type ReconstructedIos = {
  title: string;
  body: string;
  data: Record<string, string> | undefined;
  ios: {
    sound?: string;
    categoryId?: string;
    threadId?: string;
    interruptionLevel?: string;
    attachments?: Array<{ url: string; identifier?: string }>;
  };
  iosBadgeCount?: number;
};

export function parseIosPayload(apnsPayload: NotifyKitApnsPayload): ReconstructedIos {
  const title = apnsPayload.aps.alert.title;
  const body = apnsPayload.aps.alert.body;

  // Reconstruct notification.data from notifee_data
  let data: Record<string, string> | undefined;
  if (apnsPayload.notifee_data) {
    data = JSON.parse(apnsPayload.notifee_data);
  }

  // Parse notifee_options for ios-specific config
  const notifeeOpts = JSON.parse(apnsPayload.notifee_options);
  const iosFromBlob = notifeeOpts.ios ?? {};

  // Reconstruct iOS config from both aps fields and the notifee_options blob
  const ios: ReconstructedIos['ios'] = {};

  if (apnsPayload.aps.sound !== undefined) {
    ios.sound = apnsPayload.aps.sound;
  }
  if (apnsPayload.aps.category !== undefined) {
    ios.categoryId = apnsPayload.aps.category;
  }
  if (apnsPayload.aps['thread-id'] !== undefined) {
    ios.threadId = apnsPayload.aps['thread-id'];
  }
  if (apnsPayload.aps['interruption-level'] !== undefined) {
    ios.interruptionLevel =
      INTERRUPTION_LEVEL_REVERSE[apnsPayload.aps['interruption-level']] ??
      apnsPayload.aps['interruption-level'];
  }
  // Attachments come from the blob, not from aps
  if (iosFromBlob.attachments !== undefined) {
    ios.attachments = iosFromBlob.attachments;
  }

  const result: ReconstructedIos = { title, body, ios };
  if (data !== undefined) {
    result.data = data;
  }
  if (apnsPayload.aps.badge !== undefined) {
    result.iosBadgeCount = apnsPayload.aps.badge;
  }

  return result;
}
