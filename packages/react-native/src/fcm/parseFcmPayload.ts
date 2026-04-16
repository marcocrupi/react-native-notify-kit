/*
 * Pure function — parses the `notifee_options` blob from an FCM data payload.
 */

const PREFIX = '[react-native-notify-kit]';

export type ParsedPayload = {
  _v?: number;
  title?: string;
  body?: string;
  android?: Record<string, unknown>;
  ios?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * Extracts and JSON-parses the `notifee_options` value from the FCM data map.
 * Returns the parsed object on success, or `null` when:
 *  - `data` is undefined/null
 *  - `data.notifee_options` is missing
 *  - JSON parsing fails (a `console.warn` is emitted)
 */
export function parseFcmPayload(data: Record<string, string> | undefined): ParsedPayload | null {
  if (!data || typeof data.notifee_options !== 'string') {
    return null;
  }

  let parsed: ParsedPayload;
  try {
    parsed = JSON.parse(data.notifee_options);
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    console.warn(
      `${PREFIX} Failed to parse notifee_options: ${detail}. Falling back to raw title/body.`,
    );
    return null;
  }

  if (parsed === null || typeof parsed !== 'object') {
    console.warn(
      `${PREFIX} notifee_options parsed to a non-object value. Falling back to raw title/body.`,
    );
    return null;
  }

  // Version check (Rule C5)
  const version = parsed._v;
  if (typeof version === 'number' && version > 1) {
    console.warn(
      `${PREFIX} notifee_options version ${version} is newer than supported version 1. Display may be incomplete.`,
    );
  }

  return parsed;
}
