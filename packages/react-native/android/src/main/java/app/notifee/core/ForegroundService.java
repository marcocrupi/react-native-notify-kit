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

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Trace;
import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import app.notifee.core.event.ForegroundServiceEvent;
import app.notifee.core.event.NotificationEvent;
import app.notifee.core.interfaces.MethodCallResult;
import app.notifee.core.model.NotificationModel;

public class ForegroundService extends Service {
  private static final String TAG = "ForegroundService";
  public static final String START_FOREGROUND_SERVICE_ACTION =
      "app.notifee.core.ForegroundService.START";
  public static final String STOP_FOREGROUND_SERVICE_ACTION =
      "app.notifee.core.ForegroundService.STOP";

  private static final Object sLock = new Object();
  private static final String DEFENSIVE_CHANNEL_ID = "notifee_fg_default";
  private static final int DEFENSIVE_NOTIFICATION_ID = Integer.MAX_VALUE - 1;

  /**
   * Tracks whether startForeground() has been called on THIS service instance. This is an instance
   * field (not static) because the static fields below track cross-invocation notification state
   * shared across the process lifetime, but mStartForegroundCalled must track whether this specific
   * service instance — which may be a fresh recreation after process death — has fulfilled
   * Android's startForeground() contract. If the process is killed and Android recreates the
   * service, all statics reset AND a new instance is created; we need per-instance tracking to know
   * whether the recreated instance has called startForeground() before attempting stopSelf().
   */
  private volatile boolean mStartForegroundCalled = false;

  public static String mCurrentNotificationId = null;

  public static int mCurrentForegroundServiceType = -1;

  private static Bundle mCurrentNotificationBundle = null;
  private static Notification mCurrentNotification = null;
  private static int mCurrentHashCode = 0;

  /**
   * Re-posts the foreground service notification if the given notification ID matches the active
   * foreground service. On Android 14+, users can dismiss ongoing foreground service notifications
   * for most service types; this method restores the notification so the user remains aware of the
   * running service.
   *
   * @return true if the notification was re-posted, false otherwise
   */
  @SuppressLint("MissingPermission")
  static boolean repostIfActive(String notificationId) {
    synchronized (sLock) {
      if (mCurrentNotificationId == null
          || !mCurrentNotificationId.equals(notificationId)
          || mCurrentNotification == null) {
        return false;
      }
      Logger.w(TAG, "Re-posting foreground service notification dismissed by user");
      NotificationManagerCompat.from(ContextHolder.getApplicationContext())
          .notify(mCurrentHashCode, mCurrentNotification);
      return true;
    }
  }

  static void start(int hashCode, Notification notification, Bundle notificationBundle) {
    Context context = ContextHolder.getApplicationContext();
    if (context == null) {
      Logger.e(TAG, "Application context is null; cannot start ForegroundService.");
      return;
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      try {
        ComponentName component = new ComponentName(context, ForegroundService.class);
        ServiceInfo info =
            context.getPackageManager().getServiceInfo(component, PackageManager.GET_META_DATA);
        if (info.getForegroundServiceType() == ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE) {
          Logger.e(
              TAG,
              "No foregroundServiceType declared for app.notifee.core.ForegroundService in"
                  + " your AndroidManifest.xml. Android 14+ requires an explicit"
                  + " foregroundServiceType. Add <service"
                  + " android:name=\"app.notifee.core.ForegroundService\""
                  + " android:foregroundServiceType=\"yourType\" /> to your app manifest."
                  + " Aborting foreground service start.");
          return;
        }
      } catch (PackageManager.NameNotFoundException e) {
        Logger.e(TAG, "ForegroundService not found in manifest", e);
        return;
      }
    }

    Intent intent = new Intent(context, ForegroundService.class);
    intent.setAction(START_FOREGROUND_SERVICE_ACTION);
    intent.putExtra("hashCode", hashCode);
    intent.putExtra("notification", notification);
    intent.putExtra("notificationBundle", notificationBundle);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent);
    } else {
      // TODO test this on older device
      context.startService(intent);
    }
  }

  static void stop() {
    Context context = ContextHolder.getApplicationContext();
    if (context == null) {
      Logger.e(TAG, "Application context is null; cannot stop ForegroundService.");
      return;
    }

    Intent intent = new Intent(context, ForegroundService.class);
    intent.setAction(STOP_FOREGROUND_SERVICE_ACTION);

    try {
      // Call start service first with stop action
      context.startService(intent);
    } catch (IllegalStateException illegalStateException) {
      Logger.w(
          TAG,
          "startService() threw IllegalStateException on STOP path;"
              + " falling back to stopService()",
          illegalStateException);
      // try to stop with stopService command
      context.stopService(intent);
    } catch (Exception exception) {
      Logger.e(TAG, "Unable to stop foreground service", exception);
    }
  }

  @SuppressLint({"ForegroundServiceType", "MissingPermission"})
  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    Trace.beginSection("notifee:ForegroundService.onStartCommand");
    try {
      // Check if action is to stop the foreground service
      if (intent == null || STOP_FOREGROUND_SERVICE_ACTION.equals(intent.getAction())) {
        ensureStartForegroundContractSatisfied();
        stopSelf();
        synchronized (sLock) {
          mCurrentNotificationId = null;
          mCurrentForegroundServiceType = -1;
          mCurrentNotificationBundle = null;
          mCurrentNotification = null;
          mCurrentHashCode = 0;
        }
        return Service.START_STICKY_COMPATIBILITY;
      }

      Bundle extras = intent.getExtras();

      if (extras != null) {
        // Hash code is sent to service to ensure it is kept the same
        int hashCode = extras.getInt("hashCode");
        Notification notification = extras.getParcelable("notification");
        Bundle bundle = extras.getBundle("notificationBundle");

        if (notification != null && bundle != null) {
          NotificationModel notificationModel = NotificationModel.fromBundle(bundle);

          Object pendingEvent = null;
          boolean noneEarlyReturn = false;

          synchronized (sLock) {
            if (mCurrentNotificationId == null) {
              mCurrentNotificationId = notificationModel.getId();
              mCurrentNotificationBundle = bundle;
              mCurrentNotification = notification;
              mCurrentHashCode = hashCode;

              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                int foregroundServiceType =
                    notificationModel.getAndroid().getForegroundServiceType();
                if (foregroundServiceType == ServiceInfo.FOREGROUND_SERVICE_TYPE_MANIFEST) {
                  foregroundServiceType = resolveManifestServiceType();
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                    && foregroundServiceType == ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE) {
                  Logger.e(
                      TAG,
                      "Resolved foreground service type is NONE on API 34+; aborting"
                          + " startForeground to avoid InvalidForegroundServiceTypeException.");
                  // Reset stale state while still holding the lock.
                  mCurrentNotificationId = null;
                  mCurrentForegroundServiceType = -1;
                  mCurrentNotificationBundle = null;
                  mCurrentNotification = null;
                  mCurrentHashCode = 0;
                  // Set flag to call the helper AFTER releasing sLock — it performs
                  // Binder IPC (PackageManager + startForeground) and must not hold sLock.
                  noneEarlyReturn = true;
                } else {
                  Trace.beginSection("notifee:startForeground");
                  try {
                    startForeground(hashCode, notification, foregroundServiceType);
                  } finally {
                    Trace.endSection();
                  }
                  mStartForegroundCalled = true;
                  mCurrentForegroundServiceType = foregroundServiceType;
                }
              } else {
                Trace.beginSection("notifee:startForeground");
                try {
                  startForeground(hashCode, notification);
                } finally {
                  Trace.endSection();
                }
                mStartForegroundCalled = true;
              }

              if (!noneEarlyReturn) {
                // On headless task complete
                final MethodCallResult<Void> methodCallResult =
                    (e, aVoid) -> {
                      stopForegroundCompat();
                      synchronized (sLock) {
                        mCurrentNotificationId = null;
                        mCurrentForegroundServiceType = -1;
                        mCurrentNotificationBundle = null;
                        mCurrentNotification = null;
                        mCurrentHashCode = 0;
                      }
                    };

                pendingEvent = new ForegroundServiceEvent(notificationModel, methodCallResult);
              }
            } else {
              if (mCurrentNotificationId.equals(notificationModel.getId())) {
                boolean shouldPostNotificationAgain = true;
                // find if we need to start the service again if the type was changed
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                  int foregroundServiceType =
                      notificationModel.getAndroid().getForegroundServiceType();
                  if (foregroundServiceType == ServiceInfo.FOREGROUND_SERVICE_TYPE_MANIFEST) {
                    foregroundServiceType = resolveManifestServiceType();
                  }
                  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                      && foregroundServiceType == ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE) {
                    Logger.e(
                        TAG,
                        "Resolved foreground service type is NONE on API 34+; skipping type"
                            + " change.");
                  } else if (foregroundServiceType != mCurrentForegroundServiceType) {
                    Trace.beginSection("notifee:startForeground");
                    try {
                      startForeground(hashCode, notification, foregroundServiceType);
                    } finally {
                      Trace.endSection();
                    }
                    mStartForegroundCalled = true;
                    mCurrentForegroundServiceType = foregroundServiceType;
                    shouldPostNotificationAgain = false;
                  }
                }
                if (shouldPostNotificationAgain) {
                  NotificationManagerCompat.from(ContextHolder.getApplicationContext())
                      .notify(hashCode, notification);
                }
              } else {
                pendingEvent =
                    new NotificationEvent(
                        NotificationEvent.TYPE_FG_ALREADY_EXIST, notificationModel);
              }
            }
          }

          // Handle NONE early return outside the lock — the helper performs Binder IPC
          // (PackageManager query + startForeground) that must not hold sLock.
          if (noneEarlyReturn) {
            ensureStartForegroundContractSatisfied();
            return START_NOT_STICKY;
          }

          if (pendingEvent != null) {
            EventBus.post(pendingEvent);
          }
        }
      }

      return START_NOT_STICKY;
    } finally {
      Trace.endSection();
    }
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  /**
   * Called by the system on API 34 (Android 14) when a foreground service of type {@code
   * shortService} exceeds its timeout. Stops the service gracefully to prevent ANR.
   */
  @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
  @Override
  public void onTimeout(int startId) {
    handleTimeout(startId, -1);
  }

  /**
   * Called by the system on API 35+ (Android 15+) when a foreground service exceeds its
   * type-specific timeout. Supersedes the single-parameter variant on these API levels.
   */
  @RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
  @Override
  public void onTimeout(int startId, int fgsType) {
    handleTimeout(startId, fgsType);
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private static int resolveManifestServiceType() {
    try {
      Context context = ContextHolder.getApplicationContext();
      if (context == null) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE
            : ServiceInfo.FOREGROUND_SERVICE_TYPE_MANIFEST;
      }
      ComponentName component = new ComponentName(context, ForegroundService.class);
      ServiceInfo info =
          context.getPackageManager().getServiceInfo(component, PackageManager.GET_META_DATA);
      int type = info.getForegroundServiceType();
      if (type != ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE) {
        return type;
      }
    } catch (PackageManager.NameNotFoundException e) {
      Logger.e(TAG, "ForegroundService not found in manifest", e);
    }
    // On API 34+ returning MANIFEST (-1) would crash in startForeground(), so return NONE.
    // On API 29-33 MANIFEST is accepted by the framework and resolves at runtime.
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
        ? ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE
        : ServiceInfo.FOREGROUND_SERVICE_TYPE_MANIFEST;
  }

  /**
   * Ensures the defensive notification channel exists. Required for the placeholder notification
   * used on the STOP path when startForeground() was never called on this instance.
   */
  private void ensureDefensiveChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
      if (nm != null && nm.getNotificationChannel(DEFENSIVE_CHANNEL_ID) == null) {
        NotificationChannel channel =
            new NotificationChannel(
                DEFENSIVE_CHANNEL_ID, "Foreground Service", NotificationManager.IMPORTANCE_MIN);
        channel.setShowBadge(false);
        channel.enableLights(false);
        channel.enableVibration(false);
        channel.setSound(null, null);
        nm.createNotificationChannel(channel);
      }
    }
  }

  @SuppressWarnings("deprecation")
  private void stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      stopForeground(STOP_FOREGROUND_REMOVE);
    } else {
      stopForeground(true);
    }
  }

  /**
   * Queries the PackageManager for the {@code foregroundServiceType} attribute declared on this
   * service's {@code <service>} element in AndroidManifest.xml.
   *
   * <p>This is intentionally separate from {@link #resolveManifestServiceType()} (which resolves
   * the effective type for the normal startForeground path). That method is static, uses {@link
   * ContextHolder#getApplicationContext()} (which may be null during early recreation), and has
   * different return semantics — it maps missing types to {@code FOREGROUND_SERVICE_TYPE_MANIFEST}
   * on API 29-33 and to {@code FOREGROUND_SERVICE_TYPE_NONE} on API 34+. This method is an instance
   * method that uses {@code this} as context (always valid inside a running Service) and returns
   * the raw declared value without any API-level mapping, which is what the proactive manifest
   * check in {@link #ensureStartForegroundContractSatisfied()} needs.
   *
   * @return the raw {@code foregroundServiceType} bitmask from the manifest, or 0 if the service is
   *     not declared or has no explicit type
   */
  private int getDeclaredForegroundServiceType() {
    try {
      ComponentName component = new ComponentName(this, ForegroundService.class);
      ServiceInfo info =
          getPackageManager().getServiceInfo(component, PackageManager.GET_META_DATA);
      return info.getForegroundServiceType();
    } catch (PackageManager.NameNotFoundException e) {
      return 0;
    }
  }

  /**
   * Ensures Android's 5-second {@code startForeground()} contract is satisfied before an early
   * return from {@link #onStartCommand(Intent, int, int)}.
   *
   * <p>This method is idempotent: if {@link #mStartForegroundCalled} is already {@code true} (i.e.,
   * this service instance has previously called {@code startForeground()} successfully), this
   * method returns immediately without side effects.
   *
   * <p>On API 34+ (Android 14), this method performs a proactive manifest check via {@link
   * #getDeclaredForegroundServiceType()} before attempting the defensive {@code startForeground()}
   * call. If no {@code foregroundServiceType} is declared in the manifest, the method throws a
   * {@link RuntimeException} with a clear error message and documentation URL instead of proceeding
   * to a call that would fail with a cryptic {@code SecurityException}.
   *
   * <p>On API levels below 34, the manifest check is skipped and the defensive {@code
   * startForeground()} is called directly, as no {@code foregroundServiceType} declaration is
   * required.
   *
   * @throws RuntimeException if the manifest is missing required {@code foregroundServiceType}
   *     declarations on API 34+, or if the defensive {@code startForeground()} call fails for any
   *     other reason. In both cases, the exception terminates the process with a crash report that
   *     is more actionable than the ANR that would otherwise occur.
   */
  @SuppressLint({"ForegroundServiceType", "MissingPermission"})
  private void ensureStartForegroundContractSatisfied() {
    if (mStartForegroundCalled) {
      return;
    }

    // Proactive manifest check on API 34+: fail fast with actionable message.
    // Also caches the declared type for use in the 3-param startForeground() call below.
    int declaredTypes = 0;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      declaredTypes = getDeclaredForegroundServiceType();
      if (declaredTypes == 0) {
        String msg =
            "react-native-notify-kit: ForegroundService cannot start — "
                + "no foregroundServiceType declared in AndroidManifest.xml on API 34+. "
                + "See https://github.com/marcocrupi/react-native-notify-kit"
                + "#foreground-service-setup-android-14";
        Logger.e(TAG, msg);
        // Intentional crash: a RuntimeException here terminates the process with a clear,
        // actionable crash report within milliseconds — well inside the 5-second ANR budget.
        // The alternative (catching and calling stopSelf()) leaves Android's startForeground()
        // contract unsatisfied, which produces a ForegroundServiceDidNotStartInTimeException
        // ANR with a framework-only stack trace that gives no indication of the root cause.
        // Do NOT suppress this throw without also providing an alternative mechanism to satisfy
        // the startForeground() contract or terminate the process before the ANR fires.
        throw new RuntimeException(msg);
      }
    }

    try {
      ensureDefensiveChannel();
      Notification placeholder =
          new NotificationCompat.Builder(this, DEFENSIVE_CHANNEL_ID)
              .setSmallIcon(android.R.drawable.ic_dialog_info)
              .build();
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        // On API 34+, pass the manifest-declared type explicitly rather than relying on
        // the 2-param startForeground() to resolve type 0 → manifest type. This avoids
        // ambiguity about implicit type resolution behavior across OEM variants.
        startForeground(DEFENSIVE_NOTIFICATION_ID, placeholder, declaredTypes);
      } else {
        startForeground(DEFENSIVE_NOTIFICATION_ID, placeholder);
      }
      mStartForegroundCalled = true;
      stopForegroundCompat();
    } catch (Exception e) {
      String msg =
          "react-native-notify-kit: defensive startForeground() failed. "
              + "This indicates an inconsistent service state and the process cannot recover.";
      Logger.e(TAG, msg, e);
      throw new RuntimeException(msg, e);
    }
  }

  private void handleTimeout(int startId, int fgsType) {
    Logger.e(
        TAG,
        "Foreground service timed out (startId="
            + startId
            + ", type="
            + fgsType
            + "). Stopping service.");

    Bundle notifBundle;
    synchronized (sLock) {
      notifBundle = mCurrentNotificationBundle;
      mCurrentNotificationId = null;
      mCurrentForegroundServiceType = -1;
      mCurrentNotificationBundle = null;
      mCurrentNotification = null;
      mCurrentHashCode = 0;
    }

    stopForegroundCompat();
    stopSelf(startId);

    if (notifBundle != null) {
      NotificationModel model = NotificationModel.fromBundle(notifBundle);
      Bundle extras = new Bundle();
      extras.putInt("startId", startId);
      extras.putInt("fgsType", fgsType);
      EventBus.post(new NotificationEvent(NotificationEvent.TYPE_FG_TIMEOUT, model, extras));
    }
  }
}
