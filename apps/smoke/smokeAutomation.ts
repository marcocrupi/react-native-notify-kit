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

let smokeResultCallbackUrl: string | null = null;

export function smokeErrorReason(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  const message = String(error);
  return message.length > 0 ? message : 'unknown_error';
}

async function postSmokeResultCallback(callbackUrl: string, payload: SmokeResult): Promise<void> {
  try {
    await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error: unknown) {
    console.warn(`SMOKE:RESULT callback POST failed: ${smokeErrorReason(error)}`);
  }
}

export function setSmokeResultCallbackUrl(callbackUrl?: string | null): void {
  if (typeof callbackUrl === 'string' && callbackUrl.length > 0) {
    smokeResultCallbackUrl = callbackUrl;
    return;
  }

  smokeResultCallbackUrl = null;
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

  if (smokeResultCallbackUrl != null) {
    void postSmokeResultCallback(smokeResultCallbackUrl, payload);
  }
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
