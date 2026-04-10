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
                  mCurrentNotificationId = null;
                  mCurrentNotificationBundle = null;
                  return START_NOT_STICKY;
                }
                Trace.beginSection("notifee:startForeground");
                try {
                  startForeground(hashCode, notification, foregroundServiceType);
                } finally {
                  Trace.endSection();
                }
                mCurrentForegroundServiceType = foregroundServiceType;
              } else {
                Trace.beginSection("notifee:startForeground");
                try {
                  startForeground(hashCode, notification);
                } finally {
                  Trace.endSection();
                }
              }

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

  @SuppressWarnings("deprecation")
  private void stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      stopForeground(STOP_FOREGROUND_REMOVE);
    } else {
      stopForeground(true);
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
