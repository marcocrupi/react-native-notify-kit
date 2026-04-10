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

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Trace;
import androidx.annotation.CallSuper;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationManagerCompat;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@KeepForSdk
public class InitProvider extends ContentProvider {
  private static final String PROVIDER_AUTHORITY = "notifee-init-provider";

  @Override
  public void attachInfo(Context context, ProviderInfo info) {
    if (info != null && !info.authority.endsWith(InitProvider.PROVIDER_AUTHORITY)) {
      throw new IllegalStateException(
          "Incorrect provider authority in manifest. This is most likely due to a missing "
              + "applicationId variable in application's build.gradle.");
    }

    super.attachInfo(context, info);
  }

  private static final String TAG = "InitProvider";

  private static final String[] WARMUP_CLASSES = {
    "app.notifee.core.ForegroundService",
    "app.notifee.core.NotificationManager",
    "app.notifee.core.model.NotificationModel",
    "app.notifee.core.model.NotificationAndroidModel",
    "app.notifee.core.model.ChannelModel",
    "androidx.core.app.NotificationCompat$Builder",
    "androidx.core.app.NotificationManagerCompat",
  };

  @KeepForSdk
  @CallSuper
  @Override
  public boolean onCreate() {
    Trace.beginSection("notifee:InitProvider.onCreate");
    try {
      if (ContextHolder.getApplicationContext() == null) {
        Context context = getContext();
        if (context != null && context.getApplicationContext() != null) {
          context = context.getApplicationContext();
        }
        ContextHolder.setApplicationContext(context);
      }

      Context appContext = ContextHolder.getApplicationContext();
      if (appContext != null && isWarmupEnabled(appContext)) {
        dispatchWarmup(appContext);
      }
    } finally {
      Trace.endSection();
    }

    return false;
  }

  private static boolean isWarmupEnabled(Context context) {
    try {
      ApplicationInfo ai =
          context
              .getPackageManager()
              .getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA);
      return ai.metaData == null || ai.metaData.getBoolean("notifee_init_warmup_enabled", true);
    } catch (PackageManager.NameNotFoundException e) {
      return true;
    }
  }

  private static void dispatchWarmup(final Context context) {
    ExecutorService executor =
        Executors.newSingleThreadExecutor(
            r -> {
              Thread t = new Thread(r, "notifee-init-warmup");
              t.setDaemon(true);
              t.setPriority(Thread.MIN_PRIORITY);
              return t;
            });

    final ClassLoader classLoader = context.getClassLoader();

    executor.submit(
        () -> {
          Trace.beginSection("notifee:warmup");
          try {
            // Pre-load critical foreground service classes to move ART class loading/verification
            // cost from the first displayNotification() call to app startup.
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
        });

    executor.shutdown();
  }

  @Nullable
  @Override
  public Cursor query(
      @NonNull Uri uri,
      String[] projection,
      String selection,
      String[] selectionArgs,
      String sortOrder) {
    return null;
  }

  @Nullable
  @Override
  public String getType(@NonNull Uri uri) {
    return null;
  }

  @Nullable
  @Override
  public Uri insert(@NonNull Uri uri, ContentValues values) {
    return null;
  }

  @Override
  public int delete(@NonNull Uri uri, String selection, String[] selectionArgs) {
    return 0;
  }

  @Override
  public int update(
      @NonNull Uri uri, ContentValues values, String selection, String[] selectionArgs) {
    return 0;
  }
}
