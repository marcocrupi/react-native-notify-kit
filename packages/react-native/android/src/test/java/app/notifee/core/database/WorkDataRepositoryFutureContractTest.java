package app.notifee.core.database;

/*
 * Copyright (c) 2016-present Invertase Limited & Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this library except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 */

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.ListeningExecutorService;
import com.google.common.util.concurrent.MoreExecutors;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * Locks in the post-#549 contract that every {@link WorkDataRepository} mutation method returns a
 * non-null {@link ListenableFuture} that only transitions to done after the underlying DAO call
 * has actually returned — and that DAO exceptions propagate through {@code ExecutionException}.
 *
 * <p>Before the #549 fix, these methods were {@code void} and enqueued their work fire-and-forget
 * on a cached thread pool. Any future refactor that drops the future return type or silently
 * swallows DAO exceptions would be a regression and must fail these tests.
 */
public class WorkDataRepositoryFutureContractTest {

  private WorkDataDao mockDao;
  private ListeningExecutorService executor;
  private WorkDataRepository repo;

  @Before
  public void setUp() {
    mockDao = mock(WorkDataDao.class);
    // Single-threaded so we can deterministically gate the DAO call with a latch
    // and assert future.isDone() before the DAO has returned.
    executor = MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor());
    repo = new WorkDataRepository(mockDao, executor);
  }

  @After
  public void tearDown() {
    executor.shutdownNow();
  }

  // -------- insert --------

  @Test
  public void insert_returnsNonNullFuture() {
    assertNotNull(repo.insert(newEntity("a")));
  }

  @Test
  public void insert_futureNotDoneUntilDaoReturns() throws Exception {
    CountDownLatch daoGate = new CountDownLatch(1);
    WorkDataEntity entity = newEntity("a");
    doAnswer(
            inv -> {
              daoGate.await();
              return null;
            })
        .when(mockDao)
        .insert(entity);

    ListenableFuture<Void> f = repo.insert(entity);
    // Give the executor a moment to pick up the submitted task.
    Thread.sleep(50);
    assertFalse("insert future must not be done before DAO returns", f.isDone());

    daoGate.countDown();
    f.get(1, TimeUnit.SECONDS);
    assertTrue(f.isDone());
    verify(mockDao).insert(entity);
  }

  @Test
  public void insert_propagatesDaoException() throws Exception {
    RuntimeException boom = new RuntimeException("disk full");
    WorkDataEntity entity = newEntity("a");
    doThrow(boom).when(mockDao).insert(entity);

    ListenableFuture<Void> f = repo.insert(entity);
    try {
      f.get(1, TimeUnit.SECONDS);
      fail("Expected ExecutionException wrapping the DAO failure");
    } catch (ExecutionException e) {
      assertSame(boom, e.getCause());
    }
  }

  // -------- deleteById --------

  @Test
  public void deleteById_returnsNonNullFuture() {
    assertNotNull(repo.deleteById("a"));
  }

  @Test
  public void deleteById_futureNotDoneUntilDaoReturns() throws Exception {
    CountDownLatch daoGate = new CountDownLatch(1);
    doAnswer(
            inv -> {
              daoGate.await();
              return null;
            })
        .when(mockDao)
        .deleteById("a");

    ListenableFuture<Void> f = repo.deleteById("a");
    Thread.sleep(50);
    assertFalse(f.isDone());

    daoGate.countDown();
    f.get(1, TimeUnit.SECONDS);
    verify(mockDao).deleteById("a");
  }

  @Test
  public void deleteById_propagatesDaoException() throws Exception {
    RuntimeException boom = new RuntimeException("row missing");
    doThrow(boom).when(mockDao).deleteById("a");

    ListenableFuture<Void> f = repo.deleteById("a");
    try {
      f.get(1, TimeUnit.SECONDS);
      fail("Expected ExecutionException wrapping the DAO failure");
    } catch (ExecutionException e) {
      assertSame(boom, e.getCause());
    }
  }

  // -------- deleteByIds --------

  @Test
  public void deleteByIds_futureNotDoneUntilDaoReturns() throws Exception {
    CountDownLatch daoGate = new CountDownLatch(1);
    doAnswer(
            inv -> {
              daoGate.await();
              return null;
            })
        .when(mockDao)
        .deleteByIds(Collections.singletonList("a"));

    ListenableFuture<Void> f = repo.deleteByIds(Collections.singletonList("a"));
    Thread.sleep(50);
    assertFalse(f.isDone());

    daoGate.countDown();
    f.get(1, TimeUnit.SECONDS);
    verify(mockDao).deleteByIds(Collections.singletonList("a"));
  }

  @Test
  public void deleteByIds_propagatesDaoException() throws Exception {
    RuntimeException boom = new RuntimeException("constraint violation");
    doThrow(boom).when(mockDao).deleteByIds(Collections.singletonList("a"));

    ListenableFuture<Void> f = repo.deleteByIds(Collections.singletonList("a"));
    try {
      f.get(1, TimeUnit.SECONDS);
      fail("Expected ExecutionException");
    } catch (ExecutionException e) {
      assertSame(boom, e.getCause());
    }
  }

  // -------- deleteAll --------

  @Test
  public void deleteAll_returnsNonNullFuture() {
    assertNotNull(repo.deleteAll());
  }

  @Test
  public void deleteAll_futureNotDoneUntilDaoReturns() throws Exception {
    CountDownLatch daoGate = new CountDownLatch(1);
    doAnswer(
            inv -> {
              daoGate.await();
              return null;
            })
        .when(mockDao)
        .deleteAll();

    ListenableFuture<Void> f = repo.deleteAll();
    Thread.sleep(50);
    assertFalse(f.isDone());

    daoGate.countDown();
    f.get(1, TimeUnit.SECONDS);
    verify(mockDao).deleteAll();
  }

  @Test
  public void deleteAll_propagatesDaoException() throws Exception {
    RuntimeException boom = new RuntimeException("db locked");
    doThrow(boom).when(mockDao).deleteAll();

    ListenableFuture<Void> f = repo.deleteAll();
    try {
      f.get(1, TimeUnit.SECONDS);
      fail("Expected ExecutionException");
    } catch (ExecutionException e) {
      assertSame(boom, e.getCause());
    }
  }

  // -------- update --------

  @Test
  public void update_futureNotDoneUntilDaoReturns() throws Exception {
    CountDownLatch daoGate = new CountDownLatch(1);
    WorkDataEntity entity = newEntity("a");
    doAnswer(
            inv -> {
              daoGate.await();
              return null;
            })
        .when(mockDao)
        .update(entity);

    ListenableFuture<Void> f = repo.update(entity);
    Thread.sleep(50);
    assertFalse(f.isDone());

    daoGate.countDown();
    f.get(1, TimeUnit.SECONDS);
    verify(mockDao).update(entity);
  }

  @Test
  public void update_propagatesDaoException() throws Exception {
    RuntimeException boom = new RuntimeException("schema mismatch");
    WorkDataEntity entity = newEntity("a");
    doThrow(boom).when(mockDao).update(entity);

    ListenableFuture<Void> f = repo.update(entity);
    try {
      f.get(1, TimeUnit.SECONDS);
      fail("Expected ExecutionException");
    } catch (ExecutionException e) {
      assertSame(boom, e.getCause());
    }
  }

  // -------- helpers --------

  private static WorkDataEntity newEntity(String id) {
    return new WorkDataEntity(id, new byte[0], new byte[0], false);
  }
}
