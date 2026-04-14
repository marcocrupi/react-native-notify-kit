package app.notifee.core;

import static android.app.AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class AlarmPermissionBroadcastReceiver extends BroadcastReceiver {
  private static final String TAG = "AlarmPermissionReceiver";

  @Override
  public void onReceive(Context context, Intent intent) {
    if (!ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(intent.getAction())) {
      return;
    }

    PendingResult pendingResult = goAsync();
    // See RebootBroadcastReceiver for the rationale behind this guard.
    boolean asyncHandoffSucceeded = false;
    try {
      Logger.i(TAG, "Received alarm permission state changed event");
      if (ContextHolder.getApplicationContext() == null) {
        ContextHolder.setApplicationContext(context.getApplicationContext());
      }
      new NotifeeAlarmManager().rescheduleNotifications(pendingResult);
      asyncHandoffSucceeded = true;
    } catch (Throwable t) {
      Logger.e(TAG, "Failed to reschedule notifications after permission change", t);
    } finally {
      if (!asyncHandoffSucceeded && pendingResult != null) {
        pendingResult.finish();
      }
    }
  }
}
