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

import android.content.Context;
import androidx.annotation.Nullable;
import androidx.annotation.VisibleForTesting;
import androidx.core.app.NotificationManagerCompat;

public class FullScreenIntentUtils {

  /**
   * Whether the app currently has the Android access required to use full-screen intents.
   *
   * <p>API levels below 29 do not use the full-screen intent permission model. API levels 29
   * through 33 require {@code USE_FULL_SCREEN_INTENT}. API level 34 and above use Android's
   * full-screen intent special app access.
   *
   * @return true when the required access is currently available. This does not guarantee that a
   *     particular notification will be presented full-screen.
   */
  public static boolean canUseFullScreenIntent() {
    return canUseFullScreenIntent(getApplicationContext());
  }

  @VisibleForTesting
  static boolean canUseFullScreenIntent(@Nullable Context context) {
    // The application context is expected to exist on the public path. Preserve the existing
    // defensive fail-open behavior for an internal state that cannot prove access is denied.
    if (context == null) {
      return true;
    }

    return NotificationManagerCompat.from(context).canUseFullScreenIntent();
  }
}
