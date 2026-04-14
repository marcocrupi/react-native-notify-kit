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
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import android.content.Context;
import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.annotation.VisibleForTesting;
import app.notifee.core.model.NotificationModel;
import app.notifee.core.utility.ObjectUtils;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.ListeningExecutorService;
import java.util.List;

public class WorkDataRepository {
  private final WorkDataDao mWorkDataDao;
  private final ListeningExecutorService mExecutor;
  private static WorkDataRepository mInstance;

  public static @NonNull WorkDataRepository getInstance(@NonNull Context context) {
    synchronized (WorkDataRepository.class) {
      if (mInstance == null) {
        mInstance = new WorkDataRepository(context);
      }

      return mInstance;
    }
  }

  public WorkDataRepository(Context context) {
    NotifeeCoreDatabase db = NotifeeCoreDatabase.getDatabase(context);
    mWorkDataDao = db.workDao();
    mExecutor = NotifeeCoreDatabase.databaseWriteListeningExecutor;
  }

  @VisibleForTesting
  WorkDataRepository(@NonNull WorkDataDao dao, @NonNull ListeningExecutorService executor) {
    mWorkDataDao = dao;
    mExecutor = executor;
  }

  // Submit a DAO write to the listening executor and return a future that
  // completes when the DAO call returns (success or exception). Using the
  // submit(Runnable, result) overload avoids the Callable<Object> inference
  // that would otherwise require a cast at every call site.
  private @NonNull ListenableFuture<Void> submitWrite(@NonNull Runnable work) {
    return mExecutor.submit(work, (Void) null);
  }

  public @NonNull ListenableFuture<Void> insert(WorkDataEntity workData) {
    return submitWrite(() -> mWorkDataDao.insert(workData));
  }

  public ListenableFuture<WorkDataEntity> getWorkDataById(String id) {
    return mExecutor.submit(() -> mWorkDataDao.getWorkDataById(id));
  }

  public ListenableFuture<List<WorkDataEntity>> getAllWithAlarmManager(Boolean withAlarmManager) {
    return mExecutor.submit(() -> mWorkDataDao.getAllWithAlarmManager(withAlarmManager));
  }

  public ListenableFuture<List<WorkDataEntity>> getAll() {
    return mExecutor.submit(() -> mWorkDataDao.getAll());
  }

  public @NonNull ListenableFuture<Void> deleteById(String id) {
    return submitWrite(() -> mWorkDataDao.deleteById(id));
  }

  public @NonNull ListenableFuture<Void> deleteByIds(List<String> ids) {
    return submitWrite(() -> mWorkDataDao.deleteByIds(ids));
  }

  public @NonNull ListenableFuture<Void> deleteAll() {
    return submitWrite(() -> mWorkDataDao.deleteAll());
  }

  public static @NonNull ListenableFuture<Void> insertTriggerNotification(
      @NonNull Context context,
      NotificationModel notificationModel,
      Bundle triggerBundle,
      Boolean withAlarmManager) {
    WorkDataEntity workData =
        new WorkDataEntity(
            notificationModel.getId(),
            ObjectUtils.bundleToBytes(notificationModel.toBundle()),
            ObjectUtils.bundleToBytes(triggerBundle),
            withAlarmManager);

    return getInstance(context).insert(workData);
  }

  public @NonNull ListenableFuture<Void> update(WorkDataEntity workData) {
    return submitWrite(() -> mWorkDataDao.update(workData));
  }
}
