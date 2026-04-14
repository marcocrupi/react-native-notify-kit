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
import static app.notifee.core.ReceiverService.ACTION_PRESS_INTENT;
import static app.notifee.core.event.NotificationEvent.TYPE_ACTION_PRESS;
import static app.notifee.core.event.NotificationEvent.TYPE_PRESS;
import static java.lang.Integer.parseInt;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Trace;
import android.service.notification.StatusBarNotification;
import androidx.annotation.NonNull;
import androidx.concurrent.futures.CallbackToFutureAdapter;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import androidx.core.graphics.drawable.IconCompat;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.ListenableWorker;
import androidx.work.ListenableWorker.Result;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import app.notifee.core.database.WorkDataEntity;
import app.notifee.core.database.WorkDataRepository;
import app.notifee.core.event.MainComponentEvent;
import app.notifee.core.event.NotificationEvent;
import app.notifee.core.interfaces.MethodCallResult;
import app.notifee.core.model.IntervalTriggerModel;
import app.notifee.core.model.NotificationAndroidActionModel;
import app.notifee.core.model.NotificationAndroidModel;
import app.notifee.core.model.NotificationAndroidPressActionModel;
import app.notifee.core.model.NotificationAndroidStyleModel;
import app.notifee.core.model.NotificationModel;
import app.notifee.core.model.TimestampTriggerModel;
import app.notifee.core.utility.ExtendedListenableFuture;
import app.notifee.core.utility.IntentUtils;
import app.notifee.core.utility.ObjectUtils;
import app.notifee.core.utility.PowerManagerUtils;
import app.notifee.core.utility.ResourceUtils;
import app.notifee.core.utility.TextUtils;
import com.google.common.util.concurrent.AsyncFunction;
import com.google.common.util.concurrent.FutureCallback;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.ListeningExecutorService;
import com.google.common.util.concurrent.MoreExecutors;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

class NotificationManager {
  private static final String TAG = "NotificationManager";
  private static final String EXTRA_NOTIFEE_NOTIFICATION = "notifee.notification";
  private static final String EXTRA_NOTIFEE_TRIGGER = "notifee.trigger";
  private static final ExecutorService CACHED_THREAD_POOL = Executors.newCachedThreadPool();
  private static final ListeningExecutorService LISTENING_CACHED_THREAD_POOL =
      MoreExecutors.listeningDecorator(CACHED_THREAD_POOL);
  private static final int NOTIFICATION_TYPE_ALL = 0;
  private static final int NOTIFICATION_TYPE_DISPLAYED = 1;
  private static final int NOTIFICATION_TYPE_TRIGGER = 2;

  // NotificationCompat.Builder methods (setSound, setDefaults, setPriority, setVibrate, setLights)
  // are deprecated since API 26 in favor of NotificationChannel, but are still required for
  // backward compatibility on API 24-25 via NotificationCompat.
  @SuppressWarnings("deprecation")
  private static ListenableFuture<NotificationCompat.Builder> notificationBundleToBuilder(
      NotificationModel notificationModel) {
    final NotificationAndroidModel androidModel = notificationModel.getAndroid();

    /*
     * Construct the initial NotificationCompat.Builder instance
     */
    Callable<NotificationCompat.Builder> builderCallable =
        () -> {
          Trace.beginSection("notifee:buildNotification");
          try {
            Boolean hasCustomSound = false;
            NotificationCompat.Builder builder =
                new NotificationCompat.Builder(
                    getApplicationContext(), androidModel.getChannelId());

            // must always keep at top
            builder.setExtras(notificationModel.getData());

            builder.setDeleteIntent(
                ReceiverService.createIntent(
                    ReceiverService.DELETE_INTENT,
                    new String[] {"notification"},
                    notificationModel.toBundle()));
            // Resolve the effective pressAction bundle for the content intent.
            // Three cases:
            //   1. pressAction is null (absent from bundle, e.g. trigger rehydrated from Room DB
            //      after app kill): synthesize default { id:'default', launchActivity:'default' }
            //      so tapping the notification opens the app (defense-in-depth for paths that
            //      bypass the TS validator).
            //   2. pressAction has the opt-out sentinel id: user explicitly passed
            //      pressAction: null in JS — pass null to createIntent so no launch intent
            //      is created (non-tappable notification).
            //   3. pressAction is a normal bundle: pass through unchanged.
            // Resolve the effective pressAction bundle for the content intent.
            // Three cases:
            //   1. pressAction is null (absent from bundle, e.g. trigger rehydrated from Room DB
            //      after app kill): synthesize default { id:'default', launchActivity:'default' }
            //      so tapping the notification opens the app (defense-in-depth for paths that
            //      bypass the TS validator).
            //   2. pressAction has the opt-out sentinel id: user explicitly passed
            //      pressAction: null in JS — pass null to createIntent so no launch intent
            //      is created (non-tappable notification).
            //   3. pressAction is a normal bundle: pass through unchanged.
            //
            // pressActionForIntent  → used for creating the launch intent (or null for opt-out)
            // pressActionForExtras  → used in the receiver intent extras (event payload);
            //                         null for cases 1 & 2 to avoid leaking synthesized defaults
            //                         or the sentinel id into the JS event.
            Bundle pressActionForIntent = androidModel.getPressAction();
            Bundle pressActionForExtras = pressActionForIntent;
            if (pressActionForIntent == null) {
              // Case 1: absent — synthesize default for launch, null for extras
              pressActionForIntent = new Bundle();
              pressActionForIntent.putString("id", "default");
              pressActionForIntent.putString("launchActivity", "default");
              // pressActionForExtras stays null: the original notification didn't have
              // pressAction, so the event shouldn't either.
            } else if (NotificationPendingIntent.PRESS_ACTION_OPT_OUT_ID.equals(
                pressActionForIntent.getString("id"))) {
              // Case 2: explicit opt-out sentinel — no launch intent, no sentinel in extras
              pressActionForIntent = null;
              pressActionForExtras = null;
            }
            // Case 3: normal pressAction — both variables point to the original bundle

            int targetSdkVersion =
                ContextHolder.getApplicationContext().getApplicationInfo().targetSdkVersion;
            if (targetSdkVersion >= Build.VERSION_CODES.S
                && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
              builder.setContentIntent(
                  NotificationPendingIntent.createIntent(
                      notificationModel.getHashCode(),
                      pressActionForIntent,
                      TYPE_PRESS,
                      new String[] {"notification", "pressAction"},
                      notificationModel.toBundle(),
                      pressActionForExtras));
            } else {
              builder.setContentIntent(
                  ReceiverService.createIntent(
                      ReceiverService.PRESS_INTENT,
                      new String[] {"notification", "pressAction"},
                      notificationModel.toBundle(),
                      pressActionForIntent));
            }

            if (notificationModel.getTitle() != null) {
              builder.setContentTitle(TextUtils.fromHtml(notificationModel.getTitle()));
            }

            if (notificationModel.getSubTitle() != null) {
              builder.setSubText(TextUtils.fromHtml(notificationModel.getSubTitle()));
            }

            if (notificationModel.getBody() != null) {
              builder.setContentText(TextUtils.fromHtml(notificationModel.getBody()));
            }

            if (androidModel.getBadgeIconType() != null) {
              builder.setBadgeIconType(androidModel.getBadgeIconType());
            }

            if (androidModel.getCategory() != null) {
              builder.setCategory(androidModel.getCategory());
            }

            if (androidModel.getColor() != null) {
              builder.setColor(androidModel.getColor());
            }

            builder.setColorized(androidModel.getColorized());

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
              builder.setChronometerCountDown(androidModel.getChronometerCountDown());
            }

            if (androidModel.getGroup() != null) {
              builder.setGroup(androidModel.getGroup());
            }

            builder.setGroupAlertBehavior(androidModel.getGroupAlertBehaviour());
            builder.setGroupSummary(androidModel.getGroupSummary());

            if (androidModel.getInputHistory() != null) {
              builder.setRemoteInputHistory(androidModel.getInputHistory());
            }

            if (androidModel.getLights() != null) {
              ArrayList<Integer> lights = androidModel.getLights();
              builder.setLights(lights.get(0), lights.get(1), lights.get(2));
            }

            builder.setLocalOnly(androidModel.getLocalOnly());

            if (androidModel.getNumber() != null) {
              builder.setNumber(androidModel.getNumber());
            }

            if (androidModel.getSound() != null) {
              Uri soundUri = ResourceUtils.getSoundUri(androidModel.getSound());
              if (soundUri != null) {
                hasCustomSound = true;
                builder.setSound(soundUri);
              } else {
                Logger.w(
                    TAG,
                    "Unable to retrieve sound for notification, sound was specified as: "
                        + androidModel.getSound());
              }
            }

            builder.setDefaults(androidModel.getDefaults(hasCustomSound));
            builder.setOngoing(androidModel.getOngoing());
            builder.setOnlyAlertOnce(androidModel.getOnlyAlertOnce());
            builder.setPriority(androidModel.getPriority());

            NotificationAndroidModel.AndroidProgress progress = androidModel.getProgress();
            if (progress != null) {
              builder.setProgress(
                  progress.getMax(), progress.getCurrent(), progress.getIndeterminate());
            }

            if (androidModel.getShortcutId() != null) {
              builder.setShortcutId(androidModel.getShortcutId());
            }

            builder.setShowWhen(androidModel.getShowTimestamp());

            Integer smallIconId = androidModel.getSmallIcon();
            if (smallIconId != null) {
              Integer smallIconLevel = androidModel.getSmallIconLevel();
              if (smallIconLevel != null) {
                builder.setSmallIcon(smallIconId, smallIconLevel);
              } else {
                builder.setSmallIcon(smallIconId);
              }
            }

            if (androidModel.getSortKey() != null) {
              builder.setSortKey(androidModel.getSortKey());
            }

            if (androidModel.getTicker() != null) {
              builder.setTicker(androidModel.getTicker());
            }

            if (androidModel.getTimeoutAfter() != null) {
              builder.setTimeoutAfter(androidModel.getTimeoutAfter());
            }

            builder.setUsesChronometer(androidModel.getShowChronometer());

            long[] vibrationPattern = androidModel.getVibrationPattern();
            if (vibrationPattern.length > 0) builder.setVibrate(vibrationPattern);

            builder.setVisibility(androidModel.getVisibility());

            long timestamp = androidModel.getTimestamp();
            if (timestamp > -1) builder.setWhen(timestamp);

            builder.setAutoCancel(androidModel.getAutoCancel());

            return builder;
          } finally {
            Trace.endSection();
          }
        };

    /*
     * A task continuation that fetches the largeIcon through Fresco, if specified.
     */
    AsyncFunction<NotificationCompat.Builder, NotificationCompat.Builder> largeIconContinuation =
        taskResult ->
            LISTENING_CACHED_THREAD_POOL.submit(
                () -> {
                  NotificationCompat.Builder builder = taskResult;

                  if (androidModel.hasLargeIcon()) {
                    String largeIcon = androidModel.getLargeIcon();
                    Bitmap largeIconBitmap = null;

                    try {
                      largeIconBitmap =
                          ResourceUtils.getImageBitmapFromUrl(largeIcon).get(10, TimeUnit.SECONDS);
                    } catch (TimeoutException e) {
                      Logger.e(
                          TAG,
                          "Timeout occurred whilst trying to retrieve a largeIcon image: "
                              + largeIcon,
                          e);
                    } catch (Exception e) {
                      Logger.e(
                          TAG,
                          "An error occurred whilst trying to retrieve a largeIcon image: "
                              + largeIcon,
                          e);
                    }

                    if (largeIconBitmap != null) {
                      if (androidModel.getCircularLargeIcon()) {
                        largeIconBitmap = ResourceUtils.getCircularBitmap(largeIconBitmap);
                      }

                      builder.setLargeIcon(largeIconBitmap);
                    }
                  }

                  return builder;
                });

    /*
     * A task continuation for full-screen action, if specified.
     */
    AsyncFunction<NotificationCompat.Builder, NotificationCompat.Builder>
        fullScreenActionContinuation =
            taskResult ->
                LISTENING_CACHED_THREAD_POOL.submit(
                    () -> {
                      NotificationCompat.Builder builder = taskResult;
                      if (androidModel.hasFullScreenAction()) {
                        NotificationAndroidPressActionModel fullScreenActionBundle =
                            androidModel.getFullScreenAction();

                        String launchActivity = fullScreenActionBundle.getLaunchActivity();
                        Class<?> launchActivityClass =
                            IntentUtils.getLaunchActivity(launchActivity);
                        if (launchActivityClass == null) {
                          Logger.e(
                              TAG,
                              String.format(
                                  "Launch Activity for full-screen action does not exist ('%s').",
                                  launchActivity));
                          return builder;
                        }

                        Intent launchIntent =
                            new Intent(getApplicationContext(), launchActivityClass);
                        if (fullScreenActionBundle.getLaunchActivityFlags() != -1) {
                          launchIntent.addFlags(fullScreenActionBundle.getLaunchActivityFlags());
                        }

                        if (fullScreenActionBundle.getMainComponent() != null) {
                          launchIntent.putExtra(
                              "mainComponent", fullScreenActionBundle.getMainComponent());
                          launchIntent.putExtra("notification", notificationModel.toBundle());
                          EventBus.postSticky(
                              new MainComponentEvent(fullScreenActionBundle.getMainComponent()));
                        }

                        PendingIntent fullScreenPendingIntent =
                            PendingIntent.getActivity(
                                getApplicationContext(),
                                notificationModel.getHashCode(),
                                launchIntent,
                                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
                        builder.setFullScreenIntent(fullScreenPendingIntent, true);
                      }

                      return builder;
                    });

    /*
     * A task continuation that builds all actions, if any. Additionally fetches
     * icon bitmaps through Fresco.
     */
    AsyncFunction<NotificationCompat.Builder, NotificationCompat.Builder> actionsContinuation =
        taskResult ->
            LISTENING_CACHED_THREAD_POOL.submit(
                () -> {
                  NotificationCompat.Builder builder = taskResult;
                  ArrayList<NotificationAndroidActionModel> actionBundles =
                      androidModel.getActions();

                  if (actionBundles == null) {
                    return builder;
                  }

                  for (NotificationAndroidActionModel actionBundle : actionBundles) {
                    PendingIntent pendingIntent = null;
                    int targetSdkVersion =
                        ContextHolder.getApplicationContext().getApplicationInfo().targetSdkVersion;
                    if (targetSdkVersion >= Build.VERSION_CODES.S
                        && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                      pendingIntent =
                          NotificationPendingIntent.createIntent(
                              notificationModel.getHashCode(),
                              actionBundle.getPressAction().toBundle(),
                              TYPE_ACTION_PRESS,
                              new String[] {"notification", "pressAction"},
                              notificationModel.toBundle(),
                              actionBundle.getPressAction().toBundle());
                    } else {
                      pendingIntent =
                          ReceiverService.createIntent(
                              ACTION_PRESS_INTENT,
                              new String[] {"notification", "pressAction"},
                              notificationModel.toBundle(),
                              actionBundle.getPressAction().toBundle());
                    }

                    String icon = actionBundle.getIcon();
                    Bitmap iconBitmap = null;

                    if (icon != null) {
                      try {
                        iconBitmap =
                            ResourceUtils.getImageBitmapFromUrl(actionBundle.getIcon())
                                .get(10, TimeUnit.SECONDS);
                      } catch (TimeoutException e) {
                        Logger.e(
                            TAG,
                            "Timeout occurred whilst trying to retrieve an action icon: " + icon,
                            e);
                      } catch (Exception e) {
                        Logger.e(
                            TAG,
                            "An error occurred whilst trying to retrieve an action icon: " + icon,
                            e);
                      }
                    }

                    IconCompat iconCompat = null;
                    if (iconBitmap != null) {
                      iconCompat = IconCompat.createWithAdaptiveBitmap(iconBitmap);
                    }

                    NotificationCompat.Action.Builder actionBuilder =
                        new NotificationCompat.Action.Builder(
                            iconCompat, TextUtils.fromHtml(actionBundle.getTitle()), pendingIntent);

                    RemoteInput remoteInput = actionBundle.getRemoteInput(actionBuilder);
                    if (remoteInput != null) {
                      actionBuilder.addRemoteInput(remoteInput);
                    }

                    builder.addAction(actionBuilder.build());
                  }

                  return builder;
                });

    /*
     * A task continuation that builds the notification style, if any. Additionally
     * fetches any image bitmaps (e.g. Person image, or BigPicture image) through
     * Fresco.
     */
    AsyncFunction<NotificationCompat.Builder, NotificationCompat.Builder> styleContinuation =
        builder ->
            LISTENING_CACHED_THREAD_POOL.submit(
                () -> {
                  NotificationAndroidStyleModel androidStyleBundle = androidModel.getStyle();
                  if (androidStyleBundle == null) {
                    return builder;
                  }

                  ListenableFuture<NotificationCompat.Style> styleTask =
                      androidStyleBundle.getStyleTask(LISTENING_CACHED_THREAD_POOL);
                  if (styleTask == null) {
                    return builder;
                  }

                  NotificationCompat.Style style = styleTask.get();
                  if (style != null) {
                    builder.setStyle(style);
                  }

                  return builder;
                });

    return new ExtendedListenableFuture<>(LISTENING_CACHED_THREAD_POOL.submit(builderCallable))
        // get a large image bitmap if largeIcon is set
        .continueWith(largeIconContinuation, LISTENING_CACHED_THREAD_POOL)
        // build notification actions, tasks based to allow image fetching
        .continueWith(actionsContinuation, LISTENING_CACHED_THREAD_POOL)
        // build notification style, tasks based to allow image fetching
        .continueWith(styleContinuation, LISTENING_CACHED_THREAD_POOL)
        // set full screen action, if fullScreenAction is set
        .continueWith(fullScreenActionContinuation, LISTENING_CACHED_THREAD_POOL);
  }

  static ListenableFuture<Void> cancelAllNotifications(@NonNull int notificationType) {
    return new ExtendedListenableFuture<>(
            LISTENING_CACHED_THREAD_POOL.submit(
                () -> {
                  NotificationManagerCompat notificationManagerCompat =
                      NotificationManagerCompat.from(getApplicationContext());

                  if (notificationType == NOTIFICATION_TYPE_DISPLAYED
                      || notificationType == NOTIFICATION_TYPE_ALL) {
                    notificationManagerCompat.cancelAll();
                  }

                  if (notificationType == NOTIFICATION_TYPE_TRIGGER
                      || notificationType == NOTIFICATION_TYPE_ALL) {
                    WorkManager workManager = WorkManager.getInstance(getApplicationContext());
                    workManager.cancelAllWorkByTag(Worker.WORK_TYPE_NOTIFICATION_TRIGGER);

                    // Remove all cancelled and finished work from its internal database
                    // states include SUCCEEDED, FAILED and CANCELLED
                    workManager.pruneWork();
                  }
                  return null;
                }))
        .continueWith(
            task -> {
              if (notificationType == NOTIFICATION_TYPE_TRIGGER
                  || notificationType == NOTIFICATION_TYPE_ALL) {
                // Chain the Room delete onto the alarm-manager cancel so the outer
                // future — and therefore the JS Promise — only completes after Room
                // has drained. Fixes upstream invertase/notifee#549.
                return Futures.transformAsync(
                    NotifeeAlarmManager.cancelAllNotifications(),
                    ignored -> WorkDataRepository.getInstance(getApplicationContext()).deleteAll(),
                    LISTENING_CACHED_THREAD_POOL);
              }
              return Futures.immediateFuture(null);
            },
            LISTENING_CACHED_THREAD_POOL);
  }

  static ListenableFuture<Void> cancelAllNotificationsWithIds(
      @NonNull int notificationType, @NonNull List<String> ids, String tag) {
    return new ExtendedListenableFuture<>(
            LISTENING_CACHED_THREAD_POOL.submit(
                () -> {
                  WorkManager workManager = WorkManager.getInstance(getApplicationContext());
                  NotificationManagerCompat notificationManagerCompat =
                      NotificationManagerCompat.from(getApplicationContext());

                  for (String id : ids) {
                    Logger.i(TAG, "Removing notification with id " + id);

                    if (notificationType != NOTIFICATION_TYPE_TRIGGER) {
                      // Cancel notifications displayed by FCM which will always have
                      // an id of 0 and a tag, see https://github.com/invertase/notifee/pull/175
                      if (tag != null && id.equals("0")) {
                        // Attempt to parse id as integer
                        Integer integerId = null;

                        try {
                          integerId = parseInt(id);
                        } catch (Exception e) {
                          Logger.e(
                              TAG,
                              "cancelAllNotificationsWithIds -> Failed to parse id as integer  "
                                  + id,
                              e);
                        }

                        if (integerId != null) {
                          notificationManagerCompat.cancel(tag, integerId);
                        }
                      }

                      // Cancel a notification created with notifee
                      notificationManagerCompat.cancel(tag, id.hashCode());
                    }

                    if (notificationType != NOTIFICATION_TYPE_DISPLAYED) {
                      Logger.i(TAG, "Removing notification with id " + id);

                      workManager.cancelUniqueWork("trigger:" + id);
                      // Remove all cancelled and finished work from its internal database
                      // states include SUCCEEDED, FAILED and CANCELLED
                      workManager.pruneWork();

                      // And with alarm manager
                      NotifeeAlarmManager.cancelNotification(id);
                    }
                  }

                  return null;
                }))
        .continueWith(
            task -> {
              // Chain the Room delete so the outer future — and therefore the JS
              // Promise — only completes after Room has drained. Fixes upstream
              // invertase/notifee#549 for the per-id cancel path.
              if (notificationType != NOTIFICATION_TYPE_DISPLAYED) {
                return WorkDataRepository.getInstance(getApplicationContext()).deleteByIds(ids);
              }
              return Futures.immediateFuture(null);
            },
            LISTENING_CACHED_THREAD_POOL);
  }

  static ListenableFuture<Void> displayNotification(
      NotificationModel notificationModel, Bundle triggerBundle) {
    return new ExtendedListenableFuture<>(notificationBundleToBuilder(notificationModel))
        .continueWith(
            (taskResult) -> {
              Trace.beginSection("notifee:displayNotification");
              try {
                NotificationCompat.Builder builder = taskResult;

                // Add the following extras for `getDisplayedNotifications()`
                Bundle extrasBundle = new Bundle();
                extrasBundle.putBundle(EXTRA_NOTIFEE_NOTIFICATION, notificationModel.toBundle());
                if (triggerBundle != null) {
                  extrasBundle.putBundle(EXTRA_NOTIFEE_TRIGGER, triggerBundle);
                }
                builder.addExtras(extrasBundle);

                NotificationAndroidModel androidBundle = notificationModel.getAndroid();

                // Set foreground service behavior before building (only for FGS notifications).
                // IMMEDIATE eliminates the 10-second display delay on Android 12+.
                if (androidBundle.getAsForegroundService()) {
                  builder.setForegroundServiceBehavior(
                      androidBundle.getForegroundServiceBehavior());
                }

                // build notification
                Notification notification = Objects.requireNonNull(builder).build();

                int hashCode = notificationModel.getHashCode();
                if (androidBundle.getLoopSound()) {
                  notification.flags |= Notification.FLAG_INSISTENT;
                }

                if (androidBundle.getFlags() != null && androidBundle.getFlags().length > 0) {
                  for (int flag : androidBundle.getFlags()) {
                    notification.flags |= flag;
                  }
                }

                if (androidBundle.getLightUpScreen()) {
                  PowerManagerUtils.lightUpScreenIfNeeded(ContextHolder.getApplicationContext());
                }

                if (androidBundle.getAsForegroundService()) {
                  Trace.beginSection("notifee:startForegroundService");
                  try {
                    ForegroundService.start(hashCode, notification, notificationModel.toBundle());
                  } finally {
                    Trace.endSection();
                  }
                } else {
                  NotificationManagerCompat.from(getApplicationContext())
                      .notify(androidBundle.getTag(), hashCode, notification);
                }

                EventBus.post(
                    new NotificationEvent(NotificationEvent.TYPE_DELIVERED, notificationModel));

                return Futures.immediateFuture(null);
              } finally {
                Trace.endSection();
              }
            },
            CACHED_THREAD_POOL);
  }

  static ListenableFuture<Void> createTriggerNotification(
      NotificationModel notificationModel, Bundle triggerBundle) {
    int triggerType = ObjectUtils.getInt(triggerBundle.get("type"));
    ListenableFuture<Void> scheduleFuture;
    switch (triggerType) {
      case 0:
        scheduleFuture = createTimestampTriggerNotification(notificationModel, triggerBundle);
        break;
      case 1:
        scheduleFuture = createIntervalTriggerNotification(notificationModel, triggerBundle);
        break;
      default:
        scheduleFuture = Futures.immediateFuture(null);
        break;
    }

    return Futures.transform(
        scheduleFuture,
        unused -> {
          EventBus.post(
              new NotificationEvent(
                  NotificationEvent.TYPE_TRIGGER_NOTIFICATION_CREATED, notificationModel));
          return null;
        },
        LISTENING_CACHED_THREAD_POOL);
  }

  // Returns a future that completes only after the Room insert has persisted AND
  // WorkManager has enqueued the periodic work. Chaining Room-first guarantees the
  // worker reads the row on its first fire even if the process is killed between
  // the JS Promise resolving and WorkManager scheduling. Fixes upstream
  // invertase/notifee#549 for the interval-trigger path.
  static ListenableFuture<Void> createIntervalTriggerNotification(
      NotificationModel notificationModel, Bundle triggerBundle) {
    IntervalTriggerModel trigger = IntervalTriggerModel.fromBundle(triggerBundle);
    String uniqueWorkName = "trigger:" + notificationModel.getId();
    Context context = getApplicationContext();

    ListenableFuture<Void> insertFuture =
        WorkDataRepository.insertTriggerNotification(
            context, notificationModel, triggerBundle, false);

    return Futures.transform(
        insertFuture,
        unused -> {
          WorkManager workManager = WorkManager.getInstance(context);
          Data.Builder workDataBuilder =
              new Data.Builder()
                  .putString(Worker.KEY_WORK_TYPE, Worker.WORK_TYPE_NOTIFICATION_TRIGGER)
                  .putString(Worker.KEY_WORK_REQUEST, Worker.WORK_REQUEST_PERIODIC)
                  .putString("id", notificationModel.getId());

          long interval = trigger.getInterval();
          PeriodicWorkRequest.Builder workRequestBuilder =
              new PeriodicWorkRequest.Builder(Worker.class, interval, trigger.getTimeUnit())
                  .setInitialDelay(interval, trigger.getTimeUnit());
          workRequestBuilder.addTag(Worker.WORK_TYPE_NOTIFICATION_TRIGGER);
          workRequestBuilder.addTag(uniqueWorkName);
          workRequestBuilder.setInputData(workDataBuilder.build());
          workManager.enqueueUniquePeriodicWork(
              uniqueWorkName, ExistingPeriodicWorkPolicy.UPDATE, workRequestBuilder.build());
          return null;
        },
        LISTENING_CACHED_THREAD_POOL);
  }

  // Returns a future that completes only after the Room insert has persisted AND
  // the AlarmManager / WorkManager schedule call has run. Same rationale as the
  // interval path above. Fixes upstream invertase/notifee#549 for the timestamp
  // trigger path (AlarmManager by default since 9.1.12).
  static ListenableFuture<Void> createTimestampTriggerNotification(
      NotificationModel notificationModel, Bundle triggerBundle) {
    TimestampTriggerModel trigger = TimestampTriggerModel.fromBundle(triggerBundle);

    String uniqueWorkName = "trigger:" + notificationModel.getId();

    long delay = trigger.getDelay();
    int interval = trigger.getInterval();

    Data.Builder workDataBuilder =
        new Data.Builder()
            .putString(Worker.KEY_WORK_TYPE, Worker.WORK_TYPE_NOTIFICATION_TRIGGER)
            .putString("id", notificationModel.getId());

    Boolean withAlarmManager = trigger.getWithAlarmManager();
    Context context = getApplicationContext();

    ListenableFuture<Void> insertFuture =
        WorkDataRepository.insertTriggerNotification(
            context, notificationModel, triggerBundle, withAlarmManager);

    return Futures.transform(
        insertFuture,
        unused -> {
          if (withAlarmManager) {
            NotifeeAlarmManager.scheduleTimestampTriggerNotification(notificationModel, trigger);
            return null;
          }

          WorkManager workManager = WorkManager.getInstance(context);

          // WorkManager - One time trigger
          if (interval == -1) {
            OneTimeWorkRequest.Builder workRequestBuilder =
                new OneTimeWorkRequest.Builder(Worker.class);
            workRequestBuilder.addTag(Worker.WORK_TYPE_NOTIFICATION_TRIGGER);
            workRequestBuilder.addTag(uniqueWorkName);
            workDataBuilder.putString(Worker.KEY_WORK_REQUEST, Worker.WORK_REQUEST_ONE_TIME);
            workRequestBuilder.setInputData(workDataBuilder.build());
            workRequestBuilder.setInitialDelay(delay, TimeUnit.SECONDS);
            workManager.enqueueUniqueWork(
                uniqueWorkName, ExistingWorkPolicy.REPLACE, workRequestBuilder.build());
          } else {
            // WorkManager - repeat trigger
            PeriodicWorkRequest.Builder workRequestBuilder =
                new PeriodicWorkRequest.Builder(
                    Worker.class, trigger.getInterval(), trigger.getTimeUnit());

            workRequestBuilder.addTag(Worker.WORK_TYPE_NOTIFICATION_TRIGGER);
            workRequestBuilder.addTag(uniqueWorkName);
            workRequestBuilder.setInitialDelay(delay, TimeUnit.SECONDS);
            workDataBuilder.putString(Worker.KEY_WORK_REQUEST, Worker.WORK_REQUEST_PERIODIC);
            workRequestBuilder.setInputData(workDataBuilder.build());
            workManager.enqueueUniquePeriodicWork(
                uniqueWorkName, ExistingPeriodicWorkPolicy.UPDATE, workRequestBuilder.build());
          }
          return null;
        },
        LISTENING_CACHED_THREAD_POOL);
  }

  static ListenableFuture<List<Bundle>> getDisplayedNotifications() {
    return LISTENING_CACHED_THREAD_POOL.submit(
        () -> {
          List<Bundle> notifications = new ArrayList<Bundle>();

          if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return notifications;
          }

          android.app.NotificationManager notificationManager =
              (android.app.NotificationManager)
                  getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);

          StatusBarNotification delivered[] = notificationManager.getActiveNotifications();

          for (StatusBarNotification sbNotification : delivered) {
            Notification original = sbNotification.getNotification();

            Bundle extras = original.extras;
            Bundle displayNotificationBundle = new Bundle();

            Bundle notificationBundle = extras.getBundle(EXTRA_NOTIFEE_NOTIFICATION);
            Bundle triggerBundle = extras.getBundle(EXTRA_NOTIFEE_TRIGGER);

            if (notificationBundle == null) {
              notificationBundle = new Bundle();
              notificationBundle.putString("id", "" + sbNotification.getId());

              Object title = extras.get(Notification.EXTRA_TITLE);

              if (title != null) {
                notificationBundle.putString("title", title.toString());
              }

              Object text = extras.get(Notification.EXTRA_TEXT);

              if (text != null) {
                notificationBundle.putString("body", text.toString());
              }

              Object subtitle = extras.get(Notification.EXTRA_SUB_TEXT);

              if (subtitle != null) {
                notificationBundle.putString("subtitle", subtitle.toString());
              }

              Bundle androidBundle = new Bundle();
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                androidBundle.putString("channelId", original.getChannelId());
              }
              androidBundle.putString("tag", sbNotification.getTag());
              androidBundle.putString("group", original.getGroup());

              notificationBundle.putBundle("android", androidBundle);

              displayNotificationBundle.putString("id", "" + sbNotification.getId());
            } else {
              displayNotificationBundle.putString("id", "" + notificationBundle.get("id"));
            }

            if (triggerBundle != null) {
              displayNotificationBundle.putBundle("trigger", triggerBundle);
            }

            displayNotificationBundle.putBundle("notification", notificationBundle);
            displayNotificationBundle.putString("date", "" + sbNotification.getPostTime());

            notifications.add(displayNotificationBundle);
          }

          return notifications;
        });
  }

  static void getTriggerNotifications(MethodCallResult<List<Bundle>> result) {
    WorkDataRepository workDataRepository = new WorkDataRepository(getApplicationContext());

    List<Bundle> triggerNotifications = new ArrayList<Bundle>();

    Futures.addCallback(
        workDataRepository.getAll(),
        new FutureCallback<List<WorkDataEntity>>() {
          @Override
          public void onSuccess(List<WorkDataEntity> workDataEntities) {
            for (WorkDataEntity workDataEntity : workDataEntities) {
              Bundle triggerNotificationBundle = new Bundle();

              triggerNotificationBundle.putBundle(
                  "notification", ObjectUtils.bytesToBundle(workDataEntity.getNotification()));

              triggerNotificationBundle.putBundle(
                  "trigger", ObjectUtils.bytesToBundle(workDataEntity.getTrigger()));
              triggerNotifications.add(triggerNotificationBundle);
            }

            result.onComplete(null, triggerNotifications);
          }

          @Override
          public void onFailure(Throwable t) {
            result.onComplete(new Exception(t), triggerNotifications);
          }
        },
        LISTENING_CACHED_THREAD_POOL);
  }

  static void getTriggerNotificationIds(MethodCallResult<List<String>> result) {
    WorkDataRepository workDataRepository = new WorkDataRepository(getApplicationContext());

    Futures.addCallback(
        workDataRepository.getAll(),
        new FutureCallback<List<WorkDataEntity>>() {
          @Override
          public void onSuccess(List<WorkDataEntity> workDataEntities) {
            List<String> triggerNotificationIds = new ArrayList<String>();
            for (WorkDataEntity workDataEntity : workDataEntities) {
              triggerNotificationIds.add(workDataEntity.getId());
            }

            result.onComplete(null, triggerNotificationIds);
          }

          @Override
          public void onFailure(Throwable t) {
            result.onComplete(new Exception(t), null);
          }
        },
        LISTENING_CACHED_THREAD_POOL);
  }

  /* Execute work from trigger notifications via WorkManager*/
  static void doScheduledWork(
      Data data, CallbackToFutureAdapter.Completer<ListenableWorker.Result> completer) {

    String id = data.getString("id");

    WorkDataRepository workDataRepository = new WorkDataRepository(getApplicationContext());

    AsyncFunction<WorkDataEntity, ListenableFuture<Void>> workContinuation =
        workDataEntity ->
            LISTENING_CACHED_THREAD_POOL.submit(
                () -> {
                  byte[] notificationBytes;

                  if (workDataEntity == null || workDataEntity.getNotification() == null) {
                    // check if notification bundle is stored with Work Manager
                    notificationBytes = data.getByteArray("notification");
                    if (notificationBytes != null) {
                      Logger.w(
                          TAG,
                          "The trigger notification was created using an older version, please"
                              + " consider recreating the notification.");
                    } else {
                      Logger.w(
                          TAG,
                          "Attempted to handle doScheduledWork but no notification data was"
                              + " found.");
                      completer.set(ListenableWorker.Result.success());
                      return Futures.immediateFuture(null);
                    }
                  } else {
                    notificationBytes = workDataEntity.getNotification();
                  }

                  NotificationModel notificationModel =
                      NotificationModel.fromBundle(ObjectUtils.bytesToBundle(notificationBytes));

                  byte[] triggerBytes = workDataEntity.getTrigger();
                  Bundle triggerBundle = null;

                  if (workDataEntity.getTrigger() != null) {
                    triggerBundle = ObjectUtils.bytesToBundle(triggerBytes);
                  }

                  return NotificationManager.displayNotification(notificationModel, triggerBundle);
                });

    new ExtendedListenableFuture<>(workDataRepository.getWorkDataById(id))
        .continueWith(workContinuation, LISTENING_CACHED_THREAD_POOL)
        .addOnCompleteListener(
            (e, result) -> {
              if (e == null) {
                new ExtendedListenableFuture<>(result)
                    .addOnCompleteListener(
                        (e2, _unused) -> {
                          if (e2 != null) {
                            Logger.e(TAG, "Failed to display notification", e2);
                            completer.set(Result.success());
                            return;
                          }
                          String workerRequestType = data.getString(Worker.KEY_WORK_REQUEST);
                          if (workerRequestType != null
                              && workerRequestType.equals(Worker.WORK_REQUEST_ONE_TIME)) {
                            // DO NOT reorder — completer.set must only run after the
                            // delete future completes, otherwise WorkManager may start
                            // a new work instance that reads the stale row. Previously
                            // completer.set fired before the delete was enqueued, leaving
                            // a zombie row that reboot recovery would resurrect as a
                            // ghost alarm. See #549 audit Part B, Caller #5.
                            //
                            // Note: CallbackToFutureAdapter.Completer.set() returns
                            // false on double-set, it does NOT throw. This is an
                            // androidx contract. Do not refactor under the assumption
                            // that double-set is dangerous.
                            Futures.addCallback(
                                WorkDataRepository.getInstance(getApplicationContext())
                                    .deleteById(id),
                                new FutureCallback<Void>() {
                                  @Override
                                  public void onSuccess(Void unused) {
                                    completer.set(Result.success());
                                  }

                                  @Override
                                  public void onFailure(@NonNull Throwable t) {
                                    // Notification was already displayed; a failed
                                    // delete leaves an orphan row that the next
                                    // cancelAll or app restart will clean up. Still
                                    // report success so WorkManager doesn't retry
                                    // the already-displayed notification.
                                    Logger.e(
                                        TAG,
                                        "Failed to delete one-time trigger row after" + " display",
                                        new Exception(t));
                                    completer.set(Result.success());
                                  }
                                },
                                LISTENING_CACHED_THREAD_POOL);
                          } else {
                            completer.set(Result.success());
                          }
                        },
                        LISTENING_CACHED_THREAD_POOL);
              } else {
                completer.set(Result.success());
                Logger.e(TAG, "Failed to display notification", e);
              }
            },
            LISTENING_CACHED_THREAD_POOL);
  }
}
