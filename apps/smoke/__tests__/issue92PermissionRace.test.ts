import {
  createIssue92Harness,
  createSmokePermissionAdmission,
  R5_DURATION_MS,
  R5_SESSION_CAPACITY,
} from '../issue92PermissionRace';

const clock = globalThis as typeof globalThis & { performance: { now: () => number } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function fixture(onEvent?: (event: Record<string, unknown>) => void) {
  const permission = deferred<{ authorizationStatus: number }>();
  let authorizationStatus = 0;
  const resolvePermission = permission.resolve;
  permission.resolve = settings => {
    authorizationStatus = settings.authorizationStatus;
    resolvePermission(settings);
  };
  const events: Record<string, unknown>[] = [];
  const results: Record<string, unknown>[] = [];
  const api = {
    getNotificationSettings: jest.fn(async () => ({ authorizationStatus })),
    shouldShowRequestPermissionRationale: jest.fn(async () => false),
    requestPermission: jest.fn(() => permission.promise),
  };
  const harness = createIssue92Harness({
    api,
    supported: () => true,
    now: () => clock.performance.now(),
    event: event => {
      events.push(event);
      onEvent?.(event);
    },
    result: result => results.push(result),
  });
  const run = harness.start('r5-1')!;
  const animate = jest.fn(() => run.dispatched());
  const stop = jest.fn();
  run.attach(animate, stop);
  const layout = () => {
    run.layout('source');
    run.layout('destination');
  };
  const moving = async () => {
    layout();
    await flush();
    jest.advanceTimersByTime(16);
    run.progress(0.02);
    run.departureLayoutObserved();
    jest.advanceTimersByTime(160);
    run.progress(0.15);
    jest.advanceTimersByTime(40);
  };
  return { harness, run, api, permission, events, results, animate, stop, layout, moving };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('waits for both layout callbacks and pre-state; orders measured invocation, settlement, post-state and completion', async () => {
  const f = fixture();
  // Layout arrives before the async pre-state: start marker order must still hold.
  expect(f.animate).not.toHaveBeenCalled();
  await f.moving();
  expect(f.api.requestPermission).toHaveBeenCalledTimes(1);
  const requested = f.events.find(e => e.type === 'R5_PERMISSION_REQUESTED')!;
  expect(requested).toMatchObject({ observedDelayMs: 200, sinceDispatchMs: 216, progress: 0.15 });
  expect(f.results).toEqual([]);
  f.permission.resolve({ authorizationStatus: 1 });
  await flush();
  expect(f.results).toEqual([]); // A resolved permission alone is insufficient.
  jest.advanceTimersByTime(R5_DURATION_MS - 216);
  f.run.transitionEnded(true);
  expect(f.events.map(e => e.type)).toEqual([
    'R5_SCENARIO_STARTED',
    'R5_PERMISSION_STATE_BEFORE',
    'R5_TRANSITION_DISPATCHED',
    'R5_FIRST_PROGRESS_RECEIVED',
    'R5_DEPARTURE_LAYOUT_OBSERVED',
    'R5_PERMISSION_REQUESTED',
    'R5_PERMISSION_RESOLVED',
    'R5_PERMISSION_STATE_AFTER',
    'R5_TRANSITION_ENDED',
    'R5_SCENARIO_COMPLETED',
  ]);
  expect(f.events.every(e => e.id === 'r5-1' && typeof e.monotonicMs === 'number')).toBe(true);
  expect(f.results).toEqual([
    expect.objectContaining({ status: 'PASS', dialogObserved: 'UNKNOWN' }),
  ]);
});

test.each(['no-progress', 'stale-progress', 'no-hierarchy', 'late-timer', 'ended'])(
  'cannot PASS or invoke permission with invalid transition evidence: %s',
  async mode => {
    const f = fixture();
    f.layout();
    await flush();
    if (mode === 'no-progress') {
      jest.advanceTimersByTime(5000);
    } else {
      f.run.progress(0.01);
      if (mode !== 'no-hierarchy') f.run.departureLayoutObserved();
      if (mode === 'ended') f.run.transitionEnded(true);
      if (mode === 'late-timer') {
        // Advance the monotonic clock without executing the scheduled timer on time.
        jest.spyOn(clock.performance, 'now').mockReturnValue(600);
      }
      jest.advanceTimersByTime(150);
      if (mode !== 'stale-progress') f.run.progress(0.2);
      jest.advanceTimersByTime(50);
      jest.restoreAllMocks();
    }
    expect(f.api.requestPermission).not.toHaveBeenCalled();
    expect(f.results).toEqual([expect.objectContaining({ status: 'FAIL' })]);
  },
);

test('timeout is terminal FAIL; repetitions stay blocked until late settlement and never turn into PASS', async () => {
  const f = fixture();
  await f.moving();
  f.run.transitionEnded(true);
  expect(f.harness.start('r5-overlap')).toBeNull();
  jest.advanceTimersByTime(30000);
  expect(f.events.map(e => e.type)).toContain('R5_TIMEOUT');
  expect(f.results).toEqual([
    expect.objectContaining({ status: 'FAIL', reason: 'permission_timeout' }),
  ]);
  expect(f.harness.start('r5-still-pending')).toBeNull();
  f.permission.resolve({ authorizationStatus: 0 });
  await flush();
  expect(f.events).toContainEqual(
    expect.objectContaining({ type: 'R5_PERMISSION_RESOLVED', late: true }),
  );
  expect(f.results).toHaveLength(1);
  expect(f.harness.start('r5-next')).not.toBeNull();
});

test.each([false, true])('rejection/throw is FAIL and sanitized, synchronous=%s', async sync => {
  const f = fixture();
  if (sync)
    f.api.requestPermission.mockImplementation(() => {
      throw new Error('native\nerror');
    });
  await f.moving();
  if (!sync) f.permission.reject(new Error('native\nerror'));
  await flush();
  expect(f.events).toContainEqual(
    expect.objectContaining({
      type: 'R5_PERMISSION_REJECTED',
      error: { name: 'Error', message: 'native error' },
    }),
  );
  expect(f.results).toEqual([
    expect.objectContaining({ status: 'FAIL', reason: 'permission_rejected' }),
  ]);
  expect(f.api.getNotificationSettings).toHaveBeenCalledTimes(2);
});

test('unmount cancels timers before invocation and ignores stale callbacks', async () => {
  const f = fixture();
  f.layout();
  await flush();
  f.run.progress(0.1);
  f.run.cancel();
  f.run.progress(0.3);
  f.run.departureLayoutObserved();
  f.run.transitionEnded(true);
  jest.advanceTimersByTime(40000);
  expect(f.api.requestPermission).not.toHaveBeenCalled();
  expect(f.results).toEqual([expect.objectContaining({ status: 'FAIL', reason: 'unmounted' })]);
  expect(f.stop).toHaveBeenCalledTimes(1);
});

test('unmount during pending request keeps lock; late rejection is handled without new terminal result', async () => {
  const f = fixture();
  await f.moving();
  f.run.cancel();
  expect(f.harness.start('blocked')).toBeNull();
  f.permission.reject(new Error('late'));
  await flush();
  expect(f.results).toHaveLength(1);
  expect(f.harness.start('next')).not.toBeNull();
});

test('late pre-state cannot start an animation after cancellation', async () => {
  const f = fixture();
  f.layout();
  f.run.cancel();
  await flush();
  expect(f.animate).not.toHaveBeenCalled();
});

test('missing post-state and interrupted animation cannot PASS', async () => {
  const f = fixture();
  await f.moving();
  f.api.getNotificationSettings.mockReturnValue(new Promise(() => undefined));
  f.permission.resolve({ authorizationStatus: 1 });
  await flush();
  f.run.transitionEnded(false);
  expect(f.results).toEqual([expect.objectContaining({ status: 'FAIL' })]);
});

test('pre-state rejection is terminal without animation or permission invocation', async () => {
  const f = fixture();
  f.api.getNotificationSettings.mockRejectedValueOnce(new Error('state unavailable'));
  // The first read already began at attach; apply the failure to the next run.
  f.run.cancel();
  const next = f.harness.start('pre-state-failure')!;
  next.layout('source');
  next.layout('destination');
  next.attach(jest.fn(), jest.fn());
  await flush();
  expect(f.api.requestPermission).not.toHaveBeenCalled();
  expect(f.results.at(-1)).toMatchObject({ status: 'FAIL', reason: 'before_state_failed' });
});

test('missing post-state times out and cannot PASS even after native animation completion', async () => {
  const f = fixture();
  await f.moving();
  f.api.getNotificationSettings.mockReturnValue(new Promise(() => undefined));
  f.permission.resolve({ authorizationStatus: 1 });
  await flush();
  f.run.transitionEnded(true);
  jest.advanceTimersByTime(5000);
  expect(f.results).toEqual([
    expect.objectContaining({ status: 'FAIL', reason: 'post_state_or_transition_timeout' }),
  ]);
});

test('duplicate callbacks cannot invoke twice and a completed ID cannot immediately replay', async () => {
  const f = fixture();
  await f.moving();
  f.run.progress(0.3);
  f.run.layout('source');
  f.run.dispatched();
  f.run.departureLayoutObserved();
  f.permission.resolve({ authorizationStatus: 1 });
  await flush();
  f.run.transitionEnded(true);
  f.run.transitionEnded(true);
  jest.advanceTimersByTime(40000);
  expect(f.api.requestPermission).toHaveBeenCalledTimes(1);
  expect(f.results).toHaveLength(1);
  expect(f.harness.start('r5-1')).toBeNull();
});

test('an admitted screen that never mounts expires without requesting permission', () => {
  const f = fixture();
  f.run.cancel();
  f.harness.start('never-mounted');
  jest.advanceTimersByTime(5000);
  expect(f.results.at(-1)).toMatchObject({ status: 'FAIL', reason: 'screen_mount_timeout' });
  expect(f.api.requestPermission).not.toHaveBeenCalled();
});

test.each(['unsupported', 'missing-clock'])('%s fails closed before pre-state read', async mode => {
  const api = {
    getNotificationSettings: jest.fn(),
    shouldShowRequestPermissionRationale: jest.fn(),
    requestPermission: jest.fn(),
  };
  const result = jest.fn();
  const h = createIssue92Harness({
    api,
    supported: () => mode !== 'unsupported',
    now: () => (mode === 'missing-clock' ? NaN : 0),
    event: jest.fn(),
    result,
  });
  h.start('prerequisite')!.attach(jest.fn(), jest.fn());
  await flush();
  expect(result).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAIL' }));
  expect(api.getNotificationSettings).not.toHaveBeenCalled();
  expect(api.requestPermission).not.toHaveBeenCalled();
});

test('prepared state alone and only one layout callback cannot start the transition', async () => {
  const f = fixture();
  await flush();
  expect(f.animate).not.toHaveBeenCalled();
  f.run.layout('source');
  expect(f.animate).not.toHaveBeenCalled();
  f.run.layout('destination');
  expect(f.animate).toHaveBeenCalledTimes(1);
});

test('invocation timestamp stays at the API boundary even if marker logging is slow', async () => {
  const f = fixture(event => {
    if (event.type === 'R5_PERMISSION_REQUESTED') jest.advanceTimersByTime(80);
  });
  let actualInvocationMs = -1;
  f.api.requestPermission.mockImplementation(() => {
    actualInvocationMs = clock.performance.now();
    return f.permission.promise;
  });
  await f.moving();
  expect(f.events.find(e => e.type === 'R5_PERMISSION_REQUESTED')?.requestedAtMs).toBe(
    actualInvocationMs,
  );
});

test('a dialog can outlive the transition: completion still waits for settlement and post-state', async () => {
  const f = fixture();
  await f.moving();
  jest.advanceTimersByTime(984);
  f.run.transitionEnded(true);
  expect(f.results).toHaveLength(0);
  jest.advanceTimersByTime(2000);
  f.permission.resolve({ authorizationStatus: 0 });
  await flush();
  expect(f.results).toEqual([expect.objectContaining({ status: 'PASS', elapsedMs: 2984 })]);
});

test('F01: settlement after the monotonic deadline fails even before the timeout callback runs', async () => {
  const f = fixture();
  await f.moving();
  f.run.transitionEnded(true);
  // Do not advance timers: reproduce a blocked JS queue draining Promise jobs first.
  jest.spyOn(clock.performance, 'now').mockReturnValue(216 + 30001);
  try {
    f.permission.resolve({ authorizationStatus: 1 });
    await flush();
    expect(f.results).toEqual([
      expect.objectContaining({ status: 'FAIL', reason: 'permission_timeout', elapsedMs: 30001 }),
    ]);
  } finally {
    jest.restoreAllMocks();
  }
});

test('F04: A -> B -> A cannot replay a correlation ID within the harness session', () => {
  const f = fixture();
  f.run.cancel();
  f.harness.start('r5-B')!.cancel();
  expect(f.harness.start('r5-1')).toBeNull();
  expect(f.events.at(-1)).toMatchObject({ type: 'R5_ADMISSION_REJECTED', reason: 'duplicate_id' });
});

test('F02/F05: layout and delayed JS progress cannot certify native hierarchy or native-start timing', async () => {
  const f = fixture();
  f.layout();
  await flush();
  jest.advanceTimersByTime(250); // First JS sample is already 250 ms after dispatch.
  f.run.progress(0.2);
  f.run.departureLayoutObserved();
  jest.advanceTimersByTime(160);
  f.run.progress(0.35);
  jest.advanceTimersByTime(40);
  f.permission.resolve({ authorizationStatus: 1 });
  await flush();
  f.run.transitionEnded(true);
  expect(f.results).toEqual([
    expect.objectContaining({
      status: 'PASS',
      observedDelayMs: 200,
      nativeStartTiming: 'UNVERIFIED',
      nativeHierarchy: 'UNVERIFIED',
      r5Acceptance: 'REQUIRES_NATIVE_EVIDENCE',
    }),
  ]);
  expect(f.events).not.toContainEqual(expect.objectContaining({ type: 'R5_HIERARCHY_CHANGED' }));
  expect(f.events).toContainEqual(
    expect.objectContaining({
      type: 'R5_DEPARTURE_LAYOUT_OBSERVED',
      nativeMountCompletion: 'UNVERIFIED',
    }),
  );
});

test('F04: session capacity fails closed without evicting old IDs', () => {
  const f = fixture();
  f.run.cancel();
  for (let n = 1; n < R5_SESSION_CAPACITY; n++) f.harness.start(`bounded-${n}`)!.cancel();
  expect(f.harness.start('overflow')).toBeNull();
  expect(f.events.at(-1)).toMatchObject({ reason: 'session_exhausted' });
  expect(f.harness.start('r5-1')).toBeNull();
  expect(f.events.at(-1)).toMatchObject({ reason: 'duplicate_id' });
});

test('F03: shared admission excludes both directions, retains a pending lease after cancellation, and handles throw', async () => {
  const admission = createSmokePermissionAdmission();
  const manual = admission.acquire('manual')!;
  const permission = deferred<{ authorizationStatus: number }>();
  const pending = manual.request(() => permission.promise);
  manual.release();
  const api = {
    getNotificationSettings: jest.fn(async () => ({ authorizationStatus: 0 })),
    shouldShowRequestPermissionRationale: jest.fn(async () => false),
    requestPermission: jest.fn(),
  };
  const events = jest.fn();
  const h = createIssue92Harness({
    admission,
    api,
    supported: () => true,
    now: () => clock.performance.now(),
    event: events,
    result: jest.fn(),
  });
  expect(h.start('blocked-by-manual')).toBeNull();
  expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'permission_busy' }));
  expect(admission.acquire('manual-2')).toBeNull();
  permission.resolve({ authorizationStatus: 0 });
  await pending;
  const run = h.start('admitted')!;
  expect(admission.acquire('blocked-by-r5')).toBeNull();
  run.cancel();
  const next = admission.acquire('after-r5')!;
  await expect(
    next.request(() => {
      throw new Error('native throw');
    }),
  ).rejects.toThrow('native throw');
  next.release();
  expect(admission.acquire('after-throw')).not.toBeNull();
});

test.each(['pre-state', 'post-state', 'animation-end'])(
  'delayed %s continuation cannot bypass its deadline',
  async stage => {
    const f = fixture();
    if (stage === 'pre-state') {
      f.layout();
      jest.spyOn(clock.performance, 'now').mockReturnValue(5001);
      await flush();
      expect(f.animate).not.toHaveBeenCalled();
    } else {
      await f.moving();
      const after = deferred<{ authorizationStatus: number }>();
      f.api.getNotificationSettings.mockReturnValue(after.promise);
      f.permission.resolve({ authorizationStatus: 0 });
      await flush();
      if (stage === 'animation-end') {
        after.resolve({ authorizationStatus: 0 });
        await flush();
      }
      jest.spyOn(clock.performance, 'now').mockReturnValue(216 + 5001);
      if (stage === 'post-state') {
        after.resolve({ authorizationStatus: 0 });
        await flush();
      }
      f.run.transitionEnded(true);
    }
    expect(f.results).toEqual([expect.objectContaining({ status: 'FAIL' })]);
    jest.restoreAllMocks();
  },
);

test('a non-finite progress sample cannot qualify permission invocation', async () => {
  const f = fixture();
  f.layout();
  await flush();
  f.run.progress(0.01);
  f.run.departureLayoutObserved();
  jest.advanceTimersByTime(160);
  f.run.progress(NaN);
  jest.advanceTimersByTime(40);
  expect(f.api.requestPermission).not.toHaveBeenCalled();
  expect(f.results).toEqual([expect.objectContaining({ status: 'FAIL' })]);
});

test('F01 independent witness: preemption between invocation timestamp and timer arming cannot extend the deadline', async () => {
  const f = fixture();
  f.layout();
  await flush();
  jest.advanceTimersByTime(16);
  f.run.progress(0.02);
  f.run.departureLayoutObserved();
  jest.advanceTimersByTime(160);
  f.run.progress(0.15);
  let reads = 0;
  const now = jest
    .spyOn(clock.performance, 'now')
    .mockImplementation(() => (++reads < 4 ? 216 : 218));
  jest.advanceTimersByTime(40);
  f.run.transitionEnded(true);
  now.mockReturnValue(30217);
  f.permission.resolve({ authorizationStatus: 0 });
  await flush();
  expect(f.results).toEqual([
    expect.objectContaining({ status: 'FAIL', reason: 'permission_timeout', elapsedMs: 30001 }),
  ]);
  jest.restoreAllMocks();
});

test.each([0, 2, -1, NaN])(
  'a resolved status of %s cannot PASS with an authorized post-state',
  async status => {
    const f = fixture();
    await f.moving();
    f.api.getNotificationSettings.mockResolvedValue({ authorizationStatus: 1 });
    f.permission.resolve({ authorizationStatus: status });
    await flush();
    f.run.transitionEnded(true);
    expect(f.results).toEqual([
      expect.objectContaining({ status: 'FAIL', reason: 'permission_state_invalid_or_mismatched' }),
    ]);
  },
);
