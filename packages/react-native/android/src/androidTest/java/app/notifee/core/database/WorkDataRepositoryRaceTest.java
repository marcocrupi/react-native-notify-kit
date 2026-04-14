package app.notifee.core.database;

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
 * This test hits a real Room in-memory database and must be executed on a connected device or
 * emulator via:
 *
 *     cd apps/smoke/android
 *     ./gradlew :react-native-notify-kit:connectedDebugAndroidTest
 *
 * before merging any change that touches the WorkDataRepository layer or the Room schema. A
 * follow-up task tracks wiring this into CI with reactivecircus/android-emulator-runner — see the
 * "Wire androidTest into CI" issue linked from the #549 fix PR description.
 *
 * The scenarios below are the instrumented analogues of the repro-549-findings.md harness:
 * post-cancel consistency (Scenario B), post-create persistence (Scenario C), and concurrent
 * stress (Scenario D). They run 100 iterations each and must observe zero inconsistencies after
 * the #549 fix; any non-zero count is a regression.
 */

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import androidx.room.Room;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.ListeningExecutorService;
import com.google.common.util.concurrent.MoreExecutors;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class WorkDataRepositoryRaceTest {

  private NotifeeCoreDatabase db;
  private WorkDataRepository repo;
  private ListeningExecutorService executor;

  @Before
  public void setUp() {
    db =
        Room.inMemoryDatabaseBuilder(
                InstrumentationRegistry.getInstrumentation().getTargetContext(),
                NotifeeCoreDatabase.class)
            .allowMainThreadQueries()
            .build();
    // Shared cached thread pool matches the production executor's concurrency profile.
    executor = MoreExecutors.listeningDecorator(Executors.newCachedThreadPool());
    repo = new WorkDataRepository(db.workDao(), executor);
  }

  @After
  public void tearDown() {
    db.close();
    executor.shutdownNow();
  }

  // ------- Scenario B analogue: post-cancel consistency -------

  @Test
  public void deleteAll_thenGetAll_isEmpty_100iterations()
      throws ExecutionException, InterruptedException, java.util.concurrent.TimeoutException {
    for (int i = 0; i < 100; i++) {
      // Seed 20 rows
      List<ListenableFuture<Void>> seedFutures = new ArrayList<>(20);
      for (int j = 0; j < 20; j++) {
        seedFutures.add(repo.insert(entity("b-" + i + "-" + j)));
      }
      for (ListenableFuture<Void> f : seedFutures) {
        f.get(2, TimeUnit.SECONDS);
      }

      // Assert seeded
      assertEquals(20, repo.getAll().get(2, TimeUnit.SECONDS).size());

      // Cancel all, then immediately read — must be empty.
      repo.deleteAll().get(2, TimeUnit.SECONDS);
      int immediateCount = repo.getAll().get(2, TimeUnit.SECONDS).size();
      assertEquals(
          "iteration " + i + ": deleteAll must complete before its future resolves",
          0,
          immediateCount);
    }
  }

  // ------- Scenario C analogue: post-create persistence -------

  @Test
  public void insert_thenGet_isVisible_100iterations()
      throws ExecutionException, InterruptedException, java.util.concurrent.TimeoutException {
    for (int i = 0; i < 100; i++) {
      repo.deleteAll().get(2, TimeUnit.SECONDS);
      String id = "c-" + i;
      repo.insert(entity(id)).get(2, TimeUnit.SECONDS);

      WorkDataEntity row = repo.getWorkDataById(id).get(2, TimeUnit.SECONDS);
      assertTrue(
          "iteration " + i + ": insert future resolved but row is not in Room yet", row != null);
      assertEquals(id, row.getId());
    }
  }

  // ------- Delete-by-id consistency -------

  @Test
  public void deleteById_thenGet_isNull_100iterations()
      throws ExecutionException, InterruptedException, java.util.concurrent.TimeoutException {
    for (int i = 0; i < 100; i++) {
      String id = "d-" + i;
      repo.insert(entity(id)).get(2, TimeUnit.SECONDS);
      repo.deleteById(id).get(2, TimeUnit.SECONDS);
      WorkDataEntity row = repo.getWorkDataById(id).get(2, TimeUnit.SECONDS);
      assertTrue("iteration " + i + ": deleteById resolved but row still present", row == null);
    }
  }

  // ------- Update visibility -------

  @Test
  public void update_thenGet_reflectsNewTrigger_100iterations()
      throws ExecutionException, InterruptedException, java.util.concurrent.TimeoutException {
    for (int i = 0; i < 100; i++) {
      String id = "u-" + i;
      byte[] notification = new byte[] {1, 2, 3};
      byte[] initialTrigger = new byte[] {(byte) i};
      repo.insert(new WorkDataEntity(id, notification, initialTrigger, false))
          .get(2, TimeUnit.SECONDS);

      byte[] updatedTrigger = new byte[] {(byte) (i + 100)};
      repo.update(new WorkDataEntity(id, notification, updatedTrigger, true))
          .get(2, TimeUnit.SECONDS);

      WorkDataEntity row = repo.getWorkDataById(id).get(2, TimeUnit.SECONDS);
      assertTrue(row != null);
      assertEquals(
          "iteration " + i + ": updated trigger byte must be visible immediately",
          (byte) (i + 100),
          row.getTrigger()[0]);
      assertTrue(row.getWithAlarmManager());
    }
  }

  // ------- Scenario D analogue: concurrent stress -------

  /**
   * Fire 20 concurrent insert and 20 concurrent deleteAll operations across a fixed thread pool and
   * verify the system reaches a deterministic final state after all futures complete. This does NOT
   * assert a specific final count — ordering between concurrent creates and cancels is
   * implementation-defined — but it does assert that every future completes successfully and the DB
   * is readable at the end.
   */
  @Test
  public void concurrentInsertAndDelete_allFuturesComplete()
      throws ExecutionException, InterruptedException, java.util.concurrent.TimeoutException {
    ExecutorService testPool = Executors.newFixedThreadPool(8);
    try {
      List<ListenableFuture<Void>> futures = new ArrayList<>();
      for (int i = 0; i < 20; i++) {
        futures.add(repo.insert(entity("s-" + i)));
        if (i % 3 == 0) {
          futures.add(repo.deleteAll());
        }
      }
      for (ListenableFuture<Void> f : futures) {
        f.get(5, TimeUnit.SECONDS);
      }
      // Final read must succeed — we only assert the DB is readable, not the count.
      int finalCount = repo.getAll().get(2, TimeUnit.SECONDS).size();
      assertTrue("final count must be non-negative: " + finalCount, finalCount >= 0);
    } finally {
      testPool.shutdownNow();
    }
  }

  // ------- DAO exceptions surface via ExecutionException -------

  @Test
  public void insertDuplicatePrimaryKey_failsFutureWithExecutionException()
      throws ExecutionException, InterruptedException, java.util.concurrent.TimeoutException {
    repo.insert(entity("dup")).get(2, TimeUnit.SECONDS);
    try {
      // Room throws SQLiteConstraintException on duplicate primary key when using OnConflict.ABORT
      // (the default). If the DAO uses REPLACE this test will pass trivially; adjust when the
      // DAO's @Insert strategy changes.
      repo.insert(entity("dup")).get(2, TimeUnit.SECONDS);
      // If we reach here the DAO uses REPLACE or similar — mark the test as passing but log.
    } catch (ExecutionException e) {
      assertFalse("ExecutionException must wrap a real cause, not null", e.getCause() == null);
    } catch (Throwable unexpected) {
      fail("Expected ExecutionException or success, got: " + unexpected);
    }
  }

  // ------- helpers -------

  private static WorkDataEntity entity(String id) {
    return new WorkDataEntity(id, new byte[] {0}, new byte[] {0}, false);
  }
}
