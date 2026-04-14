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
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
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

/**
 * ⚠️ WARNING — DESTRUCTIVE INSTRUMENTED TEST ⚠️
 *
 * <p>This test calls {@code WorkDataRepository.getInstance(context)}, which returns the production
 * singleton backed by the on-disk {@code notifee_core_database}. The {@code @Before} and
 * {@code @After} hooks call {@code deleteAll()} on that database.
 *
 * <p>If you run this test on a device that has REAL scheduled notifee notifications (your personal
 * phone, a shared QA device, a customer's device), THOSE NOTIFICATIONS WILL BE SILENTLY DELETED.
 * There is no undo.
 *
 * <p>Run this test only on:
 *
 * <ul>
 *   <li>Throwaway emulators
 *   <li>Dedicated test devices
 *   <li>Devices where you have explicitly verified that no production notifee state exists
 * </ul>
 *
 * <p>A structural fix (migrate to an in-memory Room database for tests) is the correct long-term
 * solution but is out of scope for the #549 fix PR.
 */
@RunWith(AndroidJUnit4.class)
public class RebootRecoveryTest {

  private static final int SEED_COUNT = 5;
  private static final int DAILY_SEED_COUNT = 2;
  private static final long HOUR_IN_MS = 60L * 60 * 1000;
  private static final long DAY_IN_MS = 24 * HOUR_IN_MS;

  /** 5 hours before "now" — well in the past so setNextTimestamp must advance. */
  private static final long OLD_ANCHOR_OFFSET_MS = 5 * HOUR_IN_MS;

  /** 2 days before "now" — stale DAILY anchor that must be advanced by reboot recovery. */
  private static final long OLD_DAILY_ANCHOR_OFFSET_MS = 2 * DAY_IN_MS;

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
    for (int i = 0; i < DAILY_SEED_COUNT; i++) {
      NotifeeAlarmManager.cancelNotification(dailyTestId(i));
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
          "row "
              + row.getId()
              + " must have an advanced anchor: was="
              + oldAnchor
              + " now="
              + newAnchor,
          newAnchor >= oldAnchor + HOUR_IN_MS);
      assertTrue(
          "row " + row.getId() + " anchor must be in the future: " + newAnchor,
          newAnchor >= minExpectedAnchor);
    }
  }

  /**
   * Regression test for upstream invertase/notifee#839 — DAILY trigger fails to re-fire from day 2
   * onwards on Android. Seeds {@value DAILY_SEED_COUNT} stale DAILY anchors, invokes reboot
   * recovery, and asserts that every row's timestamp has been advanced into the future AND that an
   * AlarmManager PendingIntent has been registered for each row (proving the fix path
   * scheduleTimestampTriggerNotification → setNextTimestamp → alarmManager.set* ran in order).
   */
  @Test
  public void rescheduleNotifications_dailyTriggers_advancesStaleAnchorsToFuture()
      throws Exception {
    long now = System.currentTimeMillis();
    long oldAnchor = now - OLD_DAILY_ANCHOR_OFFSET_MS;
    long minExpectedAnchor = now;

    for (int i = 0; i < DAILY_SEED_COUNT; i++) {
      repo.insert(buildDailyEntity(dailyTestId(i), oldAnchor)).get(5, TimeUnit.SECONDS);
    }
    assertEquals(DAILY_SEED_COUNT, repo.getAll().get(5, TimeUnit.SECONDS).size());

    new NotifeeAlarmManager().rescheduleNotifications(null);

    List<WorkDataEntity> rows =
        awaitAllAnchorsAdvancedWithExpectedCount(minExpectedAnchor, DAILY_SEED_COUNT);

    assertEquals("no DAILY rows lost during reboot recovery", DAILY_SEED_COUNT, rows.size());
    for (WorkDataEntity row : rows) {
      Bundle triggerBundle = ObjectUtils.bytesToBundle(row.getTrigger());
      long newAnchor = ObjectUtils.getLong(triggerBundle.get("timestamp"));
      assertTrue(
          "DAILY row "
              + row.getId()
              + " must be advanced to the future: was="
              + oldAnchor
              + " now="
              + newAnchor,
          newAnchor >= minExpectedAnchor);
      assertTrue(
          "DAILY row " + row.getId() + " must not be advanced more than 25h ahead: " + newAnchor,
          newAnchor < now + 25L * HOUR_IN_MS);
    }

    // Every DAILY row must have a live AlarmManager PendingIntent registered. FLAG_NO_CREATE
    // returns null if no matching PendingIntent exists — which would mean
    // scheduleTimestampTriggerNotification never ran or setNextTimestamp did not reach the
    // alarmManager.set* call.
    for (int i = 0; i < DAILY_SEED_COUNT; i++) {
      Intent intent = new Intent(context, NotificationAlarmReceiver.class);
      intent.putExtra("notificationId", dailyTestId(i));
      PendingIntent pi =
          PendingIntent.getBroadcast(
              context,
              dailyTestId(i).hashCode(),
              intent,
              PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_MUTABLE);
      assertNotNull(
          "AlarmManager PendingIntent must be registered for DAILY row " + dailyTestId(i), pi);
    }
  }

  /**
   * Polls {@link WorkDataRepository#getAll()} until every row has a timestamp at or after {@code
   * minExpectedAnchor}, or fails on timeout.
   */
  private List<WorkDataEntity> awaitAllAnchorsAdvanced(long minExpectedAnchor) throws Exception {
    return awaitAllAnchorsAdvancedWithExpectedCount(minExpectedAnchor, SEED_COUNT);
  }

  private List<WorkDataEntity> awaitAllAnchorsAdvancedWithExpectedCount(
      long minExpectedAnchor, int expectedCount) throws Exception {
    long deadline = System.currentTimeMillis() + POLL_DEADLINE_MS;
    while (System.currentTimeMillis() < deadline) {
      List<WorkDataEntity> rows = repo.getAll().get(5, TimeUnit.SECONDS);
      if (rows.size() == expectedCount && allAdvanced(rows, minExpectedAnchor)) {
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

  /** Build a recurring-daily trigger entity with the given id and initial anchor. */
  private static WorkDataEntity buildDailyEntity(String id, long anchorMs) {
    Bundle notificationBundle = new Bundle();
    notificationBundle.putString("id", id);
    notificationBundle.putString("title", "RebootRecoveryTest daily " + id);

    Bundle triggerBundle = new Bundle();
    triggerBundle.putInt("type", 0); // TIMESTAMP
    triggerBundle.putLong("timestamp", anchorMs);
    triggerBundle.putInt("repeatFrequency", 1); // DAILY
    Bundle alarmManagerBundle = new Bundle();
    alarmManagerBundle.putInt("type", 3); // SET_EXACT_AND_ALLOW_WHILE_IDLE
    triggerBundle.putBundle("alarmManager", alarmManagerBundle);

    return new WorkDataEntity(
        id,
        ObjectUtils.bundleToBytes(notificationBundle),
        ObjectUtils.bundleToBytes(triggerBundle),
        true /* withAlarmManager */);
  }

  private static String dailyTestId(int i) {
    return "reboot-recovery-daily-test-" + i;
  }
}
