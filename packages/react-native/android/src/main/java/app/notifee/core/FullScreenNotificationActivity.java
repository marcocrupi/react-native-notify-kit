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

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.WindowManager;

/** Captures a full-screen launch before starting its consumer, without displaying a window. */
public class FullScreenNotificationActivity extends Activity {
  static final String ACTION = "app.notifee.core.FULL_SCREEN_LAUNCH";
  static final String LAUNCH_INTENT = "app.notifee.core.FULL_SCREEN_CONSUMER";

  @Override
  protected void onCreate(Bundle state) {
    // API 26 uses window flags; newer versions also use the manifest's screen/keyguard flags.
    getWindow()
        .addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
    super.onCreate(state);
    launchConsumer(getIntent());
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    launchConsumer(intent);
  }

  private void launchConsumer(Intent intent) {
    try {
      if (intent == null
          || !ACTION.equals(intent.getAction())
          || !Notifee.isValidFullScreenLaunch(intent)) return;
      Intent destination = intent.getParcelableExtra(LAUNCH_INTENT);
      if (destination == null
          || destination.getComponent() == null
          || !getPackageName().equals(destination.getComponent().getPackageName())) return;
      // An invalid/disabled destination must not retire a previous unread launch.
      if (getPackageManager().resolveActivity(destination, 0) == null) {
        return;
      }
      // The carrier owns the payload. The nested Intent contains only the original destination
      // and flags, so the private routing extra never reaches the consumer or the public API.
      Intent consumer = new Intent(destination);
      consumer.replaceExtras(new Bundle(intent.getExtras()));
      consumer.removeExtra(LAUNCH_INTENT);
      if (ContextHolder.getApplicationContext() == null) {
        ContextHolder.setApplicationContext(getApplicationContext());
      }
      Notifee.recordFullScreenLaunch(consumer);
      startActivity(consumer);
    } catch (Exception e) {
      Logger.e("FullScreenNotificationActivity", "Failed to launch full-screen consumer", e);
    } finally {
      finish();
    }
  }
}
