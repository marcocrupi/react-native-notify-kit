export type SmokeStatus = 'PASS' | 'FAIL';

export type SmokeResult = {
  scenario: string;
  status: SmokeStatus;
  timestamp?: string;
  id?: string;
  reason?: string;
  [key: string]: unknown;
};

export type SmokeEvent = {
  type: string;
  timestamp?: string;
  source?: string;
  notification?: {
    id?: string | null;
  };
  pressAction?: {
    id?: string | null;
  };
  [key: string]: unknown;
};

export function smokeErrorReason(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  const message = String(error);
  return message.length > 0 ? message : 'unknown_error';
}

export function logSmokeResult(result: SmokeResult) {
  const { scenario, status, timestamp, ...rest } = result;
  const payload = {
    scenario,
    status,
    timestamp: timestamp ?? new Date().toISOString(),
    ...rest,
  };

  console.log(`SMOKE:RESULT ${JSON.stringify(payload)}`);
}

export function logSmokeEvent(event: SmokeEvent) {
  const { type, timestamp, ...rest } = event;
  const payload = {
    type,
    timestamp: timestamp ?? new Date().toISOString(),
    ...rest,
  };

  console.log(`SMOKE:EVENT ${JSON.stringify(payload)}`);
}
