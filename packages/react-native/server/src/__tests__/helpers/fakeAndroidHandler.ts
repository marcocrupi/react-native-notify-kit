/**
 * Simulates what the Phase 2 Android `handleFcmMessage` will do when it
 * receives a data-only FCM message built by `buildNotifyKitPayload`.
 *
 * Android receives the top-level `data` field. It:
 *   1. Reads `data.notifee_options` → JSON.parse → extract title, body,
 *      and android display config
 *   2. Reads remaining `data.*` keys (non-reserved) → rebuild notification.data
 */

import type { NotifyKitPayloadOutput } from '../../types';

const RESERVED_DATA_KEYS = new Set(['notifee_options', 'notifee_data']);

export type ReconstructedAndroid = {
  title: string;
  body: string;
  data: Record<string, string>;
  android: Record<string, unknown> | undefined;
};

export function parseAndroidPayload(output: NotifyKitPayloadOutput): ReconstructedAndroid {
  const rawOptions = output.data.notifee_options;
  const parsed = JSON.parse(rawOptions as string);

  const title: string = parsed.title;
  const body: string = parsed.body;
  const android: Record<string, unknown> | undefined = parsed.android;

  // Rebuild user data by filtering out reserved keys
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(output.data)) {
    if (!RESERVED_DATA_KEYS.has(key)) {
      data[key] = value;
    }
  }

  return { title, body, data, android };
}
