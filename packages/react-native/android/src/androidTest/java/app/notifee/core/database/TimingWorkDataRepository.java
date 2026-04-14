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
 * Test-only WorkDataRepository subclass that captures the wall-clock nanoTime
 * at which deleteById(id)'s underlying DAO call completes. Lives in the
 * database package so it can call the @VisibleForTesting package-private
 * WorkDataRepository(WorkDataDao, ListeningExecutorService) constructor.
 * Consumers (e.g. DoScheduledWorkOrderingTest) instantiate via the public
 * constructor below and inject this instance into the production singleton
 * via reflection.
 */

import android.content.Context;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.ListeningExecutorService;
import com.google.common.util.concurrent.MoreExecutors;
import java.util.concurrent.atomic.AtomicLong;

public class TimingWorkDataRepository extends WorkDataRepository {

  /** nanoTime when the FIRST deleteById future completed. 0 if never called. */
  public final AtomicLong firstDeleteCompletionNanos = new AtomicLong();

  public TimingWorkDataRepository(WorkDataDao dao, ListeningExecutorService executor) {
    super(dao, executor);
  }

  /**
   * Factory that wraps the production {@link NotifeeCoreDatabase} DAO and executor, so that reads
   * and writes share the same underlying Room tables as the production singleton.
   */
  public static TimingWorkDataRepository createForProductionDb(Context context) {
    return new TimingWorkDataRepository(
        NotifeeCoreDatabase.getDatabase(context).workDao(),
        NotifeeCoreDatabase.databaseWriteListeningExecutor);
  }

  @Override
  public ListenableFuture<Void> deleteById(String id) {
    ListenableFuture<Void> f = super.deleteById(id);
    f.addListener(
        () -> firstDeleteCompletionNanos.compareAndSet(0, System.nanoTime()),
        MoreExecutors.directExecutor());
    return f;
  }
}
