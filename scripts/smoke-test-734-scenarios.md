# Manual smoke scenarios — upstream issue #734

This document accompanies `scripts/smoke-test-734.sh`. Each scenario below is a
manual recipe: a sequence of script subcommands, actions on the device, and
expected observable output (logcat fingerprints + Room DB state + Preferences
state). Run each scenario on a **throwaway emulator or dedicated test device**.
Never on a personal phone — at least one scenario wipes the notifee Room DB.

## Prerequisites

- `adb` on PATH.
- Exactly one Android device connected (`adb devices` shows one `device` line).
- A debug build of the smoke app installed via `scripts/smoke-test-734.sh build`.
- A backup (or throwaway state) of any notifee notifications you cared about —
  several scenarios wipe them.

## Log fingerprints

The fix paths log at `Logger.i` with consistent TAG prefixes. All lines are
emitted under the `NOTIFEE` Android logcat tag.

| Path | Fingerprint |
|------|-------------|
| RebootBroadcastReceiver fired (BOOT_COMPLETED delivered) | `NOTIFEE (RebootReceiver): Received reboot event` |
| RebootBroadcastReceiver sync failure (try/catch guard, Step 1) | `NOTIFEE (RebootReceiver): Failed to reschedule notifications after reboot` |
| NotifeeAlarmManager reschedule pass started | `NOTIFEE (NotifeeAlarmManager): Reschedule Notifications on reboot` |
| NotifeeAlarmManager reschedule pass batch size | `NOTIFEE (NotifeeAlarmManager): Reschedule starting for N recurring alarms` |
| Stale non-repeating trigger, within 24h grace (Step 2) | `NOTIFEE (NotifeeAlarmManager): Firing stale non-repeating trigger once within grace period (age Nms): ID` |
| Stale non-repeating trigger, beyond 24h grace (Step 2) | `NOTIFEE (NotifeeAlarmManager): Deleting stale non-repeating trigger (age Nms > ...): ID` |
| Race guard rejection (concurrent reschedule, Step 3) | `NOTIFEE (NotifeeAlarmManager): Reschedule already in progress, skipping duplicate request` |
| InitProvider BOOT_COUNT baseline recorded (first run) | `NOTIFEE (InitProvider): First run: recording BOOT_COUNT baseline N` |
| InitProvider BOOT_COUNT delta detected (cold-start recovery) | `NOTIFEE (InitProvider): Boot detected since last run (X -> Y), rescheduling` |
| InitProvider BOOT_COUNT unavailable (conservative path) | `NOTIFEE (InitProvider): BOOT_COUNT unavailable; running conservative reschedule to be safe` |
| Cold-start reschedule failed (outer catch in runBootCheck) | `NOTIFEE (InitProvider): Cold-start reschedule check failed` |

Every reschedule pass, regardless of entry point, should also emit one of
these terminals once the async chain completes:
- `NOTIFEE (NotifeeAlarmManager): Failure in rescheduleNotifications` (on error)
- (silent success — no dedicated log line, the PendingResult just finishes)

## Scenario 1 — Baseline happy path (future trigger, reboot)

**Goal**: verify that a trigger scheduled before a reboot still fires at its
originally scheduled time on a device where BOOT_COMPLETED *is* delivered normally.

**Why**: regression guard for the existing reboot recovery path. Must still work.

1. `scripts/smoke-test-734.sh build`
2. `scripts/smoke-test-734.sh logcat-clear`
3. On the device, open the smoke app and tap **createTriggerNotification (+10s)** —
   wait a few seconds, then close the app (not force-stop).
4. Re-open the button and tap it once more, but this time **reboot within the
   10-second window**: `scripts/smoke-test-734.sh reboot --i-know`
5. After reconnection, keep the device idle. **Do not open the smoke app.**
6. Watch for the notification at the originally scheduled time via the device UI.
7. Capture logs: `scripts/smoke-test-734.sh logcat-dump /tmp/s1-logcat.txt`

**Expected** in `/tmp/s1-logcat.txt`:
- `NOTIFEE (RebootReceiver): Received reboot event`
- `NOTIFEE (NotifeeAlarmManager): Reschedule Notifications on reboot`
- `NOTIFEE (NotifeeAlarmManager): Reschedule starting for 1 recurring alarms` (or more)
- Followed by the notification firing and `NotificationManager` delivery logs.

**Fail modes**:
- No `RebootReceiver` line → BOOT_COMPLETED not delivered by the device
  (suggests OEM autostart restriction — see Scenario 4).
- `Failed to reschedule` line → Step 1 guard caught a regression; inspect
  stack trace.

## Scenario 2 — Zombie trigger, within grace period (fire-once-then-delete)

**Goal**: verify that a non-repeating trigger whose fire time passed while the
device was off (or the app was killed) fires once on recovery and then its
row is removed from the Room DB.

**Why**: this is the core #734 fix. Without it, the trigger re-fires on every
subsequent reboot forever.

This scenario cannot be reproduced without modifying the smoke app to schedule
a trigger with a past timestamp (the JS validators reject timestamps in the
past). **Use the instrumented `RebootRecoveryTest` instead** — it seeds the
row directly into Room via the Java API which bypasses the validators.

1. `scripts/smoke-test-734.sh reset-state --i-know`
2. `scripts/smoke-test-734.sh instrumented-tests --i-know`

**Expected**: gradle reports `BUILD SUCCESSFUL` with `RebootRecoveryTest`
running 4 tests, all passing. The two Step 2 cases are:
- `rescheduleNotifications_staleNonRepeating_withinGracePeriod_rowIsDeleted`
- `rescheduleNotifications_staleNonRepeating_beyondGracePeriod_rowIsDeleted`

If the tests fail, inspect the gradle test report HTML at
`packages/react-native/android/build/reports/androidTests/connected/` for the
failing assertion. The most common failure mode would be the
`awaitRowDeleted(id)` poll timing out, meaning the stale-handling branch did
not reach the Room `deleteById` call.

## Scenario 3 — Zombie trigger, beyond grace period (delete-silent)

**Goal**: verify that a non-repeating trigger more than 24h stale is deleted
silently without firing the notification.

**Why**: avoids showing contextually irrelevant content to users whose devices
were off for a long time.

Same recipe as Scenario 2 — the same instrumented run covers both cases:
`rescheduleNotifications_staleNonRepeating_beyondGracePeriod_rowIsDeleted`.

**Expected logcat** fingerprint during the test run:
`NOTIFEE (NotifeeAlarmManager): Deleting stale non-repeating trigger (age ...ms > 86400000ms grace period): reboot-recovery-stale-beyond-grace-test`

If `NotificationManagerCompat.notify` is called during this path (the late-fire
path), that is a regression in the decision tree — the grace threshold is
ignored. Check `NotifeeAlarmManager.handleStaleNonRepeatingTrigger` staleness
comparison.

## Scenario 4 — Cold-start recovery after suppressed BOOT_COMPLETED

**Goal**: verify that even on a device where BOOT_COMPLETED was NOT delivered
(OEM autostart suppression), opening the smoke app triggers a reschedule of
any pending alarms via the new `InitProvider` BOOT_COUNT path.

**Why**: this is the main #734 mitigation for Xiaomi / OnePlus / Huawei /
Oppo / Vivo / Samsung devices where the user has not enabled autostart. On a
Pixel emulator BOOT_COMPLETED is always delivered so the scenario must be
simulated.

Simulation recipe (works on any emulator or normal test device):

1. `scripts/smoke-test-734.sh reset-state --i-know`
2. `scripts/smoke-test-734.sh build`  (opens the app, which will run
   `InitProvider.onCreate` → `runBootCheck` → first-run path, recording the
   current BOOT_COUNT as baseline)
3. `scripts/smoke-test-734.sh prefs-dump`
   - Expect a line like `<int name="notifee_last_known_boot_count" value="N" />`
   - Note the value N.
4. In the smoke app, tap **createTriggerNotification (+10s)** and wait for the
   notification to fire (confirms alarm plumbing is healthy).
5. Schedule another trigger the same way, but this time **force-stop the app
   before 10s** so it becomes a pending alarm with a future timestamp:
   `adb shell am force-stop com.notifeeexample`
6. `scripts/smoke-test-734.sh db-dump`
   - Expect `COUNT(*) == 1` with one row whose `with_alarm_manager == 1`.
7. `scripts/smoke-test-734.sh logcat-clear`
8. `scripts/smoke-test-734.sh reboot --i-know`
9. After reconnection: **do not open the smoke app yet**.
   `scripts/smoke-test-734.sh boot-count` should show a value strictly larger
   than N (the baseline recorded earlier).
10. Open the smoke app manually (e.g. via launcher icon).
11. `scripts/smoke-test-734.sh logcat-dump /tmp/s4-logcat.txt`

**Expected** in `/tmp/s4-logcat.txt`:

- `NOTIFEE (InitProvider): Boot detected since last run (N -> N+1), rescheduling`
- `NOTIFEE (NotifeeAlarmManager): Reschedule Notifications on reboot`
- On a device that DID also deliver BOOT_COMPLETED (most Pixels/emulators),
  **both** paths fire. One wins the `compareAndSet`; the other logs:
  `NOTIFEE (NotifeeAlarmManager): Reschedule already in progress, skipping duplicate request`
- `scripts/smoke-test-734.sh prefs-dump` now shows the updated baseline.

**Fail modes**:
- No `Boot detected since last run` line → `InitProvider.dispatchBootCheck`
  did not run, or BOOT_COUNT didn't change (unlikely after a real reboot).
- No `Reschedule already in progress` line **and** two `Reschedule starting`
  lines → race guard is broken (both passes ran to completion in parallel).
  This would manifest as double-advancement for past-repeating triggers.
- `Cold-start reschedule check failed` with a stack trace → the helper itself
  threw; inspect the trace.

## Scenario 5 — Repeating trigger, reboot, DST regression check

**Goal**: verify that the DST-safe `setNextTimestamp` advancement (commit
`802f1b8`) still works correctly after the Step 2 stale-handling helper was
added, and that the race guard does not cause the advancement to happen twice.

**Why**: regression guard for the 9.1.14 DST fix. The helper inserted before
`scheduleTimestampTriggerNotification` must not interfere with the repeating
path.

1. `scripts/smoke-test-734.sh reset-state --i-know`
2. Modify `apps/smoke/App.tsx` locally to schedule a DAILY trigger via
   `notifee.createTriggerNotification({...}, { type: TriggerType.TIMESTAMP,
   timestamp: <now + 2 minutes>, repeatFrequency: RepeatFrequency.DAILY })`.
   Build and install.
3. Wait for the first fire.
4. `scripts/smoke-test-734.sh db-dump` — row must still exist (repeating).
5. `scripts/smoke-test-734.sh logcat-clear`
6. `scripts/smoke-test-734.sh reboot --i-know`
7. `scripts/smoke-test-734.sh logcat-dump /tmp/s5-logcat.txt`

**Expected**:
- `NOTIFEE (NotifeeAlarmManager): Reschedule Notifications on reboot`
- `NOTIFEE (NotifeeAlarmManager): Reschedule starting for 1 recurring alarms`
- **Exactly one** "Reschedule starting" line (if both reboot-receiver and
  cold-start fire, the second is suppressed by the race guard with
  `Reschedule already in progress, skipping duplicate request`).
- The DAILY trigger should fire again ~24h from the original fire time, not
  ~48h (double-advancement) or immediately (no advancement).
- `scripts/smoke-test-734.sh db-dump` still shows 1 row with the same id.

## Quick checklist to paste into a bug report if something fails

```
Device / emulator: <model + Android version>
Notifee fork commit: <output of `git rev-parse HEAD`>
Scenario: <1 | 2 | 3 | 4 | 5>
Steps taken: <...>
Expected fingerprint: <from tables above>
Actual logcat (notifee tag): <attach /tmp/sN-logcat.txt>
DB state (db-dump output): <attach>
Prefs state (prefs-dump output): <attach>
```
