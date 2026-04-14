# Pre-fix audit for #549 resolution (strategy 1)

Read-only audit to drive the strategy-1 fix (total conversion of `WorkDataRepository` mutation methods from `void` to `ListenableFuture<Void>`). No library code was modified during this audit. Baseline: Jest 296/296 green, Android JUnit 16/16 green.

Companion docs: `eventual-bouncing-dolphin.md` (static analysis), `repro-549-findings.md` (empirical reproduction on Pixel 9 Pro XL).

## Part A — WorkDataRepository API surface

Only one persistence repository exists in the Android core: `WorkDataRepository`. No `NotificationStatusRepository` or sibling classes. It is a singleton (`mInstance`) constructed via `getInstance(context)` with a `synchronized (WorkDataRepository.class)` guard. The backing executor is `NotifeeCoreDatabase.databaseWriteListeningExecutor`, a `Executors.newCachedThreadPool()` wrapped in `MoreExecutors.listeningDecorator(...)` — so it is **not** single-threaded; multiple Room operations can run concurrently on different worker threads, with Room's internal write lock being the only serialization point.

File: [packages/react-native/android/src/main/java/app/notifee/core/database/WorkDataRepository.java](packages/react-native/android/src/main/java/app/notifee/core/database/WorkDataRepository.java)

### Method table (as of 9.4.0, `main` branch `feature/fix`)

| # | Method | Lines | Return type | Kind | Executor | Error handling | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `getInstance(Context)` | 32–40 | `WorkDataRepository` | singleton | caller thread | none | `synchronized` double-check init. |
| 2 | `WorkDataRepository(Context)` | 42–45 | ctor | ctor | caller thread | none | Also called directly at `NotifeeAlarmManager.java:72` and `NotificationManager.java:936` — not via `getInstance()`. Non-issue for the fix, but callers can see a fresh instance that shares the same backing DAO. |
| 3 | **`insert(WorkDataEntity)`** | 47–52 | **`void`** | mutation | `databaseWriteListeningExecutor.execute` | silent | **Fire-and-forget.** Uncaught exceptions land on the executor's default handler, never reach callers. |
| 4 | `getWorkDataById(String)` | 54–57 | `ListenableFuture<WorkDataEntity>` | read | `databaseWriteListeningExecutor.submit` | exceptions propagate via future | Already awaitable. |
| 5 | `getAllWithAlarmManager(Boolean)` | 59–62 | `ListenableFuture<List<WorkDataEntity>>` | read | same | same | Already awaitable. |
| 6 | `getAll()` | 64–66 | `ListenableFuture<List<WorkDataEntity>>` | read | same | same | Already awaitable. |
| 7 | **`deleteById(String)`** | 68–73 | **`void`** | mutation | `databaseWriteListeningExecutor.execute` | silent | Fire-and-forget. |
| 8 | **`deleteByIds(List<String>)`** | 75–80 | **`void`** | mutation | same | silent | Fire-and-forget. |
| 9 | **`deleteAll()`** | 82–87 | **`void`** | mutation | same | silent | Fire-and-forget. This is the exact method called out in upstream #549. |
| 10 | `insertTriggerNotification(NotificationModel, Bundle, Boolean)` | 89–99 | `void` (`static`) | mutation wrapper | delegates to `mInstance.insert()` | silent | **Static helper** — does *not* null-check `mInstance`; assumes a prior `getInstance(context)` has run. Uses `mInstance` directly which is a subtle coupling. |
| 11 | **`update(WorkDataEntity)`** | 101–106 | **`void`** | mutation | `databaseWriteListeningExecutor.execute` | silent | Fire-and-forget. Written separately to `NotifeeCoreDatabase.databaseWriteExecutor` pool (same underlying pool, different reference name — line 48 vs 50 of `NotifeeCoreDatabase.java`; harmless but confusing). |

### Conversion list — 5 instance methods + 1 static wrapper

| Method | Current | Proposed new signature | Return-value semantics to preserve |
|---|---|---|---|
| `insert` | `void` | `ListenableFuture<Void>` | none today; DAO `insert` returns `void`. Keep `Void`. |
| `deleteById` | `void` | `ListenableFuture<Void>` | none today; DAO `deleteById` returns `void` (custom `@Query`). |
| `deleteByIds` | `void` | `ListenableFuture<Void>` | none today; DAO returns `void`. |
| `deleteAll` | `void` | `ListenableFuture<Void>` | none today; DAO returns `void`. |
| `update` | `void` | `ListenableFuture<Void>` | none today; DAO `update` returns `void`. |
| `insertTriggerNotification` (static) | `void` | `ListenableFuture<Void>` | Propagate the future from the inner `insert` call. Callers at `NotificationManager.java:726-727` and `760-761` will chain it. |

Worth considering (but **not** required for the fix): switching the DAO mutators from `void` to `int` (Room supports returning affected-row counts) to expose whether a `deleteById` actually deleted anything. This would be a separate, non-load-bearing refactor and should NOT be bundled with the #549 fix.

---

## Part B — Caller audit

All call sites of the six mutation methods in `packages/react-native/android/`. Grep verified — the agent pass found 7, the independent grep found 9 references to the 6 names (once you include the DAO self-calls inside `WorkDataRepository` itself, which aren't callers). **Net external call sites: 8.** The agent missed one: `NotifeeAlarmManager.rescheduleNotification` at line 310. I've added it as Caller #8.

> **Important NotifeeCore surprise flagged to Marco**: Caller #8 lives inside the **reboot recovery path** (`NotifeeAlarmManager.rescheduleNotifications` → `rescheduleNotification`). It is executed from `RebootBroadcastReceiver.onReceive` using `goAsync()` semantics. The fire-and-forget `update` here means that after a device reboot, the persisted next-fire timestamp for every recurring alarm is only *enqueued* to Room; the `BroadcastReceiver.PendingResult.finish()` is called inside the `finally` of the iteration loop, completely independent of whether those Room writes have landed. If Android kills the receiver's process between `pendingResult.finish()` and the last write draining, the updated timestamps are lost and the next reboot will reschedule from stale anchors. **This is a bug class the upstream #549 thread does not discuss** and an important reason to do strategy 1 holistically rather than patch only the cancel/create symptoms.

### Grouped by enclosing class

#### NotificationManager.java

##### Caller #1 — `cancelAllNotifications(int)` → `deleteAll()`
- **File**: `packages/react-native/android/src/main/java/app/notifee/core/NotificationManager.java`
- **Line range**: 542–558 (call at 551)
- **Method called**: `WorkDataRepository.deleteAll()`
- **Calling context**: `static ListenableFuture<Void> cancelAllNotifications(int notificationType)` (line 519) — wired to the JS bridge method `cancelAllNotifications` / `cancelDisplayedNotifications` / `cancelTriggerNotifications` via `Notifee.cancelAllNotifications` (`Notifee.java:117-132`) → `NotifeeApiModule.kt` Promise resolver.
- **Code excerpt**:
  ```java
  .continueWith(
      task -> {
        if (notificationType == NOTIFICATION_TYPE_TRIGGER
            || notificationType == NOTIFICATION_TYPE_ALL) {
          return new ExtendedListenableFuture<Void>(
                  NotifeeAlarmManager.cancelAllNotifications())
              .addOnCompleteListener(
                  (e, result) -> {
                    if (e == null) {
                      WorkDataRepository.getInstance(getApplicationContext()).deleteAll();
                    }
                  },
                  LISTENING_CACHED_THREAD_POOL);
        }
        return Futures.immediateFuture(null);
      },
      LISTENING_CACHED_THREAD_POOL);
  ```
- **Classification**: **AWAIT_REQUIRED**
- **Reasoning**: (a) the enclosing future's completion drives JS Promise resolution; (b) this is the exact symptom reproduced at 1/30 iterations in Scenario B of `repro-549-findings.md`. Fix: inside the listener, return `deleteAll()`'s future and chain it so the outer `ExtendedListenableFuture` only completes after Room has drained.

##### Caller #2 — `cancelAllNotificationsWithIds(int, List<String>, String)` → `deleteByIds(ids)`
- **File**: same
- **Line range**: 614–622 (call at 618)
- **Method called**: `WorkDataRepository.deleteByIds(List<String>)`
- **Calling context**: `static ListenableFuture<Void> cancelAllNotificationsWithIds(int, List<String>, String)` (line 561) — wired to JS `cancelNotification(id)`, `cancelDisplayedNotification(id)`, `cancelTriggerNotification(id)`.
- **Code excerpt**:
  ```java
  .continueWith(
      task -> {
        // delete all from database
        if (notificationType != NOTIFICATION_TYPE_DISPLAYED) {
          WorkDataRepository.getInstance(getApplicationContext()).deleteByIds(ids);
        }
        return Futures.immediateFuture(null);
      },
      LISTENING_CACHED_THREAD_POOL);
  ```
- **Classification**: **AWAIT_REQUIRED**
- **Reasoning**: JS `cancelTriggerNotification(id)` promise is tied to this future. Fix: return `deleteByIds(ids)`'s future from the `continueWith` lambda (replacing `Futures.immediateFuture(null)`).

##### Caller #3 — `createIntervalTriggerNotification` → `insertTriggerNotification(...)`
- **File**: same
- **Line range**: 714–741 (call at 726–727)
- **Method called**: `WorkDataRepository.insertTriggerNotification(NotificationModel, Bundle, Boolean=false)`
- **Calling context**: `static void createIntervalTriggerNotification(NotificationModel, Bundle)` — reached via the task submitted in `createTriggerNotification` (line 692–712), which returns `ListenableFuture<Void>` to `Notifee.createTriggerNotification` (`Notifee.java:275-294`) → JS Promise.
- **Code excerpt** (abridged):
  ```java
  WorkDataRepository.getInstance(getApplicationContext())
      .insertTriggerNotification(notificationModel, triggerBundle, false);

  long interval = trigger.getInterval();
  PeriodicWorkRequest.Builder workRequestBuilder =
      new PeriodicWorkRequest.Builder(Worker.class, interval, trigger.getTimeUnit());
  // ... build & enqueueUniquePeriodicWork
  ```
- **Classification**: **AWAIT_REQUIRED**
- **Reasoning**: (a) The enclosing future drives the JS Promise, same as the timestamp path. (b) `Worker.doScheduledWork` reads the row back (`NotificationManager.java:977 workDataRepository.getWorkDataById(id)`); if WorkManager fires the periodic work before the insert lands, the worker will log `"Attempted to handle doScheduledWork but no notification data was found"` and silently abort the first fire. Fix: make `createIntervalTriggerNotification` return `ListenableFuture<Void>` (or take a completer) and chain the insert future before enqueuing WorkManager — or at minimum before the surrounding lambda returns.

##### Caller #4 — `createTimestampTriggerNotification` → `insertTriggerNotification(...)`
- **File**: same
- **Line range**: 743–798 (call at 760–761)
- **Method called**: `WorkDataRepository.insertTriggerNotification(NotificationModel, Bundle, withAlarmManager)`
- **Calling context**: `static void createTimestampTriggerNotification(NotificationModel, Bundle)` — same path to the JS Promise as Caller #3.
- **Code excerpt**:
  ```java
  WorkDataRepository.getInstance(getApplicationContext())
      .insertTriggerNotification(notificationModel, triggerBundle, withAlarmManager);
  if (withAlarmManager) {
    NotifeeAlarmManager.scheduleTimestampTriggerNotification(notificationModel, trigger);
    return;
  }
  // ... WorkManager fallback path
  ```
- **Classification**: **AWAIT_REQUIRED**
- **Reasoning**: This is the exact code path reproduced at 1/30 iterations in Scenario C of `repro-549-findings.md`. A subsequent `await getTriggerNotificationIds()` can miss the row. Fix: same as Caller #3.

##### Caller #5 — `doScheduledWork` (Worker callback) → `deleteById(id)`
- **File**: same
- **Line range**: 931–999 (call at 993–994)
- **Method called**: `WorkDataRepository.deleteById(String)`
- **Calling context**: `static void doScheduledWork(Data, CallbackToFutureAdapter.Completer<ListenableWorker.Result>)` — called by `Worker` (WorkManager) to execute a one-time trigger notification.
- **Code excerpt** (abridged):
  ```java
  (e2, _unused) -> {
    completer.set(Result.success());   // ← Worker reports success HERE
    if (e2 != null) {
      Logger.e(TAG, "Failed to display notification", e2);
    } else {
      String workerRequestType = data.getString(Worker.KEY_WORK_REQUEST);
      if (workerRequestType != null
          && workerRequestType.equals(Worker.WORK_REQUEST_ONE_TIME)) {
        // delete database entry if work is a one-time request
        WorkDataRepository.getInstance(getApplicationContext())
            .deleteById(id);
      }
    }
  },
  LISTENING_CACHED_THREAD_POOL);
  ```
- **Classification**: **AWAIT_REQUIRED**
- **Reasoning**: (a) On reboot, `NotifeeAlarmManager.rescheduleNotifications()` iterates `getAll()` and re-schedules every row — a zombie row here causes ghost notifications. (b) `completer.set(Result.success())` is called **before** the delete, so WorkManager considers the work complete while the row is still pending deletion; a subsequent `cancelTriggerNotifications` read or a user-visible `getTriggerNotificationIds` will lie. (c) This is not a JS-facing promise, but it *is* a persisted-state contract. Fix: move the delete *before* `completer.set(...)`, chain its future, and only `completer.set(Result.success())` once the delete future completes.

#### NotifeeAlarmManager.java

##### Caller #6 — `displayScheduledNotification` repeat path → `update(WorkDataEntity)`
- **File**: `packages/react-native/android/src/main/java/app/notifee/core/NotifeeAlarmManager.java`
- **Line range**: 55–140 (call at 110–116)
- **Method called**: `WorkDataRepository.update(WorkDataEntity)`
- **Calling context**: `static void displayScheduledNotification(Bundle, BroadcastReceiver.PendingResult)` — called from `NotificationAlarmReceiver.onReceive` via `goAsync()`. Must eventually call `pendingResult.finish()` within Android's receiver deadline (~10s for foreground receivers).
- **Code excerpt**:
  ```java
  if (triggerBundle.containsKey("repeatFrequency")
      && ObjectUtils.getInt(triggerBundle.get("repeatFrequency")) != -1) {
    TimestampTriggerModel trigger = TimestampTriggerModel.fromBundle(triggerBundle);
    // scheduleTimestampTriggerNotification() calls setNextTimestamp() internally
    scheduleTimestampTriggerNotification(notificationModel, trigger);
    WorkDataRepository.getInstance(getApplicationContext())
        .update(new WorkDataEntity(
            id,
            workDataEntity.getNotification(),
            ObjectUtils.bundleToBytes(trigger.toBundle()),
            true));
  }
  // ...
  // followed by .addOnCompleteListener that calls pendingResult.finish()
  ```
- **Classification**: **AWAIT_REQUIRED**
- **Reasoning**: (a) The updated next-fire timestamp for a recurring alarm must land before the process is allowed to die. (b) `addOnCompleteListener` at line 127 calls `pendingResult.finish()` inside the `finally` block, which signals to Android that the receiver is done; Android can then kill the process. (c) On reboot, `rescheduleNotifications` will use whatever timestamp is in Room — if the update didn't land, the alarm reschedules from the *old* timestamp, firing a second time. Fix: make `update()`'s future part of the outer chain so `pendingResult.finish()` only runs after the write completes. The future must still respect the receiver deadline — if Room is wedged, the receiver should finish anyway and log the failure; use `Futures.withTimeout` or a bounded wait.

##### Caller #7 — `displayScheduledNotification` one-time path → `deleteById(id)`
- **File**: same
- **Line range**: 55–140 (call at 119–120)
- **Method called**: `WorkDataRepository.deleteById(String)`
- **Calling context**: same as Caller #6 — the one-time branch of `displayScheduledNotification`.
- **Code excerpt**:
  ```java
  } else {
    // not repeating, delete database entry if work is a one-time request
    WorkDataRepository.getInstance(getApplicationContext())
        .deleteById(id);
  }
  // ... then pendingResult.finish() via addOnCompleteListener
  ```
- **Classification**: **AWAIT_REQUIRED**
- **Reasoning**: Symmetric to Caller #6, plus the reboot-zombie risk described for Caller #5. Fix: same — chain the `deleteById` future into the outer composition so `pendingResult.finish()` waits for it.

##### Caller #8 — `rescheduleNotification` (reboot recovery) → `update(WorkDataEntity)` ***← missed by first pass***
- **File**: same
- **Line range**: 287–322 (call at 310–316)
- **Method called**: `WorkDataRepository.update(WorkDataEntity)`
- **Calling context**: `void rescheduleNotification(WorkDataEntity)` called in a `for` loop from `rescheduleNotifications(pendingResult)` (line 324–340), which is invoked from `RebootBroadcastReceiver` on `BOOT_COMPLETED`. The loop's `finally` calls `pendingResult.finish()` after the iteration completes — with no await on the `update` futures.
- **Code excerpt**:
  ```java
  scheduleTimestampTriggerNotification(notificationModel, trigger);
  // Persist updated timestamp so next reboot starts from the correct anchor
  WorkDataRepository.getInstance(getApplicationContext())
      .update(new WorkDataEntity(
          workDataEntity.getId(),
          workDataEntity.getNotification(),
          ObjectUtils.bundleToBytes(trigger.toBundle()),
          workDataEntity.getWithAlarmManager()));
  ```
- **Classification**: **AWAIT_REQUIRED**
- **Reasoning**: Already explained in the impact-flag at the top of this section. The whole purpose of the comment `"Persist updated timestamp so next reboot starts from the correct anchor"` is *correctness across reboots* — but the fire-and-forget means the anchor may never be persisted. Fix: collect the update futures from every iteration (`Futures.allAsList(updateFutures)`) and chain `pendingResult.finish()` onto that combined future.

### Summary counts

- **Total mutation call sites (external to WDR): 8**
- **AWAIT_REQUIRED: 8**
- **FIRE_AND_FORGET_INTENTIONAL: 0**
- **UNCERTAIN: 0**

Zero call sites are safely fire-and-forget. Every single one has a correctness contract tied to write completion: either a JS Promise, a BroadcastReceiver deadline, WorkManager success-reporting, or reboot-recovery anchor persistence. The fix must update all 8.

### Call sites with currently-silent exception handling

- All 8 call sites currently drop exceptions on the floor because the `void` mutators never surface them. After the conversion, the DAO can propagate Room exceptions (disk full, SQLite corruption, schema mismatch) into the `ListenableFuture`. Two specific hot paths need explicit handling:
  1. **Caller #1 / #2 (cancel)**: if `deleteAll` / `deleteByIds` fails, the JS Promise will reject. Today it silently resolves. Upgrade the JS-side error handling in `NotifeeApiModule.kt` promise resolvers is probably unnecessary — they already propagate native errors — but **check the Jest mocks**: `NotifeeApiModule.test.ts` at `packages/react-native/__tests__/NotifeeApiModule.test.ts:93-118` tests `cancelTriggerNotifications` only against a resolved mock. If the real native path starts rejecting, no Jest test covers that branch.
  2. **Callers #3 / #4 (create)**: if the insert fails, `createTriggerNotification` will reject, and the subsequent `NotifeeAlarmManager.scheduleTimestampTriggerNotification` on line 765 will *not* run. That is arguably correct — don't schedule an alarm for a notification that isn't persisted — but it's a behavior change worth a changelog entry.

### Call sites where blocking `.get()` would be dangerous

All 8 are fine to await *asynchronously* (via `addOnCompleteListener` or `continueWith`), but two contexts have hard deadlines and must use non-blocking composition:

- **Callers #6, #7, #8 (BroadcastReceiver with `goAsync()`)**: Android kills the receiver process if `pendingResult.finish()` isn't called within ~10s. Never call `.get()` on the write future — chain it. If a future takes >8s, explicitly `finish()` on the deadline and log — use `Futures.withTimeout(future, 8, TimeUnit.SECONDS, scheduledExecutor)` and let the timeout path call `finish()`.
- **Caller #5 (WorkManager worker)**: has a 10-minute job deadline, plenty of headroom, but the `CallbackToFutureAdapter.Completer` requires that `completer.set(...)` is eventually called exactly once on success/failure. The fix must ensure the delete future's completion triggers `completer.set(...)` — don't double-set and don't early-set-then-chain.

---

## Part C — Existing test inventory

### Jest (`packages/react-native/__tests__/`)

- **22 test files** total: 1 in `__tests__/` root (`NotifeeApiModule.test.ts`), 1 `testSetup.test.ts` canary, plus 2 setup files (`jest-setup.js`, `testSetup.ts`, not tests), and 18 files under `__tests__/validators/`.
- **Trigger-relevant**: only `NotifeeApiModule.test.ts` has tests that touch `cancelTriggerNotifications`, `cancelTriggerNotification`, `createTriggerNotification`, `getTriggerNotifications`, `getTriggerNotificationIds`. **All of them mock the native module** (`mockNotifeeNativeModule.cancelTriggerNotifications.mockResolvedValue(...)`), so they test JS-side plumbing (argument shapes, method resolution) but **do not exercise the race**. Every race assertion we want will need to live elsewhere.
- **Baseline run**: `yarn tests_rn:test` — **20 suites passed, 296 tests passed**, 0 failures, 0 snapshots, ~2.1s wall time. (Captured stdout tail: `Test Suites: 20 passed, 20 total / Tests: 296 passed, 296 total`.)

### Android JUnit (`packages/react-native/android/src/test/` + `androidTest/`)

- **Unit tests** (`src/test/`, Robolectric-free JVM tests): 4 files, **16 tests total**:
  - `NotificationPendingIntentTest.java` — 5 tests
  - `ForegroundServiceTest.java` — 7 tests
  - `model/NotificationAndroidPressActionModelTest.java` — 3 tests
  - `model/TimestampTriggerModelTest.java` — 1 test
- **Instrumented tests** (`src/androidTest/`, run on device/emulator): 2 files
  - `ExampleInstrumentedTest.java` — placeholder, 1 test
  - `database/NotifeeCoreDatabaseTest.java` — 1 migration test (exercises Room's `MigrationTestHelper`, not `WorkDataRepository` directly)
- **Trigger-relevant**: `TimestampTriggerModelTest.java` tests the *model* (serialization / nextTimestamp math), not the repository or the race. `NotifeeCoreDatabaseTest.java` tests schema migrations only. **No test currently exercises `WorkDataRepository` mutations, `NotificationManager.cancelAllNotifications`, or `NotificationManager.createTriggerNotification` at the Android layer.**
- **Baseline run**: `yarn test:core:android` (first run UP-TO-DATE), then `./gradlew :react-native-notify-kit:testDebugUnitTest --rerun-tasks` — **BUILD SUCCESSFUL in 9s**, 28 tasks executed. Parsed junit XML reports confirm: 4 test suites, **16 tests run, 0 failures, 0 errors, 0 skipped**.
- **Note**: the instrumented tests under `androidTest/` are **not run by `yarn test:core:android`** (that command only runs `testDebugUnitTest`). They need a connected device/emulator and `connectedDebugAndroidTest` which is not wired into either GitHub workflow. So `NotifeeCoreDatabaseTest` has no CI coverage on this fork.

### CI wiring

Three workflows under `.github/workflows/`:

1. **`linting.yml`** — runs ESLint + Prettier + markdownlint; not relevant to this fix.
2. **`tests_jest.yml`** — triggers on PRs touching anything except `docs/**` and `**/*.md`; runs `yarn tests_rn:test` (the same 296-test Jest suite). ✅ wired.
3. **`tests_junit.yml`** — triggers on PRs touching `packages/react-native/android/**` or `.github/workflows/*.yml`; runs `yarn test:core:android` (the same 16-test JVM unit suite via Gradle). ✅ wired.

Neither workflow runs instrumented Android tests (`connectedDebugAndroidTest`), so **any Room-backed test we add under `androidTest/` will not run in CI without adding an emulator job**. That's a cost to weigh in Part D.

### Baseline pass/fail report

- **Jest**: ✅ 296/296 passing on `feature/fix` @ HEAD (`29bbc8e chore(deps): bump axios`).
- **Android JUnit (unit only)**: ✅ 16/16 passing.
- **Android instrumented**: not run; not wired to CI.

Baseline is green. Safe to proceed with the fix.

---

## Part D — Proposed test plan for the fix

The Jest suite is structurally incapable of catching the race: it mocks the native module. The JUnit suite has no `WorkDataRepository` coverage. We need to add coverage at three layers.

### 1. New Jest regression tests

Jest won't catch the race itself (that requires a real Room DB), but it *can* assert that the TypeScript layer does not add its own regressions when the Promise semantics tighten. These are cheap smoke tests.

- **File**: `packages/react-native/__tests__/NotifeeApiModule.test.ts` (existing — extend, not replace)
- **Tests to add**:
  1. `cancelTriggerNotifications rejects when native rejects` — assert the JS API propagates a rejected native promise back to the caller without swallowing. Setup: `mockNotifeeNativeModule.cancelTriggerNotifications.mockRejectedValue(new Error('db-fail'))`. Assertion: `await expect(apiModule.cancelTriggerNotifications()).rejects.toThrow('db-fail')`. **Why this catches a regression**: if the fix accidentally re-introduces `.catch(() => {})` or similar swallowing in the JS glue, this fails. Also documents the new "failures surface" behavior.
  2. `createTriggerNotification rejects when native rejects` — symmetric assertion. Same rationale.
- **Setup/teardown**: existing mocks in `NotifeeApiModule.test.ts` already handle module mocking. No fake timers needed.
- **Why these would have caught #549 before the fix**: they would *not* have — the race is below the Jest layer. These are **guardrails against regressions the fix itself introduces**, not #549 repros.

### 2. New Android JUnit regression tests

This is where the real coverage has to go. Two test types:

#### 2a. JVM unit tests (`packages/react-native/android/src/test/`, run by existing `tests_junit.yml`)

Room has an in-memory variant (`Room.inMemoryDatabaseBuilder`) but it requires an Android `Context` — which means either Robolectric or an instrumented test. Pure JVM Gradle tests can't instantiate Room. **Verdict**: we cannot put a Room-backed race test in `src/test/` without adding Robolectric. Adding Robolectric would expand the test infrastructure significantly (new dependency, new runner, ~10s warmup per suite) and touch more than the fix needs.

What we *can* test in pure JVM:

- **File**: `packages/react-native/android/src/test/java/app/notifee/core/database/WorkDataRepositoryFutureContractTest.java` (new)
- **Scope**: a thin unit test that mocks `WorkDataDao` (using Mockito) and verifies:
  1. Each mutation method returns a non-null `ListenableFuture<Void>`.
  2. `future.isDone()` transitions to `true` only after the mocked DAO call has returned (use a `CountDownLatch` in the mock to gate the DAO's return, then assert `future.isDone() == false` until the latch is released).
  3. DAO exceptions propagate through `future.get()` as `ExecutionException`.
- **Setup**: Mockito + JUnit 4 (already on classpath — `TimestampTriggerModelTest` proves it). No Android context needed, because Mockito stubs the DAO entirely. The only real thing we instantiate is `WorkDataRepository` — which today needs a `Context` to get the DAO; the test can inject via a package-private setter or a test-only constructor. **If the current repo doesn't expose one, the fix PR should add a `@VisibleForTesting WorkDataRepository(WorkDataDao dao, ListeningExecutorService exec)` constructor.** Document that expectation for the fix implementer.
- **Why this would have caught #549**: this test would fail today because the methods return `void`. After the fix, it locks in the new contract so future refactors can't silently regress it.

#### 2b. Instrumented tests (`packages/react-native/android/src/androidTest/`, not currently run in CI)

- **File**: `packages/react-native/android/src/androidTest/java/app/notifee/core/database/WorkDataRepositoryRaceTest.java` (new)
- **Scope**: uses real Room in-memory DB, hits every mutation in the context that matters:
  1. `insert + getAll` — after `insert(...).get()`, the row is visible in `getAll().get()`. Run 100 iterations, expect 0 misses.
  2. `cancel all semantics` — seed 50, call `deleteAll().get()`, assert `getAll().get().isEmpty()`. Run 100 iterations.
  3. The **exact repro-scenario-B analog**: seed 20, `deleteAll()` awaited, immediately `getAll()` — must be empty. Run 100 iterations. This is the test that would have caught #549.
  4. The **scenario-C analog**: call `insert(...)` awaited, immediately `getWorkDataById(id)` — must return the row. Run 100 iterations.
  5. **Concurrent stress**: fire 20 `insert` and 20 `deleteAll` calls on a `newFixedThreadPool(8)` with `invokeAll`, assert that after all futures complete the final state is deterministic (repeatable across runs given the same submission order).
- **Limitation**: won't run in CI unless we add an emulator-based job (`reactivecircus/android-emulator-runner`) to `tests_junit.yml`. Recommend adding a *separate* `tests_android_instrumented.yml` so the existing fast JVM job stays fast.
- **If CI emulator is rejected**: keep this test file anyway, gated behind a manual `yarn test:core:android:instrumented` script, and run it locally on the fix PR. Mark it as a "pre-merge manual step" in the PR checklist. The JVM test in 2a is still the CI regression gate.

### 3. Smoke-app manual verification steps

The harness already exists: `apps/smoke/TriggerRaceTestScreen.tsx`. Re-run after the fix on the Pixel 9 Pro XL with both configurations from `repro-549-findings.md`:

- **Scenario A (20 × 50)**: post-fix `canaryMissingAtZero`, `canaryMissingAt100`, `canaryLostPermanent` must **all be 0**.
- **Scenario B (30)**: post-fix `immediatelyNonZero`, `after50msNonZero`, `after500msNonZero` must **all be 0**, `maxImmediately` must be 0. This is the most sensitive gate.
- **Scenario C (30)**: post-fix `immediatelyMissing`, `after50msMissing`, `after500msMissing` must **all be 0**, `avgCreateMs` is free to move.
- **Scenario D (stress)**: `finalCount` is expected to become **non-zero and deterministic**. The exact value depends on ordering semantics chosen by the fix. Document whatever value is observed and treat it as a tracked baseline — any future change to the value is a behavior change that needs review.

Add a line to the fix PR description: *"Ran `TriggerRaceTestScreen` on Pixel 9 Pro XL (normal + slow config); B and C immediate counts are 0/30 across 5 consecutive runs."* Five consecutive zero-runs gives ~99.9% confidence that the fix removes the race (assuming the pre-fix 3.3% rate, `(1 - 0.033)^150 ≈ 0.007`).

### Testing gaps that remain after this plan

- **Reboot recovery (Caller #8)** is not directly tested at any layer. A full reboot test requires instrumented tests with adb reboot or at least `ServiceTestRule`. Accept this gap for now; rely on code review for Caller #8 and manual verification via `adb shell am broadcast -a android.intent.action.BOOT_COMPLETED` after seeding triggers.
- **BroadcastReceiver deadline** (Callers #6/#7/#8) is not directly tested. Accept this gap; document in code review that the fix must use non-blocking composition with `Futures.withTimeout` or similar.

---

## Part E — Risks and unknowns

### 1. Implicit yielding behavior from fire-and-forget

The current `execute(...)` pattern means `insert/delete/update` return to the caller thread almost instantly, and the actual Room work happens in parallel. In several places, `continueWith` lambdas rely on this implicit return to keep the future chain moving — e.g. `cancelAllNotifications` at line 542-558 completes its chain as soon as the listener registers, even though `deleteAll` hasn't run. After conversion, those chains will block on the Room write, which is a **semantically correct** change but **will extend the latency** of `cancelTriggerNotifications` and `createTriggerNotification` JS Promises by whatever the Room write takes — probably single-digit milliseconds on warm DB, but I measured `avgCancelMs ≈ 53ms` and `avgCreateMs ≈ 14ms` today, and the fix may add ~5-15ms to each. Not a regression in the bad sense, but a visible latency change. Flag in the changelog.

### 2. Contexts where blocking on a future is dangerous

Reiterating from Part B:
- **BroadcastReceivers with `goAsync()`** (Callers #6, #7, #8): never `.get()`. Use `Futures.addCallback` or `ExtendedListenableFuture.continueWith` to chain `pendingResult.finish()` onto the write future's completion. Use `Futures.withTimeout` to guarantee `finish()` runs even if Room wedges.
- **Worker completer** (Caller #5): must set `completer` exactly once. Chain the delete future's completion to `completer.set(Result.success())`.
- **JS bridge** (Callers #1-#4, reached via `Notifee.java` `Futures.addCallback`): already asynchronous — just ensure the outer `ListenableFuture` returned by `NotificationManager.*` includes the write-completion as its terminal step.

None of the 8 sites currently call `.get()`. The risk is that a future hack adds one; call that out in the PR and in a `// NEVER call .get() here` comment in `NotifeeAlarmManager.displayScheduledNotification`.

### 3. Surfaced exceptions that were previously swallowed

The mutations currently swallow exceptions. After conversion:
- **Disk-full / SQLiteFullException**: `cancelTriggerNotifications` / `createTriggerNotification` will reject their JS Promises. Previously they resolved successfully and silently lost writes. **This is strictly better** but the JS `NotifeeApiModule.test.ts` does not currently assert this path, and user code may catch-and-continue on any rejection from these methods — a user who relied on "cancel always succeeds" may need to add error handling. This is a behavior change worth a changelog footnote: "errors from the Room persistence layer now propagate to JS Promise rejections".
- **Room migration exception on first run of a repaired schema**: would previously have been lost; would now block the cancel/create call. Caveat for multi-version upgrade paths, but low risk on this fork given the Room schema is frozen at v2.
- **Caller #6 (repeat alarm update failure)**: would now log at `ERROR` via `Logger.e(TAG, "Failed to display notification", e)` (which already exists at line 131 in `displayScheduledNotification`'s completion listener). The existing listener already routes errors — good — so no change needed there.
- **Caller #8 (reboot recovery update failure)**: currently logs nothing. Post-fix, should log per-entity failures but still call `pendingResult.finish()`. The fix should add a new `Logger.w` line inside the update future's failure callback.

### 4. Singleton / lifetime concerns

- `WorkDataRepository.mInstance` is a process-lifetime singleton. Futures returned from its methods are tied to `databaseWriteListeningExecutor`, also process-lifetime. If the process is killed, pending futures are orphaned — not a regression, but worth noting: the strategy-1 fix **does not** add durability guarantees on process death. The write is still only guaranteed once it actually lands in Room. That's SQLite's problem, not ours, and it's the same constraint as any Android app.
- **Caller #2 uses `insertTriggerNotification` static helper** which references `mInstance` directly. Currently `mInstance` is populated by the prior `NotifeeInitProvider` startup path so it's non-null at call time, but a static helper that depends on implicit initialization order is fragile. **Recommendation**: while converting, change the static helper to take a `Context` and call `getInstance(context)` itself — costs one extra map lookup, removes the implicit-init coupling. Out of scope for the bare #549 fix but worth folding into the same PR (one-line change).
- **Caller #5 and #6** use `new WorkDataRepository(getApplicationContext())` *locally* (NotifeeAlarmManager.java:72, NotificationManager.java:936) instead of `getInstance(...)`. This is harmless today because both constructors wrap the same underlying Room DAO, but it means there are multiple `WorkDataRepository` instances walking around. After the fix, the local instances will also return futures — no change in semantics, but worth a note for the implementer: *do not assume instance identity matters*.

### 5. Interaction with Room's on-disk write locks

The fix makes every mutation await completion. Under the current cached thread pool + Room write lock, operations already serialize inside Room — but they can be *starved* when many are enqueued. After the fix, if a high-frequency caller (e.g., a user scheduling a trigger on every foreground resume) pumps N writes quickly, each JS Promise now waits for its turn. Worst-case latency becomes `O(queue_depth × avg_write_ms)`. On the Pixel I measured ~5ms per write, so 20 queued writes ≈ 100ms worst-case. Acceptable. Flag it, don't fix it speculatively.

---

## Recommendation

**Strategy 1 is still the right call.** Every mutation caller (8/8) is classified `AWAIT_REQUIRED` with no ambiguity — there is no call site that "just wants to fire and forget". The empirical repro confirms two of the three predicted bug variants, and the audit surfaced a previously-undocumented third variant (Caller #8, reboot recovery) that the upstream #549 thread does not discuss. Any partial fix (e.g. patch only `cancelTriggerNotifications`) would leave the reboot-recovery and create-lag variants uncovered. The conversion is mechanical, the call sites are concentrated in two files (`NotificationManager.java`, `NotifeeAlarmManager.java`), and the test baseline is green.

**No UNCERTAIN call sites** — Marco does not need to make any classification decisions before the fix proceeds. The only *implementer decisions* are: (a) whether to fold the static-helper cleanup into the same PR, (b) whether to add Robolectric for a tighter JVM unit test or rely on instrumented tests, (c) whether to wire an emulator job into CI for the instrumented test or keep it manual. My recommendation on all three: (a) yes, one-line change; (b) no, the Mockito-based JVM test in Part D §2a is enough; (c) manual for now, revisit if the instrumented test surfaces more bugs.

**Highly impactful finding flagged to Marco (repeated for visibility)**: Caller #8 in `NotifeeAlarmManager.rescheduleNotification` (line 310-316) is a fire-and-forget `update` inside the reboot recovery BroadcastReceiver. On reboot, if Android kills the process before Room drains, recurring-alarm anchors are lost and the next reboot re-arms from stale timestamps. This is **not** mentioned in upstream #549 and was missed by the first audit pass. Please confirm you want this fixed in the same PR; I strongly recommend yes.
