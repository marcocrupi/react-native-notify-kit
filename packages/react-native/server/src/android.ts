import type { NotifyKitAndroidOutput, NotifyKitOptions, NotifyKitPayloadInput } from './types';

type BuildAndroidContext = {
  collapseKey?: string;
  ttlSeconds?: number;
};

function toAndroidPriority(priority: NotifyKitOptions['androidPriority']): 'HIGH' | 'NORMAL' {
  return priority === 'normal' ? 'NORMAL' : 'HIGH';
}

export function buildAndroidPayload(
  input: NotifyKitPayloadInput,
  context: BuildAndroidContext,
): NotifyKitAndroidOutput {
  const options: NotifyKitOptions = input.options ?? {};
  const output: NotifyKitAndroidOutput = {
    priority: toAndroidPriority(options.androidPriority),
  };
  if (context.collapseKey !== undefined) {
    output.collapse_key = context.collapseKey;
  }
  if (context.ttlSeconds !== undefined) {
    output.ttl = `${context.ttlSeconds}s`;
  }
  return output;
}
