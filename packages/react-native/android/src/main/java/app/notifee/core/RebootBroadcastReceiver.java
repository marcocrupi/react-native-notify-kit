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

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/*
 * This is invoked when the phone restarts to ensure that all notifications created by the alarm manager
 * are rescheduled correctly, as Android removes all scheduled alarms when the phone shuts down.
 */
public class RebootBroadcastReceiver extends BroadcastReceiver {
  private static final String TAG = "RebootReceiver";

  @Override
  public void onReceive(Context context, Intent intent) {
    PendingResult pendingResult = goAsync();
    // Tracks whether the synchronous section successfully handed off to the
    // async reschedule path. If not, the finally block must call finish() to
    // avoid leaving the broadcast unterminated — Android will otherwise kill
    // the process after ~10s and race subsequent reboot broadcasts.
    boolean asyncHandoffSucceeded = false;
    try {
      Logger.i(TAG, "Received reboot event");
      if (ContextHolder.getApplicationContext() == null) {
        ContextHolder.setApplicationContext(context.getApplicationContext());
      }
      new NotifeeAlarmManager().rescheduleNotifications(pendingResult);
      asyncHandoffSucceeded = true;
    } catch (Throwable t) {
      Logger.e(TAG, "Failed to reschedule notifications after reboot", t);
    } finally {
      if (!asyncHandoffSucceeded && pendingResult != null) {
        pendingResult.finish();
      }
    }
  }
}
