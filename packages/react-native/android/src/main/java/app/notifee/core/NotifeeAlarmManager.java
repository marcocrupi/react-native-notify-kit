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
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import static app.notifee.core.ContextHolder.getApplicationContext;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.AlarmManagerCompat;
import app.notifee.core.database.WorkDataEntity;
import app.notifee.core.database.WorkDataRepository;
import app.notifee.core.model.NotificationModel;
import app.notifee.core.model.TimestampTriggerModel;
import app.notifee.core.utility.AlarmUtils;
import app.notifee.core.utility.ExtendedListenableFuture;
import app.notifee.core.utility.ObjectUtils;
import com.google.common.util.concurrent.FutureCallback;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.ListeningExecutorService;
import com.google.common.util.concurrent.MoreExecutors;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

class NotifeeAlarmManager {
  private static final String TAG = "NotifeeAlarmManager";
  private static final String NOTIFICATION_ID_INTENT_KEY = "notificationId";
  private static final ExecutorService alarmManagerExecutor = Executors.newCachedThreadPool();
  private static final ListeningExecutorService alarmManagerListeningExecutor =
      MoreExecutors.listeningDecorator(alarmManagerExecutor);

  // Scheduler used only as the timeout clock for Futures.withTimeout on Room
  // writes happening inside BroadcastReceiver.goAsync() scopes. Broadcasts have
  // ~10s before Android kills the process, so we cap the Room wait at 8s and
  // call pendingResult.finish() anyway on timeout to avoid ANRs.
  private static final ScheduledExecutorService TIMEOUT_SCHEDULER =
      Executors.newSingleThreadScheduledExecutor();
  private static final long RECEIVER_WRITE_TIMEOUT_SECONDS = 8;

  /**
   * Wraps {@code future} in a {@link Futures#withTimeout} safety net and arranges for {@code
   * pendingResult.finish()} to be called exactly once — on success, on failure, or on timeout. Use
   * from a {@link BroadcastReceiver#goAsync} scope where the receiver must tell Android "I'm done"
   * within ~10s or the process is killed. Timeouts are logged at {@code WARN} with the supplied
   * {@code logContext}; real failures at {@code ERROR}.
   */
  private static void finishReceiverWhenDone(
      @NonNull ListenableFuture<?> future,
      @Nullable BroadcastReceiver.PendingResult pendingResult,
      @NonNull String logContext) {
    ListenableFuture<?> bounded =
        Futures.withTimeout(
            future, RECEIVER_WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS, TIMEOUT_SCHEDULER);
    Futures.addCallback(
        bounded,
        new FutureCallback<Object>() {
          @Override
          public void onSuccess(Object result) {
            if (pendingResult != null) {
              pendingResult.finish();
            }
          }

          @Override
          public void onFailure(@NonNull Throwable t) {
            if (t instanceof TimeoutException) {
              Logger.w(
                  TAG,
                  "Room write for "
                      + logContext
                      + " did not complete within "
                      + RECEIVER_WRITE_TIMEOUT_SECONDS
                      + "s; finishing BroadcastReceiver anyway to avoid ANR");
            } else {
              Logger.e(TAG, "Failure in " + logContext, new Exception(t));
            }
            if (pendingResult != null) {
              pendingResult.finish();
            }
          }
        },
        alarmManagerListeningExecutor);
  }

  static void displayScheduledNotification(
      Bundle alarmManagerNotification, @Nullable BroadcastReceiver.PendingResult pendingResult) {
    if (alarmManagerNotification == null) {
      if (pendingResult != null) {
        pendingResult.finish();
      }
      return;
    }
    String id = alarmManagerNotification.getString(NOTIFICATION_ID_INTENT_KEY);

    if (id == null) {
      if (pendingResult != null) {
        pendingResult.finish();
      }
      return;
    }

    WorkDataRepository workDataRepository = new WorkDataRepository(getApplicationContext());

    // Chain: read → display → persist (update for repeat / delete for one-shot).
    // The final Room write is awaited before pendingResult.finish() so the
    // BroadcastReceiver only tells Android "I'm done" once the next-fire anchor
    // (or the deletion) has actually landed in Room. Without this, process death
    // between finish() and the enqueued write could lose the updated timestamp
    // and cause the same alarm to fire again on the next reboot. See #549 audit
    // callers #6 and #7.
    ListenableFuture<Void> displayAndPersistFuture =
        Futures.transformAsync(
            workDataRepository.getWorkDataById(id),
            workDataEntity -> {
              if (workDataEntity == null
                  || workDataEntity.getNotification() == null
                  || workDataEntity.getTrigger() == null) {
                Logger.w(
                    TAG, "Attempted to handle doScheduledWork but no notification data was found.");
                return Futures.immediateFuture(null);
              }

              Bundle triggerBundle = ObjectUtils.bytesToBundle(workDataEntity.getTrigger());
              Bundle notificationBundle =
                  ObjectUtils.bytesToBundle(workDataEntity.getNotification());
              NotificationModel notificationModel =
                  NotificationModel.fromBundle(notificationBundle);

              return Futures.transformAsync(
                  NotificationManager.displayNotification(notificationModel, triggerBundle),
                  voidDisplayedNotification -> {
                    if (triggerBundle.containsKey("repeatFrequency")
                        && ObjectUtils.getInt(triggerBundle.get("repeatFrequency")) != -1) {
                      TimestampTriggerModel trigger =
                          TimestampTriggerModel.fromBundle(triggerBundle);
                      // scheduleTimestampTriggerNotification() calls setNextTimestamp()
                      // internally, so we must NOT call it here to avoid double-advancing
                      scheduleTimestampTriggerNotification(notificationModel, trigger);
                      return WorkDataRepository.getInstance(getApplicationContext())
                          .update(
                              new WorkDataEntity(
                                  id,
                                  workDataEntity.getNotification(),
                                  ObjectUtils.bundleToBytes(trigger.toBundle()),
                                  true));
                    }
                    // not repeating, delete database entry if work is a one-time request
                    return WorkDataRepository.getInstance(getApplicationContext()).deleteById(id);
                  },
                  alarmManagerExecutor);
            },
            alarmManagerExecutor);

    // Awaits the Room write before pendingResult.finish(), bounded by the 8s
    // ANR safety timeout. Handles success, failure, and timeout uniformly.
    finishReceiverWhenDone(
        displayAndPersistFuture, pendingResult, "displayScheduledNotification[" + id + "]");
  }

  public static PendingIntent getAlarmManagerIntentForNotification(String notificationId) {
    try {
      Context context = getApplicationContext();
      Intent notificationIntent = new Intent(context, NotificationAlarmReceiver.class);
      notificationIntent.putExtra(NOTIFICATION_ID_INTENT_KEY, notificationId);
      return PendingIntent.getBroadcast(
          context,
          notificationId.hashCode(),
          notificationIntent,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);

    } catch (Exception e) {
      Logger.e(TAG, "Unable to create AlarmManager intent", e);
    }

    return null;
  }

  static void scheduleTimestampTriggerNotification(
      NotificationModel notificationModel, TimestampTriggerModel timestampTrigger) {

    PendingIntent pendingIntent = getAlarmManagerIntentForNotification(notificationModel.getId());

    if (pendingIntent == null) {
      Logger.w(
          TAG, "Failed to create PendingIntent for notification: " + notificationModel.getId());
      return;
    }

    AlarmManager alarmManager = AlarmUtils.getAlarmManager();

    TimestampTriggerModel.AlarmType alarmType = timestampTrigger.getAlarmType();

    // Verify we can call setExact APIs to avoid a crash, but it requires an Android S+ symbol
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {

      // Check whether the alarmType is the exact alarm
      boolean isExactAlarm =
          Arrays.asList(
                  TimestampTriggerModel.AlarmType.SET_EXACT,
                  TimestampTriggerModel.AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE,
                  TimestampTriggerModel.AlarmType.SET_ALARM_CLOCK)
              .contains(alarmType);
      if (isExactAlarm && !alarmManager.canScheduleExactAlarms()) {
        Logger.w(
            TAG, "SCHEDULE_EXACT_ALARM permission not granted. Falling back to inexact alarm.");
        timestampTrigger.setNextTimestamp();
        AlarmManagerCompat.setAndAllowWhileIdle(
            alarmManager, AlarmManager.RTC_WAKEUP, timestampTrigger.getTimestamp(), pendingIntent);
        return;
      }
    }

    // Ensure timestamp is always in the future when scheduling the alarm
    timestampTrigger.setNextTimestamp();

    try {
      switch (alarmType) {
        case SET:
          alarmManager.set(AlarmManager.RTC_WAKEUP, timestampTrigger.getTimestamp(), pendingIntent);
          break;
        case SET_AND_ALLOW_WHILE_IDLE:
          AlarmManagerCompat.setAndAllowWhileIdle(
              alarmManager,
              AlarmManager.RTC_WAKEUP,
              timestampTrigger.getTimestamp(),
              pendingIntent);
          break;
        case SET_EXACT:
          AlarmManagerCompat.setExact(
              alarmManager,
              AlarmManager.RTC_WAKEUP,
              timestampTrigger.getTimestamp(),
              pendingIntent);
          break;
        case SET_EXACT_AND_ALLOW_WHILE_IDLE:
          AlarmManagerCompat.setExactAndAllowWhileIdle(
              alarmManager,
              AlarmManager.RTC_WAKEUP,
              timestampTrigger.getTimestamp(),
              pendingIntent);
          break;
        case SET_ALARM_CLOCK:
          int mutabilityFlag = PendingIntent.FLAG_UPDATE_CURRENT;
          if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            mutabilityFlag = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
          }

          Context context = getApplicationContext();
          Intent launchActivityIntent =
              context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());

          PendingIntent pendingLaunchIntent =
              PendingIntent.getActivity(
                  context,
                  notificationModel.getId().hashCode(),
                  launchActivityIntent,
                  mutabilityFlag);
          AlarmManagerCompat.setAlarmClock(
              alarmManager, timestampTrigger.getTimestamp(), pendingLaunchIntent, pendingIntent);
          break;
      }
    } catch (SecurityException e) {
      Logger.w(
          TAG,
          "SecurityException scheduling exact alarm, falling back to inexact: " + e.getMessage());
      try {
        AlarmManagerCompat.setAndAllowWhileIdle(
            alarmManager, AlarmManager.RTC_WAKEUP, timestampTrigger.getTimestamp(), pendingIntent);
      } catch (SecurityException e2) {
        Logger.e(TAG, "Failed to schedule even inexact alarm", e2);
      }
    }
  }

  ListenableFuture<List<WorkDataEntity>> getScheduledNotifications() {
    WorkDataRepository workDataRepository = new WorkDataRepository(getApplicationContext());
    return workDataRepository.getAllWithAlarmManager(true);
  }

  public static void cancelNotification(String notificationId) {
    PendingIntent pendingIntent = getAlarmManagerIntentForNotification(notificationId);
    AlarmManager alarmManager = AlarmUtils.getAlarmManager();
    if (pendingIntent != null) {
      alarmManager.cancel(pendingIntent);
    }
  }

  public static ListenableFuture<Void> cancelAllNotifications() {
    WorkDataRepository workDataRepository = WorkDataRepository.getInstance(getApplicationContext());

    return new ExtendedListenableFuture<>(workDataRepository.getAllWithAlarmManager(true))
        .continueWith(
            workDataEntities -> {
              if (workDataEntities != null) {
                for (WorkDataEntity workDataEntity : workDataEntities) {
                  NotifeeAlarmManager.cancelNotification(workDataEntity.getId());
                }
              }
              return Futures.immediateFuture(null);
            },
            alarmManagerListeningExecutor);
  }

  /**
   * On reboot, reschedule one trigger notification created via alarm manager.
   *
   * <p>Returns a future that completes when Room has persisted the updated next-fire anchor. The
   * caller MUST await this future before calling {@code pendingResult.finish()} — otherwise Android
   * may kill the boot receiver's process before Room has drained, and the next reboot will
   * reschedule from the stale anchor. This bug is NOT in upstream invertase/notifee#549 and was
   * surfaced only by the pre-fix-549-audit.md read-only caller audit (Caller #8).
   */
  ListenableFuture<Void> rescheduleNotification(WorkDataEntity workDataEntity) {
    if (workDataEntity.getNotification() == null || workDataEntity.getTrigger() == null) {
      return Futures.immediateFuture(null);
    }

    byte[] notificationBytes = workDataEntity.getNotification();
    byte[] triggerBytes = workDataEntity.getTrigger();
    Bundle triggerBundle = ObjectUtils.bytesToBundle(triggerBytes);

    NotificationModel notificationModel =
        NotificationModel.fromBundle(ObjectUtils.bytesToBundle(notificationBytes));

    int triggerType = ObjectUtils.getInt(triggerBundle.get("type"));

    switch (triggerType) {
      case 0:
        TimestampTriggerModel trigger = TimestampTriggerModel.fromBundle(triggerBundle);
        if (!trigger.getWithAlarmManager()) {
          return Futures.immediateFuture(null);
        }

        scheduleTimestampTriggerNotification(notificationModel, trigger);
        // Persist updated timestamp so next reboot starts from the correct anchor.
        return WorkDataRepository.getInstance(getApplicationContext())
            .update(
                new WorkDataEntity(
                    workDataEntity.getId(),
                    workDataEntity.getNotification(),
                    ObjectUtils.bundleToBytes(trigger.toBundle()),
                    workDataEntity.getWithAlarmManager()));
      case 1:
        // TODO: support interval triggers with alarm manager
        return Futures.immediateFuture(null);
      default:
        return Futures.immediateFuture(null);
    }
  }

  void rescheduleNotifications(@Nullable BroadcastReceiver.PendingResult pendingResult) {
    Logger.d(TAG, "Reschedule Notifications on reboot");
    Futures.addCallback(
        getScheduledNotifications(),
        new FutureCallback<List<WorkDataEntity>>() {
          @Override
          public void onSuccess(List<WorkDataEntity> workDataEntities) {
            Logger.d(
                TAG,
                "Reschedule starting for "
                    + (workDataEntities != null ? workDataEntities.size() : 0)
                    + " recurring alarms");

            if (workDataEntities == null || workDataEntities.isEmpty()) {
              if (pendingResult != null) {
                pendingResult.finish();
              }
              return;
            }

            List<ListenableFuture<Void>> updateFutures = new ArrayList<>(workDataEntities.size());
            for (WorkDataEntity workDataEntity : workDataEntities) {
              try {
                updateFutures.add(rescheduleNotification(workDataEntity));
              } catch (Throwable t) {
                // A single bad entity must not prevent the rest of the batch
                // from being rescheduled — log and continue.
                Logger.w(
                    TAG,
                    "Failed to reschedule entity "
                        + workDataEntity.getId()
                        + ": "
                        + t.getMessage());
              }
            }

            // Awaits all per-entity update futures before finishing the boot
            // receiver, bounded by the 8s ANR safety timeout. Any not-yet-
            // persisted next-fire anchors left behind on timeout will catch up
            // on the next alarm fire.
            ListenableFuture<List<Void>> combined = Futures.allAsList(updateFutures);
            finishReceiverWhenDone(combined, pendingResult, "rescheduleNotifications");
          }

          @Override
          public void onFailure(@NonNull Throwable t) {
            Logger.e(TAG, "Failed to reschedule notifications", new Exception(t));
            if (pendingResult != null) {
              pendingResult.finish();
            }
          }
        },
        alarmManagerListeningExecutor);
  }
}
