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
import android.provider.Settings;
import androidx.annotation.CallSuper;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.VisibleForTesting;
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
      if (appContext != null) {
        if (isWarmupEnabled(appContext)) {
          dispatchWarmup(appContext);
        }
        // Fix for upstream invertase/notifee#734: recover scheduled alarms on every app init
        // when a reboot has occurred since the last run. Runs unconditionally (not gated by
        // the warmup metadata flag) because this is recovery, not optimisation. Always on a
        // background thread to keep app startup clean.
        dispatchBootCheck(appContext);
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

    executor.submit(() -> WarmupHelper.runWarmup(context));
    executor.shutdown();
  }

  /**
   * Dispatches the BOOT_COUNT cold-start recovery check on a background thread. Mirrors {@link
   * #dispatchWarmup} so that app startup stays free of I/O. Fix for upstream invertase/notifee#734.
   */
  private static void dispatchBootCheck(final Context context) {
    ExecutorService executor =
        Executors.newSingleThreadExecutor(
            r -> {
              Thread t = new Thread(r, "notifee-boot-check");
              t.setDaemon(true);
              t.setPriority(Thread.MIN_PRIORITY);
              return t;
            });

    executor.submit(() -> runBootCheck(context));
    executor.shutdown();
  }

  /**
   * Reads {@code Settings.Global.BOOT_COUNT} and compares it against the last-known value stored in
   * {@link Preferences}. If a reboot has occurred since the last app run — or if BOOT_COUNT cannot
   * be read (custom ROMs, emulators, exotic vendors) — invokes {@link
   * NotifeeAlarmManager#rescheduleNotifications(android.content.BroadcastReceiver.PendingResult)}
   * to recover any AlarmManager triggers that may not have been re-armed by {@code
   * RebootBroadcastReceiver} on OEM devices that suppress {@code BOOT_COMPLETED}.
   *
   * <p>Package-private for direct invocation from Robolectric unit tests.
   */
  static void runBootCheck(Context context) {
    try {
      int currentBootCount = readBootCount(context);
      int lastKnownBootCount =
          Preferences.getSharedInstance().getIntValue(Preferences.LAST_KNOWN_BOOT_COUNT_KEY, -1);

      boolean shouldReschedule = shouldRescheduleAfterBoot(currentBootCount, lastKnownBootCount);

      if (currentBootCount == -1 && lastKnownBootCount == -1) {
        Logger.i(TAG, "BOOT_COUNT unavailable on first run; running conservative reschedule");
      } else if (currentBootCount == -1) {
        Logger.i(TAG, "BOOT_COUNT unavailable; running conservative reschedule to be safe");
      } else if (lastKnownBootCount == -1) {
        Logger.i(TAG, "First run: recording BOOT_COUNT baseline " + currentBootCount);
      } else if (currentBootCount != lastKnownBootCount) {
        Logger.i(
            TAG,
            "Boot detected since last run ("
                + lastKnownBootCount
                + " -> "
                + currentBootCount
                + "), rescheduling");
      }

      // Only persist real values. Writing -1 would erase a prior real baseline
      // and cause every subsequent init to run a conservative reschedule.
      if (currentBootCount != -1) {
        Preferences.getSharedInstance()
            .setIntValue(Preferences.LAST_KNOWN_BOOT_COUNT_KEY, currentBootCount);
      }

      if (shouldReschedule) {
        new NotifeeAlarmManager().rescheduleNotifications(null);
      }
    } catch (Throwable t) {
      Logger.e(TAG, "Cold-start reschedule check failed", t);
    }
  }

  private static int readBootCount(Context context) {
    try {
      return Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT, -1);
    } catch (Throwable t) {
      Logger.w(TAG, "Failed to read Settings.Global.BOOT_COUNT", t);
      return -1;
    }
  }

  /**
   * Pure decision function for BOOT_COUNT-based cold-start recovery. Returns {@code true} when the
   * current init should trigger a reschedule pass, {@code false} otherwise.
   *
   * <ul>
   *   <li>{@code currentBootCount == -1} → BOOT_COUNT unavailable; reschedule conservatively.
   *   <li>{@code lastKnownBootCount == -1} → first run; record baseline without rescheduling.
   *   <li>{@code currentBootCount != lastKnownBootCount} → reboot detected; reschedule.
   *   <li>Otherwise → same boot as last run; no-op.
   * </ul>
   */
  @VisibleForTesting
  static boolean shouldRescheduleAfterBoot(int currentBootCount, int lastKnownBootCount) {
    if (currentBootCount == -1) {
      return true;
    }
    if (lastKnownBootCount == -1) {
      return false;
    }
    return currentBootCount != lastKnownBootCount;
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
