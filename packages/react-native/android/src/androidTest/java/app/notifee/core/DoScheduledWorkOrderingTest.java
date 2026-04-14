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
 * Instrumented regression test for caller #5 (NotificationManager.doScheduledWork
 * delete-then-completer ordering) from pre-fix-549-audit.md. Seeds a single
 * one-time trigger row, invokes doScheduledWork via a real
 * CallbackToFutureAdapter.Completer, and asserts both ordering (delete DAO
 * call returned strictly before completer.set fired) and side-effect
 * (the row is gone from Room after the test).
 *
 * Observation mechanism:
 *
 * - TimingWorkDataRepository (in package app.notifee.core.database) subclasses
 *   WorkDataRepository via the @VisibleForTesting package-private constructor
 *   and records the nanoTime at which deleteById's future completes.
 * - The production singleton is swapped to the TimingWorkDataRepository
 *   instance via reflection before the test runs and restored in @After.
 * - completerSetNanos is captured via a directExecutor listener on the
 *   resultFuture returned by CallbackToFutureAdapter.getFuture — this runs
 *   synchronously on the thread that called completer.set(...).
 *
 * Run manually:
 *     cd apps/smoke/android
 *     ./gradlew :react-native-notify-kit:connectedDebugAndroidTest \
 *         --tests app.notifee.core.DoScheduledWorkOrderingTest
 */

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.os.Bundle;
import androidx.concurrent.futures.CallbackToFutureAdapter;
import androidx.core.app.NotificationChannelCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.work.Data;
import androidx.work.ListenableWorker;
import app.notifee.core.database.TimingWorkDataRepository;
import app.notifee.core.database.WorkDataEntity;
import app.notifee.core.database.WorkDataRepository;
import app.notifee.core.utility.ObjectUtils;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.MoreExecutors;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DoScheduledWorkOrderingTest {

  private static final String TEST_ID = "do-scheduled-work-ordering-test";
  private static final String TEST_CHANNEL_ID = "do-scheduled-work-ordering-test-channel";

  private Context context;
  private WorkDataRepository realRepo;
  private TimingWorkDataRepository timingRepo;
  private Field singletonField;

  @Before
  public void setUp() throws Exception {
    context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    ContextHolder.setApplicationContext(context.getApplicationContext());

    // Prime the production singleton and seed the row via the real DB.
    realRepo = WorkDataRepository.getInstance(context);
    realRepo.deleteAll().get(5, TimeUnit.SECONDS);

    // Create a channel for the displayNotification call inside doScheduledWork.
    // Use NotificationManagerCompat directly — Notifee.getInstance() would
    // require Notifee SDK initialization which is not available in
    // instrumented tests.
    NotificationManagerCompat.from(context)
        .createNotificationChannel(
            new NotificationChannelCompat.Builder(
                    TEST_CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_DEFAULT)
                .setName("DoScheduledWorkOrderingTest")
                .build());

    // Build the timing-instrumented repo that wraps the SAME DAO as the real
    // singleton. Because NotifeeCoreDatabase.getDatabase(context) is itself a
    // singleton, realRepo and timingRepo read/write the same underlying Room
    // tables — seeding via realRepo is visible to timingRepo and vice versa.
    // The factory lives in the database package because the constructor and
    // the NotifeeCoreDatabase accessors are package-private.
    timingRepo = TimingWorkDataRepository.createForProductionDb(context);

    // Swap the singleton so NotificationManager.doScheduledWork's delete path
    // (WorkDataRepository.getInstance(ctx).deleteById(...)) goes through the
    // timing instrumentation.
    singletonField = WorkDataRepository.class.getDeclaredField("mInstance");
    singletonField.setAccessible(true);
    singletonField.set(null, timingRepo);
  }

  @After
  public void tearDown() throws Exception {
    if (singletonField != null) {
      singletonField.set(null, realRepo);
    }
    if (realRepo != null) {
      realRepo.deleteAll().get(5, TimeUnit.SECONDS);
    }
    // Best-effort: dismiss any notification the test displayed.
    androidx.core.app.NotificationManagerCompat.from(context).cancelAll();
  }

  @Test
  public void doScheduledWork_deleteCompletesBeforeCompleterSet() throws Exception {
    // Seed the row that doScheduledWork will read, display, and then delete.
    WorkDataEntity seed = buildSeedEntity(TEST_ID);
    timingRepo.insert(seed).get(5, TimeUnit.SECONDS);
    assertEquals(1, timingRepo.getAll().get(5, TimeUnit.SECONDS).size());

    // Build a real Completer via CallbackToFutureAdapter so we can wait on the
    // returned future and record the moment at which completer.set(...) fires.
    AtomicReference<CallbackToFutureAdapter.Completer<ListenableWorker.Result>> completerRef =
        new AtomicReference<>();
    ListenableFuture<ListenableWorker.Result> resultFuture =
        CallbackToFutureAdapter.getFuture(
            completer -> {
              completerRef.set(completer);
              return "DoScheduledWorkOrderingTest";
            });
    CallbackToFutureAdapter.Completer<ListenableWorker.Result> completer = completerRef.get();
    assertNotNull("Completer must be populated synchronously by getFuture", completer);

    // The listener records completerSetNanos AND counts down the latch, giving
    // the test a happens-before barrier to await on. resultFuture.get() alone
    // is insufficient — Guava only guarantees that .get() returns after the
    // future is marked done, not after all listeners have fired, so the test
    // could race the listener on a cached-threadpool scheduler.
    AtomicLong completerSetNanos = new AtomicLong();
    CountDownLatch completerListenerRan = new CountDownLatch(1);
    resultFuture.addListener(
        () -> {
          completerSetNanos.compareAndSet(0, System.nanoTime());
          completerListenerRan.countDown();
        },
        MoreExecutors.directExecutor());

    // Build the Data payload doScheduledWork expects.
    Data data =
        new Data.Builder()
            .putString("id", TEST_ID)
            .putString(Worker.KEY_WORK_REQUEST, Worker.WORK_REQUEST_ONE_TIME)
            .build();

    // Invoke the production entry point. Futures are chained internally; the
    // resultFuture resolves when completer.set(...) fires.
    NotificationManager.doScheduledWork(data, completer);

    // Wait for the work to report completion. 15s is generous — the whole chain
    // (Room read → displayNotification → Room delete → completer.set) usually
    // takes <200ms on a Pixel 9 Pro XL warm.
    ListenableWorker.Result result = resultFuture.get(15, TimeUnit.SECONDS);
    assertEquals(ListenableWorker.Result.success(), result);

    // Explicitly wait for the listener to have fired — see comment at the
    // listener registration above for why resultFuture.get() alone is racy.
    assertTrue(
        "completer.set listener must fire within 5s of resultFuture completing",
        completerListenerRan.await(5, TimeUnit.SECONDS));

    long deleteNanos = timingRepo.firstDeleteCompletionNanos.get();
    long completerNanos = completerSetNanos.get();

    assertTrue("delete DAO call must actually have completed", deleteNanos > 0);
    assertTrue("completer.set must actually have fired", completerNanos > 0);
    assertTrue(
        "delete must complete strictly before completer.set — otherwise "
            + "WorkManager could start a new work instance that reads the stale row "
            + "(pre-#549 behavior). deleteNanos="
            + deleteNanos
            + " completerNanos="
            + completerNanos
            + " deltaNanos="
            + (completerNanos - deleteNanos),
        deleteNanos < completerNanos);

    // Side-effect assertion: the row must be gone.
    assertNull(
        "row must be deleted from Room after doScheduledWork completes",
        timingRepo.getWorkDataById(TEST_ID).get(5, TimeUnit.SECONDS));
    assertTrue(
        "Room must contain no entries after doScheduledWork completes",
        timingRepo.getAll().get(5, TimeUnit.SECONDS).isEmpty());
  }

  private static WorkDataEntity buildSeedEntity(String id) {
    Bundle notificationBundle = new Bundle();
    notificationBundle.putString("id", id);
    notificationBundle.putString("title", "DoScheduledWorkOrderingTest");
    Bundle androidBundle = new Bundle();
    androidBundle.putString("channelId", TEST_CHANNEL_ID);
    // A smallIcon is required by Android's NotificationManager.fixNotification —
    // a notification without one throws IllegalArgumentException. The
    // androidTest res/drawable/test_icon.xml is a transparent placeholder that
    // exists only in the test APK.
    androidBundle.putString("smallIcon", "test_icon");
    notificationBundle.putBundle("android", androidBundle);

    Bundle triggerBundle = new Bundle();
    triggerBundle.putInt("type", 0); // TIMESTAMP
    triggerBundle.putLong("timestamp", System.currentTimeMillis());

    return new WorkDataEntity(
        id,
        ObjectUtils.bundleToBytes(notificationBundle),
        ObjectUtils.bundleToBytes(triggerBundle),
        false /* withAlarmManager — WorkManager path */);
  }
}
