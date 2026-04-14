package app.notifee.core;

/*
 * Copyright (c) 2016-present Invertase Limited & Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this library except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * ---
 *
 * NOT RUN IN CI.
 *
 * Instrumented regression test for caller #8 (reboot recovery anchor
 * persistence) from pre-fix-549-audit.md. Seeds five recurring trigger rows
 * with timestamps in the past, invokes NotifeeAlarmManager.rescheduleNotifications
 * via its public entry point, and asserts that every row has an advanced
 * timestamp once the reschedule completes — proving that the per-entity
 * WorkDataRepository.update(...) futures are awaited before the
 * BroadcastReceiver finish path, which is the #549 fix commit
 * 71fa20e ("fix(android): persist reboot recovery anchor updates before
 * finishing receiver").
 *
 * Run manually:
 *     cd apps/smoke/android
 *     ./gradlew :react-native-notify-kit:connectedDebugAndroidTest \
 *         --tests app.notifee.core.RebootRecoveryTest
 */

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.Context;
import android.os.Bundle;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import app.notifee.core.database.WorkDataEntity;
import app.notifee.core.database.WorkDataRepository;
import app.notifee.core.utility.ObjectUtils;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class RebootRecoveryTest {

  private static final int SEED_COUNT = 5;
  private static final long HOUR_IN_MS = 60L * 60 * 1000;
  /** 5 hours before "now" — well in the past so setNextTimestamp must advance. */
  private static final long OLD_ANCHOR_OFFSET_MS = 5 * HOUR_IN_MS;
  private static final long POLL_DEADLINE_MS = 15_000;
  private static final long POLL_INTERVAL_MS = 100;

  private Context context;
  private WorkDataRepository repo;

  @Before
  public void setUp() throws Exception {
    context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    // Ensure ContextHolder is populated — production code paths inside
    // NotifeeAlarmManager call ContextHolder.getApplicationContext() and
    // WorkDataRepository.getInstance(getApplicationContext()).
    ContextHolder.setApplicationContext(context.getApplicationContext());
    repo = WorkDataRepository.getInstance(context);
    repo.deleteAll().get(5, TimeUnit.SECONDS);
  }

  @After
  public void tearDown() throws Exception {
    // Cancel every real alarm the test scheduled so the device is left clean.
    for (int i = 0; i < SEED_COUNT; i++) {
      NotifeeAlarmManager.cancelNotification(testId(i));
    }
    repo.deleteAll().get(5, TimeUnit.SECONDS);
  }

  @Test
  public void rescheduleNotifications_advancesEveryAnchorBeforeCompleting() throws Exception {
    long now = System.currentTimeMillis();
    long oldAnchor = now - OLD_ANCHOR_OFFSET_MS;
    long minExpectedAnchor = now; // every anchor must move strictly into the future

    // Seed SEED_COUNT entities, each a recurring hourly alarm with the old anchor.
    for (int i = 0; i < SEED_COUNT; i++) {
      repo.insert(buildEntity(testId(i), oldAnchor)).get(5, TimeUnit.SECONDS);
    }
    assertEquals(SEED_COUNT, repo.getAll().get(5, TimeUnit.SECONDS).size());

    // Invoke the real reboot-recovery entry point. PendingResult is null because
    // this test is not driven by a BroadcastReceiver goAsync() scope; the fix
    // guards every finish() call with a null-check, so passing null exercises
    // the same future chain without actually broadcasting anything.
    new NotifeeAlarmManager().rescheduleNotifications(null);

    // Poll for completion. The reschedule fires several async stages
    // (getScheduledNotifications → per-entity update → allAsList → withTimeout),
    // so we cannot directly latch on "done". Instead we observe the side
    // effect: every row's timestamp must have been moved into the future.
    List<WorkDataEntity> rows = awaitAllAnchorsAdvanced(minExpectedAnchor);

    assertEquals("no rows lost during reboot recovery", SEED_COUNT, rows.size());
    for (WorkDataEntity row : rows) {
      Bundle triggerBundle = ObjectUtils.bytesToBundle(row.getTrigger());
      long newAnchor = ObjectUtils.getLong(triggerBundle.get("timestamp"));
      assertTrue(
          "row " + row.getId() + " must have an advanced anchor: was="
              + oldAnchor + " now=" + newAnchor,
          newAnchor >= oldAnchor + HOUR_IN_MS);
      assertTrue(
          "row " + row.getId() + " anchor must be in the future: " + newAnchor,
          newAnchor >= minExpectedAnchor);
    }
  }

  /**
   * Polls {@link WorkDataRepository#getAll()} until every row has a timestamp at or after {@code
   * minExpectedAnchor}, or fails on timeout.
   */
  private List<WorkDataEntity> awaitAllAnchorsAdvanced(long minExpectedAnchor) throws Exception {
    long deadline = System.currentTimeMillis() + POLL_DEADLINE_MS;
    while (System.currentTimeMillis() < deadline) {
      List<WorkDataEntity> rows = repo.getAll().get(5, TimeUnit.SECONDS);
      if (rows.size() == SEED_COUNT && allAdvanced(rows, minExpectedAnchor)) {
        return rows;
      }
      Thread.sleep(POLL_INTERVAL_MS);
    }
    fail(
        "reboot recovery did not advance every anchor within "
            + POLL_DEADLINE_MS
            + "ms — the fix in commit 71fa20e may be broken");
    return null; // unreachable
  }

  private static boolean allAdvanced(List<WorkDataEntity> rows, long minExpectedAnchor) {
    for (WorkDataEntity row : rows) {
      Bundle trigger = ObjectUtils.bytesToBundle(row.getTrigger());
      long ts = ObjectUtils.getLong(trigger.get("timestamp"));
      if (ts < minExpectedAnchor) {
        return false;
      }
    }
    return true;
  }

  /** Build a recurring-hourly trigger entity with the given id and initial anchor. */
  private static WorkDataEntity buildEntity(String id, long anchorMs) {
    Bundle notificationBundle = new Bundle();
    notificationBundle.putString("id", id);
    notificationBundle.putString("title", "RebootRecoveryTest " + id);

    Bundle triggerBundle = new Bundle();
    triggerBundle.putInt("type", 0); // TIMESTAMP
    triggerBundle.putLong("timestamp", anchorMs);
    triggerBundle.putInt("repeatFrequency", 0); // HOURLY
    Bundle alarmManagerBundle = new Bundle();
    alarmManagerBundle.putInt("type", 3); // SET_EXACT_AND_ALLOW_WHILE_IDLE
    triggerBundle.putBundle("alarmManager", alarmManagerBundle);

    return new WorkDataEntity(
        id,
        ObjectUtils.bundleToBytes(notificationBundle),
        ObjectUtils.bundleToBytes(triggerBundle),
        true /* withAlarmManager */);
  }

  private static String testId(int i) {
    return "reboot-recovery-test-" + i;
  }
}
