import type { NotifyKitAndroidConfig, NotifyKitIosConfig, SerializedNotifeeOptions } from './types';

type SerializeInput = {
  android?: NotifyKitAndroidConfig;
  ios?: NotifyKitIosConfig;
};

const PREFIX = '[react-native-notify-kit/server]';

export function serializeNotifeeOptions(input: SerializeInput = {}): string {
  const payload: SerializedNotifeeOptions = { _v: 1 };
  if (input.android !== undefined) {
    payload.android = input.android;
  }
  if (input.ios !== undefined) {
    payload.ios = input.ios;
  }
  try {
    return JSON.stringify(payload);
  } catch (e: unknown) {
    const detail = e instanceof Error ? `: ${e.message}` : `: ${String(e)}`;
    throw new Error(
      `${PREFIX} Serialization: notifee_options contains circular references or non-serializable values. Check for circular object references in android/ios config${detail}`,
    );
  }
}

export function serializeData(data?: Record<string, string>): string | undefined {
  if (!data) {
    return undefined;
  }
  const keys = Object.keys(data);
  if (keys.length === 0) {
    return undefined;
  }
  return JSON.stringify(data);
}
