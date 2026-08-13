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

import static app.notifee.core.ContextHolder.getApplicationContext;

import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import androidx.annotation.Nullable;
import androidx.annotation.VisibleForTesting;

public class FullScreenIntentUtils {

  @Nullable
  private static NotificationManager getNotificationManager() {
    Context context = getApplicationContext();
    if (context == null) {
      return null;
    }
    return (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
  }

  /**
   * Whether a notification posted with a full screen action will actually be shown full screen.
   *
   * <p>On Android 14 / API 34 and above, {@code USE_FULL_SCREEN_INTENT} is a user-revocable special
   * app access rather than a normal install-time permission: the Play Store revokes it on install
   * for apps outside the calling and alarm categories, and the user can toggle it at any time. When
   * it is denied the notification still posts normally and nothing throws — only the full screen
   * presentation is dropped — so this is the sole reliable way to detect it.
   *
   * <p>Below API 34 the manifest permission is granted at install and always honoured.
   *
   * @return true when a full screen intent will be honoured, false when the user or the system has
   *     denied it.
   */
  public static boolean canUseFullScreenIntent() {
    return canUseFullScreenIntent(getNotificationManager());
  }

  @VisibleForTesting
  static boolean canUseFullScreenIntent(@Nullable NotificationManager notificationManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      return true;
    }

    // Fail open: an absent NotificationManager tells us nothing, and reporting a denial we
    // cannot prove would have apps nag the user about a setting that may well be granted.
    if (notificationManager == null) {
      return true;
    }

    return notificationManager.canUseFullScreenIntent();
  }
}
