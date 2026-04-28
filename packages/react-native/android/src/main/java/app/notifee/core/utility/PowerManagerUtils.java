package app.notifee.core.utility;

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

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import app.notifee.core.ContextHolder;
import app.notifee.core.Logger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

public class PowerManagerUtils {
  private static final String TAG = "PowerManagerUtils";
  private static volatile Intent sPowerManagerIntentCache;

  public static void setPowerManagerIntentCache(Intent intent) {
    synchronized (PowerManagerUtils.class) {
      sPowerManagerIntentCache = intent;
    }
  }

  public static Intent getPowerManagerIntent() {
    synchronized (PowerManagerUtils.class) {
      return sPowerManagerIntentCache;
    }
  }

  /**
   * Attempts to open the device's battery optimization settings
   *
   * @param activity
   */
  public static void openBatteryOptimizationSettings(Activity activity) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      return;
    }

    try {
      Intent intent = new Intent();
      intent.setAction(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
      intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

      if (activity != null) {
        IntentUtils.startActivityOnUiThread(activity, intent);
      }
    } catch (Exception e) {
      Logger.e(TAG, "An error occurred whilst trying to open battery optimization settings", e);
    }
  }

  /**
   * Returns true if the app has battery optimization enabled
   *
   * @param context
   */
  public static Boolean isBatteryOptimizationEnabled(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      return false;
    }
    PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
    return !pm.isIgnoringBatteryOptimizations(context.getPackageName());
  }

  /**
   * Lights up the screen if it is not already lit
   *
   * @param context
   */
  // FULL_WAKE_LOCK and ON_AFTER_RELEASE are deprecated since API 17, but there is no
  // non-deprecated wake lock flag that can light up the screen from a Service/BroadcastReceiver
  // context. WindowManager.FLAG_KEEP_SCREEN_ON requires an Activity.
  @SuppressWarnings("deprecation")
  public static void lightUpScreenIfNeeded(Context context) {
    PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
    Boolean isInteractive = pm.isInteractive();

    if (isInteractive == false) {
      PowerManager.WakeLock wl =
          pm.newWakeLock(
              PowerManager.FULL_WAKE_LOCK
                  | PowerManager.ACQUIRE_CAUSES_WAKEUP
                  | PowerManager.ON_AFTER_RELEASE,
              "Notifee:lock");
      wl.acquire(3000L);

      PowerManager.WakeLock wl_cpu =
          pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Notifee:cpuLock");
      wl_cpu.acquire(3000L);
    }
  }

  /**
   * Retrieves information about the device and its Power Manager Settings
   *
   * @return PowerManagerInfo
   */
  public static PowerManagerInfo getPowerManagerInfo() {
    String activityName;

    Intent intent = getFirstPowerManagerIntent();
    activityName = IntentUtils.getActivityName(intent);

    PowerManagerInfo result =
        new PowerManagerInfo(Build.MANUFACTURER, Build.MODEL, Build.VERSION.RELEASE, activityName);
    return result;
  }

  /**
   * Attempts to open the device's Power Manager settings
   *
   * @param activity
   */
  public static void openPowerManagerSettings(Activity activity) {
    if (activity == null) {
      Logger.w(TAG, "Activity is null when trying to open the device's power manager");
      return;
    }

    Context context = ContextHolder.getApplicationContext();
    if (context == null) {
      Logger.w(TAG, "Unable to get application context when opening the device's power manager");
      return;
    }

    List<Intent> possibleIntents = getPowerManagerIntentCandidates();
    if (possibleIntents.isEmpty()) {
      Logger.w(TAG, "Unable to find an activity to open the device's power manager");
      return;
    }

    activity.runOnUiThread(
        () -> {
          for (Intent possibleIntent : possibleIntents) {
            if (startPowerManagerIntent(context, possibleIntent)) {
              return;
            }
          }

          Logger.w(TAG, "Unable to open the device's power manager");
        });
  }

  private static Intent getFirstPowerManagerIntent() {
    List<Intent> possibleIntents = getManufacturerPowerManagerIntents(getManufacturerName());
    if (possibleIntents.isEmpty()) {
      return null;
    }

    return possibleIntents.get(0);
  }

  private static List<Intent> getPowerManagerIntentCandidates() {
    List<Intent> possibleIntents = new ArrayList<>();
    Intent cachedIntent = getPowerManagerIntent();

    if (cachedIntent != null) {
      possibleIntents.add(cachedIntent);
    }

    for (Intent manufacturerIntent : getManufacturerPowerManagerIntents(getManufacturerName())) {
      if (!containsEquivalentIntent(possibleIntents, manufacturerIntent)) {
        possibleIntents.add(manufacturerIntent);
      }
    }

    return possibleIntents;
  }

  private static String getManufacturerName() {
    return Build.BRAND.toLowerCase(Locale.US);
  }

  private static boolean containsEquivalentIntent(List<Intent> possibleIntents, Intent candidate) {
    for (Intent possibleIntent : possibleIntents) {
      if (possibleIntent.filterEquals(candidate)) {
        return true;
      }
    }

    return false;
  }

  private static boolean startPowerManagerIntent(Context context, Intent possibleIntent) {
    Intent intent = new Intent(possibleIntent);
    intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

    try {
      context.startActivity(intent);
      setPowerManagerIntentCache(intent);
      return true;
    } catch (ActivityNotFoundException | SecurityException e) {
      Logger.w(TAG, "Unable to start activity: " + IntentUtils.getActivityName(intent), e);
    } catch (RuntimeException e) {
      Logger.w(TAG, "Unable to start activity: " + IntentUtils.getActivityName(intent), e);
    }

    return false;
  }

  private static List<Intent> getManufacturerPowerManagerIntents(String manufacturerName) {
    List<Intent> possibleIntents = new ArrayList<>();
    switch (manufacturerName) {
      case "asus":
        possibleIntents =
            Arrays.asList(
                createIntent(
                    "com.asus.mobilemanager",
                    "com.asus.mobilemanager.powersaver.PowerSaverSettings"),
                createIntent(
                    "com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"),
                createIntent(
                        "com.asus.mobilemanager", "com.asus.mobilemanager.entry.FunctionActivity")
                    .setData(Uri.parse("mobilemanager://function/entry/AutoStart")));
        break;
      case "samsung":
        possibleIntents =
            Arrays.asList(
                createIntent(
                    "com.samsung.android.lool",
                    "com.samsung.android.sm.ui.battery.BatteryActivity"),
                createIntent(
                    "com.samsung.android.sm", "com.samsung.android.sm.ui.battery.BatteryActivity"),
                createIntent(
                    "com.samsung.android.lool",
                    "com.samsung.android.sm.battery.ui.BatteryActivity"));
        break;
      case "huawei":
        possibleIntents =
            Arrays.asList(
                createIntent(
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.optimize.process.ProtectActivity"),
                createIntent(
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                createIntent(
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"));
        break;
      case "redmi":
      case "xiaomi":
        possibleIntents =
            Arrays.asList(
                createIntent(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"));
        break;
      case "letv":
        possibleIntents =
            Arrays.asList(
                createIntent(
                        "com.letv.android.letvsafe",
                        "com.letv.android.letvsafe.AutobootManageActivity")
                    .setData(Uri.parse("mobilemanager://function/entry/AutoStart")));
        break;
      case "honor":
        possibleIntents =
            Arrays.asList(
                createIntent(
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.optimize.process.ProtectActivity"));
        break;
      case "coloros":
      case "oppo":
        possibleIntents =
            Arrays.asList(
                createIntent(
                    "com.coloros.safecenter",
                    "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
                createIntent(
                    "com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
                createIntent(
                    "com.coloros.safecenter",
                    "com.coloros.safecenter.startupapp.StartupAppListActivity"),
                createIntent(
                    "com.coloros.oppoguardelf",
                    "com.coloros.powermanager.fuelgaue.PowerUsageModelActivity"),
                createIntent(
                    "com.coloros.oppoguardelf",
                    "com.coloros.powermanager.fuelgaue.PowerSaverModeActivity"),
                createIntent(
                    "com.coloros.oppoguardelf",
                    "com.coloros.powermanager.fuelgaue.PowerConsumptionActivity"));
        break;
      case "vivo":
        possibleIntents =
            Arrays.asList(
                createIntent(
                    "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
                createIntent(
                    "com.vivo.permissionmanager",
                    "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
                createIntent(
                    "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"));
        break;
      case "nokia":
        possibleIntents =
            Arrays.asList(
                createIntent(
                    "com.evenwell.powersaving.g3",
                    "com.evenwell.powersaving.g3.exception.PowerSaverExceptionActivity"));
        break;
      case "oneplus":
        possibleIntents =
            Arrays.asList(
                createIntent(
                    "com.oneplus.security",
                    "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"));
        break;
      case "meizu":
        possibleIntents =
            Arrays.asList(
                createIntent("com.meizu.safe", "com.meizu.safe.security.SHOW_APPSEC")
                    .addCategory(Intent.CATEGORY_DEFAULT));
        break;
      case "htc":
        possibleIntents =
            Arrays.asList(
                createIntent(
                    "com.htc.pitroad", "com.htc.pitroad.landingpage.activity.LandingPageActivity"));
        break;
      default:
        break;
    }

    return possibleIntents;
  }

  private static Intent createIntent(String pkg, String cls) {
    Intent intent = new Intent();
    intent.setComponent(new ComponentName(pkg, cls));
    return intent;
  }

  public static class PowerManagerInfo {
    String manufacturer;
    String model;
    String version;
    String activity;

    public PowerManagerInfo(String manufacturer, String model, String version, String activity) {
      this.manufacturer = manufacturer;
      this.model = model;
      this.version = version;
      this.activity = activity;
    }

    public Bundle toBundle() {
      Bundle bundle = new Bundle();
      bundle.putString("manufacturer", this.manufacturer);
      bundle.putString("model", this.model);
      bundle.putString("version", this.version);
      bundle.putString("activity", this.activity);

      return bundle;
    }
  }
}
