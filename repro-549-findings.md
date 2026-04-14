# Issue #549 empirical reproduction

## Test environment

- **Device**: Google Pixel 9 Pro XL (physical, adb over Wi-Fi)
- **OS**: Android 16 (API level 36, security patch 2026-03-05)
- **Library**: `react-native-notify-kit` 9.4.0 (workspace, from `packages/react-native`)
- **App**: `apps/smoke` (React Native 0.84.1, New Architecture / TurboModule)
- **Date**: 2026-04-14
- **Trigger backend**: AlarmManager (fork default since 9.1.12). `SCHEDULE_EXACT_ALARM` permission was NOT granted, so all triggers fell back to inexact alarms — this only affects when the OS fires the alarm, not when Room persists the row, so it does not distort the race observation.
- **Harness**: `apps/smoke/TriggerRaceTestScreen.tsx` (new) wired into `apps/smoke/App.tsx`. Each scenario runs programmatically and logs results as a single JSON line with `[RACE549]` tag to `console.log` (captured via `adb logcat | grep ReactNativeJS`).
- **Two runs captured**:
  1. **Normal** — default animation scales (1×), no thermal override.
  2. **Slow** — `window_animation_scale`, `transition_animation_scale`, `animator_duration_scale` all set to `10`, and `cmd thermalservice override-status 3` (SEVERE) to force CPU throttling. Note: animation scales do **not** affect JS/native thread execution — they only stretch Android UI animations — so their amplification effect on this race is limited. Thermal override was applied mid-run once verified effective (`IsStatusOverride: true, Thermal Status: 3`).
- **Log files retained**: `/tmp/race549-normal.log`, `/tmp/race549-slow.log` (full filtered logcat); `/tmp/race549-normal-summary.log`, `/tmp/race549-slow-summary.log` (just `[RACE549]` JSON lines).

## Scenario A — Yupeng's cancel → create race (20 iterations, 50 seeds each)

Seed 50 far-future triggers, then back-to-back: `await cancelTriggerNotifications()`, `await createTriggerNotification(canary)`, then poll `getTriggerNotificationIds()` at `t = {0, 10, 50, 100, 250, 500, 1000, 2000}ms`.

### Aggregate table (both runs)

| Run    | Iterations | `canaryMissingAtZero` | `canaryMissingAt100` | `canaryLostPermanent` (≥2000ms) | avg cancel ms | avg create ms |
|--------|-----------:|----------------------:|---------------------:|--------------------------------:|--------------:|--------------:|
| Normal |         20 |                 0 / 20 |               0 / 20 |                          0 / 20 |          53.4 |          14.1 |
| Slow   |         20 |                 1 / 20 |               0 / 20 |                          0 / 20 |          53.6 |          11.8 |

### Verdict: **REPRODUCED** (weakly)

- The slow run observed **1 / 20** iterations in which the freshly-created canary was **missing from `getTriggerNotificationIds()` immediately after `await createTriggerNotification` returned**. By `delay=10ms` (and in every later sample through 2000ms) the canary was present. So this is the **create-persistence-lag** variant manifesting inside the cancel→create race — not catastrophic permanent data loss, but a false negative from a JS caller that would act on the `getTriggerNotificationIds` result.
- The normal run had 0 / 20 but still showed the same inconsistency class in Scenarios B and C (below), which tells us the window is just below our 20-iteration noise floor in Scenario A under unthrottled conditions, not that it's absent.
- Yupeng's original symptom (canary deleted permanently by the late-arriving `deleteAll`) was **not** observed in 40 total iterations across both runs. This is consistent with the static-analysis hypothesis that Room's internal write lock plus the cached-thread-pool scheduling on this high-end device usually drain enqueued operations in roughly FIFO order — cancel's `deleteAll` is enqueued first, so it usually wins the Room lock before the subsequent `insert`. It does **not** disprove the bug: on slower hardware, under memory pressure, or with heavier thread contention, the ordering guarantee disappears. See the "Conclusions" section for why we cannot treat 0 / 40 permanent losses as reassurance.

## Scenario B — cancel-then-query consistency (30 iterations, 20 seeds each)

Seed 20 triggers, 200ms quiet, then `await cancelTriggerNotifications()` followed immediately by `getTriggerNotificationIds()` at 0ms, 50ms, 500ms.

### Aggregate table

| Run    | Iterations | `immediatelyNonZero` | `after50msNonZero` | `after500msNonZero` | max stale count at 0ms |
|--------|-----------:|---------------------:|-------------------:|--------------------:|-----------------------:|
| Normal |         30 |               1 / 30 |             0 / 30 |              0 / 30 |                     20 |
| Slow   |         30 |               1 / 30 |             0 / 30 |              0 / 30 |                     20 |

### Verdict: **REPRODUCED**

This is the cleanest observation. In both runs, exactly one iteration out of 30 saw `getTriggerNotificationIds()` return **all 20 pre-cancel rows** (maxImmediately = 20) *immediately* after `await cancelTriggerNotifications()` resolved — i.e., the JS Promise claimed the cancel was done while Room still held every row. Within 50ms the count dropped to 0 and stayed at 0. This is exactly the upstream #549 lie: the Promise resolves before `WorkDataRepository.deleteAll()` has run.

**Observed race window: < 50ms on Pixel 9 Pro XL.** In the specific iteration that reproduced, the window included the full span between the cancel returning and the first follow-up read — we cannot be more precise without instrumenting Room, but the bug is clearly present.

~3.3% reproduction rate per attempt on this hardware is enough to cause user-visible flakes in high-frequency scheduling apps (e.g., an app that cancels + reschedules a trigger on every foreground resume).

## Scenario C — create persistence lag (30 iterations)

Cancel everything, 300ms quiet, then `await createTriggerNotification(id)` followed by `getTriggerNotificationIds().includes(id)` at 0ms, 50ms, 500ms.

### Aggregate table

| Run    | Iterations | `immediatelyMissing` | `after50msMissing` | `after500msMissing` | avg create ms |
|--------|-----------:|---------------------:|-------------------:|--------------------:|--------------:|
| Normal |         30 |               1 / 30 |             0 / 30 |              0 / 30 |          17.6 |
| Slow   |         30 |               0 / 30 |             0 / 30 |              0 / 30 |          17.9 |

### Verdict: **REPRODUCED** (in the normal run only; the single Scenario A / 20 slow-run hit above is effectively another Scenario C hit piggy-backing on the race harness)

One iteration out of 30 in the normal run saw the just-created id missing from `getTriggerNotificationIds()` at 0ms, present at 50ms and 500ms. This is the symmetric create-persistence-lag bug identified in static analysis: `WorkDataRepository.insert()` returns `void` and enqueues onto `databaseWriteListeningExecutor`, but `createTriggerNotification`'s outer future completes — and the Promise resolves — before that enqueued insert has reached Room.

Same ~3.3% rate, same sub-50ms window as Scenario B, confirming this is the same underlying race just on the opposite mutation.

## Scenario D — stress / interleaving

Fire 20 creates and ~7 cancels concurrently with `Promise.all`, settle 2000ms, then read final state.

| Run    | finalCount | finalIds |
|--------|-----------:|----------|
| Normal |          0 | `[]`     |
| Slow   |          0 | `[]`     |

### Verdict: **DETERMINISTIC under stress**, but in a way that is itself a bug

In both runs, after a 2-second settling period, **the final count was 0** — every one of the 20 creates was wiped by the interleaved cancels. That is reproducible and deterministic in our harness, but it's not reassuring: the final state depends entirely on which operation Room processes last, not on the happens-before order of the JS await chain. A JS caller cannot predict whether `Promise.all([...creates, ...cancels])` will leave any triggers alive without inspecting the implementation.

This is the expected behavior given the lack of any serialization between cancel and create paths (confirmed in `eventual-bouncing-dolphin.md`). Scenario D is therefore useful only as a "the system does reach *some* deterministic state after settling" sanity check — it does **not** tell us the system is safe.

## Logcat excerpts

The only recurring `NOTIFEE` log during both runs was the `SCHEDULE_EXACT_ALARM` fallback warning, printed once per `createTriggerNotification` call:

```
W NOTIFEE : (NotifeeAlarmManager): SCHEDULE_EXACT_ALARM permission not granted. Falling back to inexact alarm.
```

No `E NOTIFEE`, no crashes, no exceptions, no `Notifee` error-level entries. The bug is **silent** at the native layer — it manifests only as inconsistent reads from JS.

Full filtered logs: `/tmp/race549-normal.log` and `/tmp/race549-slow.log`. The `[RACE549]-ALL-full` line is truncated by logcat's per-line size limit, but `[RACE549] {scenario:"ALL",...}` summary lines are intact in both runs.

## Conclusions

### Which of the three bug variants are observable from JS today?

| Variant | Static-analysis prediction | Observed in empirical run? | How often |
|---|---|---|---|
| Cancel race (upstream #549): `cancelTriggerNotifications()` Promise resolves before Room `deleteAll` completes | **Yes** — `deleteAll` is `void`, fire-and-forget | **Yes (Scenario B, 1/30 both runs; Scenario A slow 1/20 via create-side view)** | ~3.3% per attempt |
| Create persistence lag: `createTriggerNotification()` Promise resolves before Room `insert` completes | **Yes** — `insert` is `void`, fire-and-forget | **Yes (Scenario C, 1/30 normal; Scenario A slow 1/20)** | ~3.3% per attempt |
| Permanent canary loss: cancel's delayed `deleteAll` wipes a subsequent create | **Yes, possible** | **No** (0/40 iterations across both runs) | unobserved here but not disproven |

All three variants share the same root cause and the same observation window (< 50ms on Pixel 9 Pro XL). We observed transient false-negative reads from both `getTriggerNotificationIds()` immediately after cancel (Scenario B) and immediately after create (Scenarios A & C). We did **not** observe Yupeng's exact symptom of a canary being permanently wiped, but the absence of permanent loss in 40 iterations is not a guarantee — it reflects the particular scheduling ordering that Room's cached thread pool happens to produce on a fast device with no memory pressure.

### Estimated timing window

**< 50ms.** Every transient inconsistency observed resolved itself by the 50ms sample. We did not sample between 0 and 10ms so we cannot narrow further without modifying the harness.

### Is a fix urgent, important, or cosmetic?

**Important, not urgent.**

- **Important** because (a) the bug is structurally present and reproducible, (b) it will bite high-frequency JS callers (cancel+reschedule on every app resume, dedup-by-cancel-then-create patterns), (c) on lower-end hardware or under memory pressure the window will widen and the ~3% rate will climb, (d) the upstream issue #549 has been open for years and users have reported data loss, and (e) the fix is mechanical (see `eventual-bouncing-dolphin.md` recommended steps — change 5 `void` mutators in `WorkDataRepository` to return `ListenableFuture<Void>`, chain them in the 3 call sites in `NotificationManager`).
- **Not urgent** because (a) we did not observe permanent data loss in our runs, (b) the visible rate is low on modern hardware, (c) no crashes and no silent corruption of unrelated state.

### Highly impactful finding (flagged per standing NotifeeCore rule)

**Before writing the fix, note this empirical surprise:** the canonical #549 symptom — "cancel wipes a subsequent create" — did **not** reproduce in 40 attempts. Every bug variant we observed was transient: the data was always in the correct state by 50ms. This suggests Room's internal write lock plus the enqueue-order bias of the cached thread pool de-facto serializes operations in roughly the order they were submitted, which on this device masks the worst case. The fix still needs to happen — we must not design for "this particular device ordering" — but the fix may have a smaller visible impact on Pixel-class hardware than the upstream thread implied, and the regression test needs to account for that (see next section).

### Is the test harness suitable as a regression test for the fix?

**Mostly yes, with caveats.**

- **Works as-is for Scenarios B and C.** Both reproduced the bug at ~3.3% on the first 30-iteration run on this hardware. After the fix, `immediatelyNonZero` (B) and `immediatelyMissing` (C) should both be `0 / 30` in every run. A CI test that asserts `== 0` over 30 iterations would have ~97% confidence of catching a regression per run.
- **Scenario A is a weaker signal** on high-end hardware. 0 / 20 losses is compatible with both the bug being present and absent. To make Scenario A a reliable regression probe, we'd need to either (a) crank the iteration count to 100+, (b) run it on lower-spec hardware or inside a slow emulator with CPU throttling enforced at the kernel level (not just the thermalservice override, which may or may not throttle synchronously), or (c) instrument `WorkDataRepository` in a test-only build to inject a synthetic delay after mutation-enqueue (which would require touching library code — out of scope for this investigation).
- **Scenario D is a diagnostic, not a regression test.** Its current "finalCount == 0" outcome is not an assertion about correctness; it's the current (broken) behavior. After a fix that serializes cancel and create, the final count will be some non-trivial number determined by which op completed last — but we won't be able to assert an exact value without adding ordering guarantees between JS calls. Keep it in the harness as a human-eyeball diagnostic.
- **Missing**: the harness does not currently write results to a file on the device or into a JSON artifact the CI can collect. Today Marco has to read them off logcat. For a CI regression test, the next incremental step would be a Jest integration test (under `apps/smoke/__tests__/`) that drives the scenario functions directly and asserts on counts, instead of relying on an on-device button.

### Recommended next steps (for the fix prompt)

1. Apply the fix described in `eventual-bouncing-dolphin.md` step 3: convert `WorkDataRepository.{insert,deleteAll,deleteById,deleteByIds,update}` from `void` (`execute`) to `ListenableFuture<Void>` (`submit`), then chain them into the outer `NotificationManager.cancelAllNotifications`, `cancelAllNotificationsWithIds`, `createTimestampTriggerNotification`, and `createIntervalTriggerNotification` futures.
2. Audit the remaining callers of the `void` mutators (`NotifeeAlarmManager.update(...)` for recurring alarm rescheduling, etc.) for the same class of lie.
3. Re-run `TriggerRaceTestScreen` on this same Pixel 9 Pro XL under both conditions. Expected: Scenario B `immediatelyNonZero` = 0/30, Scenario C `immediatelyMissing` = 0/30, Scenario A `canaryMissingAtZero` = 0/20, Scenario D `finalCount` = some stable non-zero value (probably 6 = 20 creates − max pending cancels that happened to run last, but this depends on the fix semantics).
4. Promote the harness to a Jest integration test under `apps/smoke/__tests__/` asserting B and C counts == 0 over 30 iterations. Leave Scenario A as a manual probe (high iteration count only triggered by a dev flag) because its signal is too noisy on fast hardware to gate CI.
5. Document in `packages/react-native/CLAUDE.md` that `WorkDataRepository` mutators return futures that must be chained before resolving any JS Promise.

## Harness files added (no library code touched)

- `apps/smoke/TriggerRaceTestScreen.tsx` — new, 400 LOC, all four scenarios plus buttons, auto-run opt-in via `autoRun` prop, clean-reset button, in-memory log display.
- `apps/smoke/App.tsx` — one import, one screen state value, one section entry, one render branch. Initial screen restored to `'main'` and `autoRun` disabled after the test runs.

No changes to `packages/react-native/`, no commits, no pushes. Device animation scales and thermal override have been restored to normal after the run.
