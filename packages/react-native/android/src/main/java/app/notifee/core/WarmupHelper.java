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

import android.content.Context;
import android.os.Trace;
import androidx.core.app.NotificationManagerCompat;

/**
 * Encapsulates the foreground-service warmup logic so it can be called from both {@link
 * InitProvider} (automatic, at app startup) and the JS bridge ({@code prewarmForegroundService()},
 * on-demand).
 *
 * <p>This class runs <b>synchronously</b> on the caller's thread. Callers are responsible for
 * choosing the appropriate thread/executor.
 *
 * <p>Safe to call multiple times (idempotent). After the first call, class loading is a no-op from
 * ART's perspective and the Binder proxy call is cheap.
 */
@KeepForSdk
public final class WarmupHelper {

  private static final String TAG = "WarmupHelper";

  static final String[] WARMUP_CLASSES = {
    "app.notifee.core.ForegroundService",
    "app.notifee.core.NotificationManager",
    "app.notifee.core.model.NotificationModel",
    "app.notifee.core.model.NotificationAndroidModel",
    "app.notifee.core.model.ChannelModel",
    "androidx.core.app.NotificationCompat$Builder",
    "androidx.core.app.NotificationManagerCompat",
  };

  private WarmupHelper() {}

  /**
   * Pre-loads critical foreground-service classes and warms the INotificationManager Binder proxy.
   * Runs synchronously on the caller's thread.
   *
   * @param context Application context used for class loading and Binder warmup.
   */
  @KeepForSdk
  public static void runWarmup(Context context) {
    Trace.beginSection("notifee:warmup");
    try {
      ClassLoader classLoader = context.getClassLoader();

      // Pre-load critical foreground service classes to move ART class loading/verification
      // cost from the first displayNotification() call to whenever the caller chooses.
      for (String className : WARMUP_CLASSES) {
        try {
          Class.forName(className, true, classLoader);
        } catch (ClassNotFoundException e) {
          Logger.d(TAG, "Warmup class not found: " + className);
        }
      }

      // Pre-warm INotificationManager Binder proxy by touching NotificationManagerCompat.
      try {
        NotificationManagerCompat.from(context).getNotificationChannels();
      } catch (Exception e) {
        Logger.d(TAG, "Warmup Binder pre-warm failed: " + e.getMessage());
      }
    } finally {
      Trace.endSection();
    }
  }
}
