import { buildAndroidPayload } from './android';
import { buildIosApnsPayload } from './ios';
import { serializeData, serializeNotifeeOptions } from './serialize';
import type { NotifyKitPayloadInput, NotifyKitPayloadOutput } from './types';
import { validateInput } from './validation';

const SIZE_WARN_THRESHOLD_BYTES = 3500;
const PREFIX = '[react-native-notify-kit/server]';

export function buildNotifyKitPayload(input: NotifyKitPayloadInput): NotifyKitPayloadOutput {
  validateInput(input);

  const { notification } = input;
  const options = input.options ?? {};

  const collapseKey: string | undefined = options.collapseKey ?? notification.id ?? undefined;

  let expiration: string | undefined;
  if (options.ttl !== undefined) {
    expiration = String(Math.floor(Date.now() / 1000) + options.ttl);
  }

  const notifeeOptions = serializeNotifeeOptions({
    ...(notification.android !== undefined ? { android: notification.android } : {}),
    ...(notification.ios !== undefined ? { ios: notification.ios } : {}),
  });
  const notifeeData = serializeData(notification.data);

  // Android path: top-level `data` carries `notification.data` keys verbatim
  // plus `notifee_options`. `notifee_data` is intentionally NOT duplicated here —
  // the client can read the original keys directly from `data`. iOS NSE still
  // receives `notifee_data` inside `apns.payload` because APNs does not expose
  // arbitrary top-level keys to the extension.
  const data: Record<string, string> = {
    ...(notification.data ?? {}),
    notifee_options: notifeeOptions,
  };

  const android = buildAndroidPayload(input, {
    ...(collapseKey !== undefined ? { collapseKey } : {}),
    ...(options.ttl !== undefined ? { ttlSeconds: options.ttl } : {}),
  });

  const apns = buildIosApnsPayload(input, {
    notifeeOptions,
    ...(notifeeData !== undefined ? { notifeeData } : {}),
    ...(collapseKey !== undefined ? { collapseKey } : {}),
    ...(expiration !== undefined ? { expiration } : {}),
  });

  const output: NotifyKitPayloadOutput = {
    data,
    android,
    apns,
  };
  if (input.token !== undefined) {
    output.token = input.token;
  } else if (input.topic !== undefined) {
    output.topic = input.topic;
  } else if (input.condition !== undefined) {
    output.condition = input.condition;
  }

  // FCM's 4 KB limit is measured in UTF-8 bytes, not JS code units, so emoji
  // and non-ASCII characters consume more than one byte each. Deviation from
  // the spec's literal `JSON.stringify(output).length` to avoid underestimating
  // payload size under such characters.
  const sizeBytes = Buffer.byteLength(JSON.stringify(output), 'utf8');
  if (sizeBytes > SIZE_WARN_THRESHOLD_BYTES) {
    console.warn(
      `${PREFIX} Payload size ${sizeBytes} bytes approaches FCM 4KB limit. Consider reducing notifee_options.`,
    );
  }

  return output;
}
