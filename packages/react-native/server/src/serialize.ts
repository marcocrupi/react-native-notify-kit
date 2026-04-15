import type { NotifyKitAndroidConfig, NotifyKitIosConfig, SerializedNotifeeOptions } from './types';

export type SerializeInput = {
  android?: NotifyKitAndroidConfig;
  ios?: NotifyKitIosConfig;
};

export function serializeNotifeeOptions(input: SerializeInput = {}): string {
  const payload: SerializedNotifeeOptions = { _v: 1 };
  if (input.android !== undefined) {
    payload.android = input.android;
  }
  if (input.ios !== undefined) {
    payload.ios = input.ios;
  }
  return JSON.stringify(payload);
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
