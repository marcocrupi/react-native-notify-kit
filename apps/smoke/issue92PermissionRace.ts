import type { SmokeEvent, SmokeResult } from './smokeAutomation';

export const R5_DURATION_MS = 1200;
const REQUEST_DELAY_MS = 200;
const STAGE_TIMEOUT_MS = 5000;
const PERMISSION_TIMEOUT_MS = 30000;
export const R5_SESSION_CAPACITY = 256;

// Smoke-only admission. A lease covers preparation through completion, and a
// pending native Promise retains ownership even after its caller releases it.
export function createSmokePermissionAdmission() {
  let owner: object | null = null;
  return {
    acquire(label: string) {
      if (owner) return null;
      const token = { label };
      owner = token;
      let released = false;
      let pending = 0;
      const relinquish = () => {
        if (released && pending === 0 && owner === token) owner = null;
      };
      return {
        request<T>(invoke: () => Promise<T>): Promise<T> {
          if (released || owner !== token || pending !== 0)
            return Promise.reject(new Error('smoke_permission_lease_unavailable'));
          pending++;
          let response: Promise<T>;
          try {
            response = invoke();
          } catch (error) {
            response = Promise.reject(error);
          }
          return Promise.resolve(response).finally(() => {
            pending--;
            relinquish();
          });
        },
        release() {
          released = true;
          relinquish();
        },
      };
    },
  };
}

export const smokePermissionAdmission = createSmokePermissionAdmission();

export async function withSmokePermission<T>(invoke: () => Promise<T>): Promise<T> {
  const lease = smokePermissionAdmission.acquire('smoke-entry-point');
  if (!lease) throw new Error('smoke_permission_busy');
  try {
    return await lease.request(invoke);
  } finally {
    lease.release();
  }
}
// RN supplies this clock at runtime; its app tsconfig does not include DOM globals.
export function r5MonotonicNow(): number {
  const runtime = globalThis as typeof globalThis & { performance?: { now: () => number } };
  return runtime.performance?.now() ?? NaN;
}

type Settings = { authorizationStatus: number };
type PermissionState = Settings & { rationale: boolean };
type Deps = {
  admission?: ReturnType<typeof createSmokePermissionAdmission>;
  api: {
    getNotificationSettings: () => Promise<Settings>;
    shouldShowRequestPermissionRationale: () => Promise<boolean>;
    requestPermission: () => Promise<Settings>;
  };
  supported: () => boolean;
  now: () => number;
  event: (event: SmokeEvent) => void;
  result: (result: SmokeResult) => void;
};

function sanitizedError(error: unknown) {
  return {
    name: error instanceof Error ? error.name.replace(/[^\w.-]/g, '').slice(0, 60) : 'Error',
    message: (error instanceof Error ? error.message : String(error))
      // Permission errors only: strip control characters and bound log payload size.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .slice(0, 240),
  };
}

// One instance per JS runtime, retained across App/screen remounts. A timed-out native
// request still owns the lock until its Promise settles; there is no reset API.
export function createIssue92Harness(deps: Deps) {
  let active: ReturnType<typeof makeRun> | null = null;
  const admission = deps.admission ?? createSmokePermissionAdmission();
  // One non-resettable harness session per JS runtime in App. Bound memory by
  // refusing further admission at capacity; never evict IDs and permit replay.
  const admittedIds = new Set<string>();

  function makeRun(id: string, lease: NonNullable<ReturnType<typeof admission.acquire>>) {
    let terminal = false;
    let pendingPermission = false;
    let prepared = false;
    let attached = false;
    const layouts = new Set<string>();
    let animate: (() => void) | undefined;
    let stop: (() => void) | undefined;
    let dispatchedAt: number | undefined;
    let startedAt: number | undefined;
    let requestedAt: number | undefined;
    let settledAt: number | undefined;
    let latestProgress = 0;
    let progressAt = 0;
    let departureLayoutObserved = false;
    let transitionEnded = false;
    let before: PermissionState | undefined;
    let after: PermissionState | undefined;
    let resolved: Settings | undefined;
    let rejection = false;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    let stageTimer: ReturnType<typeof setTimeout> | undefined;
    let expiresAt = Infinity;
    let deadlineReason = '';
    const event = (type: string, details: Record<string, unknown> = {}) =>
      deps.event({
        scenario: 'issue92-r5',
        source: 'issue92-r5',
        id,
        type: `R5_${type}`,
        clock: 'performance.now',
        monotonicMs: deps.now(),
        ...details,
      });
    const release = () => {
      if (active === run && !pendingPermission) active = null;
    };
    const finish = (reason?: string) => {
      if (terminal) return;
      terminal = true;
      clearTimeout(requestTimer);
      clearTimeout(stageTimer);
      stop?.();
      const details = {
        status: reason ? ('FAIL' as const) : ('PASS' as const),
        reason,
        clock: 'performance.now',
        startBasis: 'first_native_animated_progress_received_in_js',
        resultScope: 'JS_HARNESS_ONLY',
        nativeHierarchy: 'UNVERIFIED',
        nativeStartTiming: 'UNVERIFIED',
        r5Acceptance: 'REQUIRES_NATIVE_EVIDENCE',
        nativeEvidenceRequired: 'Correlate R5Native receipts and independently observed system UI',
        idSessionPolicy: 'JS_runtime_256_admissions_no_eviction_no_reset',
        before: before ?? null,
        after: after ?? null,
        authorizationStatus: resolved?.authorizationStatus ?? null,
        dispatchedAtMs: dispatchedAt ?? null,
        firstProgressReceivedAtMs: startedAt ?? null,
        requestedAtMs: requestedAt ?? null,
        settledAtMs: settledAt ?? null,
        observedDelayMs:
          requestedAt !== undefined && startedAt !== undefined ? requestedAt - startedAt : null,
        elapsedMs:
          settledAt !== undefined && requestedAt !== undefined ? settledAt - requestedAt : null,
        pendingPermission,
        dialogObserved: 'UNKNOWN',
        dialogEvidenceRequired: 'Runtime Executor must record system dialog visibility',
        permissionMode: !before
          ? 'UNKNOWN'
          : before.authorizationStatus === 1
            ? 'ALREADY_GRANTED'
            : 'DENIED_OR_UNDECIDED',
      };
      event('SCENARIO_COMPLETED', details);
      deps.result({ scenario: 'issue92-r5', id, ...details });
      lease.release();
      release();
    };
    const checkDeadline = () => {
      if (terminal) return false;
      const now = deps.now();
      if (!Number.isFinite(now) || now >= expiresAt) {
        const reason = Number.isFinite(now) ? deadlineReason : 'invalid_monotonic_clock';
        event('TIMEOUT', { reason, pendingPermission });
        finish(reason);
        return false;
      }
      return true;
    };
    const deadline = (reason: string, ms = STAGE_TIMEOUT_MS, origin = deps.now()) => {
      clearTimeout(stageTimer);
      expiresAt = origin + ms;
      deadlineReason = reason;
      stageTimer = setTimeout(() => {
        event('TIMEOUT', { reason, pendingPermission });
        finish(reason);
      }, ms);
    };
    const readState = async (): Promise<PermissionState> => {
      const [settings, rationale] = await Promise.all([
        deps.api.getNotificationSettings(),
        deps.api.shouldShowRequestPermissionRationale(),
      ]);
      return { authorizationStatus: settings.authorizationStatus, rationale };
    };
    const maybeComplete = () => {
      if (!checkDeadline() || !after || !resolved) return;
      if (
        ![0, 1].includes(resolved.authorizationStatus) ||
        after.authorizationStatus !== resolved.authorizationStatus
      )
        finish('permission_state_invalid_or_mismatched');
      else if (transitionEnded) finish();
    };
    const settle = async (settings?: Settings, error?: unknown) => {
      pendingPermission = false;
      settledAt = deps.now();
      resolved = settings;
      rejection = settings === undefined;
      checkDeadline();
      event(rejection ? 'PERMISSION_REJECTED' : 'PERMISSION_RESOLVED', {
        settledAtMs: settledAt,
        elapsedMs: settledAt - requestedAt!,
        authorizationStatus: settings?.authorizationStatus ?? null,
        ...(rejection ? { error: sanitizedError(error) } : {}),
        late: terminal,
      });
      if (!terminal) deadline('post_state_or_transition_timeout');
      // Post-state is also attempted for rejections and late settlements. It can
      // never reverse an already terminal FAIL or restart an animation.
      try {
        const state = await readState();
        after = state;
        checkDeadline();
        event('PERMISSION_STATE_AFTER', { ...state, late: terminal });
      } catch (readError) {
        event('ERROR', { phase: 'after', error: sanitizedError(readError), late: terminal });
        if (!terminal) finish('after_state_failed');
      }
      if (terminal) release();
      else if (rejection) finish('permission_rejected');
      else maybeComplete();
    };
    const invoke = () => {
      if (!checkDeadline() || requestedAt !== undefined) return;
      const now = deps.now();
      const delay = now - startedAt!;
      const progressAgeMs = now - progressAt;
      if (
        !deps.supported() ||
        transitionEnded ||
        !departureLayoutObserved ||
        !Number.isFinite(latestProgress) ||
        latestProgress <= 0 ||
        latestProgress >= 1 ||
        progressAgeMs > 100 ||
        delay < 150 ||
        delay > 350 ||
        now - dispatchedAt! > 500
      ) {
        event('ERROR', {
          phase: 'timing',
          observedDelayMs: delay,
          progressAgeMs,
          progress: latestProgress,
          departureLayoutObserved,
        });
        finish('transition_evidence_invalid');
        return;
      }
      pendingPermission = true;
      let response: Promise<Settings> | undefined;
      let thrown: unknown;
      // Timestamp at the public API call boundary. Logging is deliberately
      // after the call, before installing settlement handlers, so log overhead
      // cannot masquerade as part of the measured invocation delay.
      requestedAt = deps.now();
      deadline('permission_timeout', PERMISSION_TIMEOUT_MS, requestedAt);
      try {
        response = lease.request(() => deps.api.requestPermission());
      } catch (error) {
        thrown = error;
      }
      event('PERMISSION_REQUESTED', {
        requestedAtMs: requestedAt,
        observedDelayMs: requestedAt - startedAt!,
        sinceDispatchMs: requestedAt - dispatchedAt!,
        progress: latestProgress,
        progressAgeMs: requestedAt - progressAt,
      });
      if (response) {
        response.then(
          settings => settle(settings),
          error => settle(undefined, error),
        );
      } else {
        settle(undefined, thrown);
      }
    };
    const maybeAnimate = () => {
      if (checkDeadline() && prepared && layouts.size === 2 && dispatchedAt === undefined)
        animate?.();
    };
    const run = {
      id,
      attach(startAnimation: () => void, stopAnimation: () => void) {
        if (attached || !checkDeadline()) return;
        attached = true;
        animate = startAnimation;
        stop = stopAnimation;
        event('SCENARIO_STARTED', { durationMs: R5_DURATION_MS, targetDelayMs: REQUEST_DELAY_MS });
        deadline('pre_state_or_layout_timeout');
        if (!deps.supported() || !Number.isFinite(deps.now())) {
          finish('requires_active_android_api33_and_monotonic_clock');
          return;
        }
        readState().then(
          state => {
            if (!checkDeadline()) return;
            before = state;
            prepared = true;
            event('PERMISSION_STATE_BEFORE', state);
            maybeAnimate();
          },
          error => {
            if (terminal) return;
            event('ERROR', { phase: 'before', error: sanitizedError(error) });
            finish('before_state_failed');
          },
        );
      },
      layout(page: 'source' | 'destination') {
        if (!checkDeadline()) return;
        layouts.add(page);
        maybeAnimate();
      },
      dispatched() {
        if (!checkDeadline() || dispatchedAt !== undefined) return;
        dispatchedAt = deps.now();
        deadline('transition_start_timeout');
        event('TRANSITION_DISPATCHED');
      },
      progress(value: number) {
        if (!checkDeadline() || dispatchedAt === undefined) return;
        latestProgress = value;
        progressAt = deps.now();
        if (startedAt === undefined && value > 0 && value < 1) {
          startedAt = progressAt;
          event('FIRST_PROGRESS_RECEIVED', {
            progress: value,
            dispatchToObservationMs: startedAt - dispatchedAt,
            startBasis: 'first_native_animated_progress_received_in_js',
          });
          requestTimer = setTimeout(invoke, REQUEST_DELAY_MS);
        }
      },
      departureLayoutObserved() {
        if (!checkDeadline() || departureLayoutObserved || startedAt === undefined) return;
        departureLayoutObserved = true;
        event('DEPARTURE_LAYOUT_OBSERVED', { nativeMountCompletion: 'UNVERIFIED' });
      },
      transitionEnded(finished: boolean) {
        if (!checkDeadline() || transitionEnded) return;
        transitionEnded = true;
        event('TRANSITION_ENDED', { finished });
        if (!finished || requestedAt === undefined)
          finish('transition_ended_before_request_or_interrupted');
        else maybeComplete();
      },
      cancel() {
        finish('unmounted');
      },
    };
    deadline('screen_mount_timeout');
    return run;
  }

  return {
    isBusy: () => active !== null,
    start(id: string) {
      const duplicate = admittedIds.has(id);
      const full = admittedIds.size >= R5_SESSION_CAPACITY;
      const lease = !active && !duplicate && !full ? admission.acquire(`r5:${id}`) : null;
      if (!lease) {
        deps.event({
          source: 'issue92-r5',
          scenario: 'issue92-r5',
          type: 'R5_ADMISSION_REJECTED',
          id,
          clock: 'performance.now',
          monotonicMs: deps.now(),
          activeId: active?.id ?? null,
          reason: active
            ? 'busy'
            : duplicate
              ? 'duplicate_id'
              : full
                ? 'session_exhausted'
                : 'permission_busy',
        });
        return null;
      }
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
        lease.release();
        deps.result({
          scenario: 'issue92-r5',
          status: 'FAIL',
          reason: 'requires_unique_id_1_to_80_alphanumeric_dash_underscore',
        });
        return null;
      }
      admittedIds.add(id);
      active = makeRun(id, lease);
      return active;
    },
  };
}

export type Issue92Run = NonNullable<ReturnType<ReturnType<typeof createIssue92Harness>['start']>>;
