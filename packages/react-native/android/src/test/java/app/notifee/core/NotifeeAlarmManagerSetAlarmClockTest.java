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
 */

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.os.Bundle;
import app.notifee.core.model.NotificationModel;
import app.notifee.core.model.TimestampTriggerModel;
import app.notifee.core.utility.AlarmUtils;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/**
 * Unit coverage for the {@link TimestampTriggerModel.AlarmType#SET_ALARM_CLOCK} branch of {@link
 * NotifeeAlarmManager#scheduleTimestampTriggerNotification} and its supporting helper {@link
 * NotifeeAlarmManager#buildShowIntentPressActionBundle}. This branch was added in upstream {@code
 * invertase/notifee#749} (closing {@code #655}) and refactored in this fork to reuse the {@code
 * pressAction} path that the 9.1.19 / 9.3.0 fixes rely on — see the commit that introduces this
 * file for the full rationale.
 *
 * <p>Three scenarios are guarded:
 *
 * <ol>
 *   <li><b>Happy path</b> — a non-repeating TIMESTAMP trigger with {@code
 *       AlarmType.SET_ALARM_CLOCK} results in exactly one {@link
 *       AlarmManager#setAlarmClock(AlarmManager.AlarmClockInfo, PendingIntent)} call, the captured
 *       {@link AlarmManager.AlarmClockInfo} carries a non-null show intent, and the inexact
 *       fallback path is not exercised.
 *   <li><b>SecurityException fallback</b> — if {@code setAlarmClock} throws (Android 12+ can reject
 *       even after {@code canScheduleExactAlarms()} returns true, e.g. when the permission is
 *       revoked between the pre-check and the schedule call), the catch in {@code
 *       scheduleTimestampTriggerNotification} must route to {@code setAndAllowWhileIdle} so the
 *       notification still fires as an inexact alarm rather than disappearing silently.
 *   <li><b>Show-intent pressAction resolution</b> — a regression guard for the refactor that
 *       replaced the ad-hoc {@code getLaunchIntentForPackage} with a call into {@link
 *       NotificationPendingIntent#createIntent}. The helper must (a) synthesize the {@code {
 *       id:'default', launchActivity:'default' }} bundle when the notification has no {@code
 *       pressAction} (typical for triggers rehydrated from Room after an app kill), (b) synthesize
 *       the same default when the user opted out via {@link
 *       NotificationPendingIntent#PRESS_ACTION_OPT_OUT_ID} (the alarm-clock icon in the status bar
 *       has no non-tappable mode, so we still need a valid show intent), and (c) pass a custom
 *       pressAction through unchanged so {@code launchActivity} / {@code mainComponent} routing is
 *       honoured end-to-end.
 * </ol>
 *
 * <p>Test strategy: {@link MockedStatic} intercepts {@link AlarmUtils#getAlarmManager()} so the
 * production code receives a Mockito-controlled {@link AlarmManager} instead of Robolectric's
 * shadow. This lets the tests stub {@code canScheduleExactAlarms()} to skip the Android S+
 * pre-check, stub {@code setAlarmClock} to either succeed or throw, and capture the {@link
 * AlarmManager.AlarmClockInfo} that reached the platform. Everything else — {@link ContextHolder},
 * {@link NotificationPendingIntent#createIntent}, the Intent/PendingIntent plumbing — runs against
 * Robolectric's real application context.
 */
@RunWith(RobolectricTestRunner.class)
// Robolectric's default SDK is too low for AlarmManager#canScheduleExactAlarms() (API 31+).
// Pin to API 34 — matches ForegroundServiceTest and exercises the Android S+ pre-check branch
// that the production code in scheduleTimestampTriggerNotification guards against.
@Config(sdk = 34)
public class NotifeeAlarmManagerSetAlarmClockTest {

  /** A trigger timestamp comfortably in the future so {@code setNextTimestamp} is a no-op. */
  private static final long FUTURE_OFFSET_MS = 60_000L;

  private MockedStatic<AlarmUtils> alarmUtilsMock;
  private AlarmManager mockAlarmManager;

  @Before
  public void setUp() {
    // NotificationPendingIntent.createIntent, getAlarmManagerIntentForNotification, and the
    // trigger-rescheduling path all call ContextHolder.getApplicationContext(). Robolectric's
    // application context exposes a real PackageManager so the launch-intent fallback inside
    // NotificationPendingIntent.createLaunchActivityIntent succeeds without mocking.
    ContextHolder.setApplicationContext(RuntimeEnvironment.getApplication());

    mockAlarmManager = mock(AlarmManager.class);
    // Skip the Android S+ pre-check — we explicitly want the switch to reach the SET_ALARM_CLOCK
    // branch. If canScheduleExactAlarms() returned Mockito's default (false), the pre-check would
    // fall back to setAndAllowWhileIdle before the switch and the tests would never exercise the
    // production path under scrutiny.
    when(mockAlarmManager.canScheduleExactAlarms()).thenReturn(true);

    alarmUtilsMock = mockStatic(AlarmUtils.class);
    alarmUtilsMock.when(AlarmUtils::getAlarmManager).thenReturn(mockAlarmManager);
  }

  @After
  public void tearDown() {
    if (alarmUtilsMock != null) {
      alarmUtilsMock.close();
    }
  }

  // ─── Test 1: Happy path — setAlarmClock called with a non-null show intent ──

  @Test
  public void setAlarmClock_happyPath_usesAlarmClockInfoWithShowIntent() {
    NotificationModel model = buildModel("happy-path");
    TimestampTriggerModel trigger = buildSetAlarmClockTrigger();

    NotifeeAlarmManager.scheduleTimestampTriggerNotification(model, trigger);

    ArgumentCaptor<AlarmManager.AlarmClockInfo> infoCaptor =
        ArgumentCaptor.forClass(AlarmManager.AlarmClockInfo.class);
    ArgumentCaptor<PendingIntent> operationCaptor = ArgumentCaptor.forClass(PendingIntent.class);
    verify(mockAlarmManager, times(1))
        .setAlarmClock(infoCaptor.capture(), operationCaptor.capture());

    AlarmManager.AlarmClockInfo info = infoCaptor.getValue();
    assertNotNull("AlarmClockInfo must be non-null", info);
    assertNotNull(
        "AlarmClockInfo.showIntent must be non-null — AlarmManager requires a tap target for"
            + " the status-bar alarm-clock icon",
        info.getShowIntent());
    assertNotNull(
        "operation PendingIntent (alarm fire target) must be non-null", operationCaptor.getValue());

    // The happy path must never touch the inexact fallback.
    verify(mockAlarmManager, never())
        .setAndAllowWhileIdle(anyInt(), anyLong(), any(PendingIntent.class));
  }

  // ─── Test 2: SecurityException → fallback to setAndAllowWhileIdle ──────────

  @Test
  public void setAlarmClock_securityException_fallsBackToInexact() {
    // canScheduleExactAlarms() can race with permission revocation on Android 12+: the pre-check
    // passes, but the subsequent setAlarmClock call still throws. The production code's
    // try/catch inside scheduleTimestampTriggerNotification must route that throw to
    // setAndAllowWhileIdle so the notification degrades gracefully instead of disappearing.
    doThrow(new SecurityException("synthetic SCHEDULE_EXACT_ALARM denied at fire time"))
        .when(mockAlarmManager)
        .setAlarmClock(any(AlarmManager.AlarmClockInfo.class), any(PendingIntent.class));

    NotificationModel model = buildModel("security-exception");
    TimestampTriggerModel trigger = buildSetAlarmClockTrigger();

    NotifeeAlarmManager.scheduleTimestampTriggerNotification(model, trigger);

    // Primary attempt happened.
    verify(mockAlarmManager, times(1))
        .setAlarmClock(any(AlarmManager.AlarmClockInfo.class), any(PendingIntent.class));
    // Fallback fired with RTC_WAKEUP — matches the other AlarmType branches' wake semantics.
    verify(mockAlarmManager, times(1))
        .setAndAllowWhileIdle(eq(AlarmManager.RTC_WAKEUP), anyLong(), any(PendingIntent.class));
  }

  // ─── Test 3: show-intent reuses the pressAction path (refactor guard) ─────

  @Test
  public void setAlarmClock_showIntentReusesPressActionPath() {
    // Case 1: notification has no pressAction at all (e.g. rehydrated from Room after app kill).
    // buildShowIntentPressActionBundle must synthesize the default so the status-bar icon opens
    // the app via the same route as a normal tap.
    Bundle absent = NotifeeAlarmManager.buildShowIntentPressActionBundle(buildModel("absent"));
    assertNotNull("default pressAction must be synthesized when absent", absent);
    assertEquals("default", absent.getString("id"));
    assertEquals("default", absent.getString("launchActivity"));

    // Case 2: notification was built with pressAction:null in JS, which surfaces in the native
    // layer as PRESS_ACTION_OPT_OUT_ID. Unlike the content intent (where null means "non-tappable
    // notification"), AlarmClockInfo demands a non-null show intent, so the helper must still
    // synthesize the default instead of returning null and crashing the schedule call.
    Bundle optOut =
        NotifeeAlarmManager.buildShowIntentPressActionBundle(
            buildModelWithPressAction(
                "opt-out", NotificationPendingIntent.PRESS_ACTION_OPT_OUT_ID, null));
    assertNotNull("default pressAction must be synthesized on opt-out sentinel", optOut);
    assertEquals("default", optOut.getString("id"));
    assertEquals("default", optOut.getString("launchActivity"));

    // Case 3: a real custom pressAction must pass through untouched so custom launchActivity
    // routing reaches NotificationPendingIntent.createLaunchActivityIntent.
    Bundle custom =
        NotifeeAlarmManager.buildShowIntentPressActionBundle(
            buildModelWithPressAction("custom", "my-action", "com.example.CustomActivity"));
    assertNotNull("custom pressAction must pass through", custom);
    assertEquals("my-action", custom.getString("id"));
    assertEquals("com.example.CustomActivity", custom.getString("launchActivity"));
  }

  // ─── Builders ──────────────────────────────────────────────────────────────

  private static NotificationModel buildModel(String id) {
    Bundle notificationBundle = new Bundle();
    notificationBundle.putString("id", id);
    notificationBundle.putString("title", "SetAlarmClockTest " + id);

    Bundle androidBundle = new Bundle();
    androidBundle.putString("channelId", "set-alarm-clock-test-channel");
    notificationBundle.putBundle("android", androidBundle);

    return NotificationModel.fromBundle(notificationBundle);
  }

  private static NotificationModel buildModelWithPressAction(
      String id, String pressActionId, String launchActivity) {
    Bundle notificationBundle = new Bundle();
    notificationBundle.putString("id", id);
    notificationBundle.putString("title", "SetAlarmClockTest " + id);

    Bundle androidBundle = new Bundle();
    androidBundle.putString("channelId", "set-alarm-clock-test-channel");

    Bundle pressAction = new Bundle();
    pressAction.putString("id", pressActionId);
    if (launchActivity != null) {
      pressAction.putString("launchActivity", launchActivity);
    }
    androidBundle.putBundle("pressAction", pressAction);

    notificationBundle.putBundle("android", androidBundle);

    return NotificationModel.fromBundle(notificationBundle);
  }

  private static TimestampTriggerModel buildSetAlarmClockTrigger() {
    Bundle triggerBundle = new Bundle();
    triggerBundle.putInt("type", 0); // TIMESTAMP
    triggerBundle.putLong("timestamp", System.currentTimeMillis() + FUTURE_OFFSET_MS);
    triggerBundle.putInt("repeatFrequency", -1); // non-repeating

    Bundle alarmManagerBundle = new Bundle();
    alarmManagerBundle.putInt("type", 4); // SET_ALARM_CLOCK (TimestampTriggerModel switch case 4)
    triggerBundle.putBundle("alarmManager", alarmManagerBundle);

    return TimestampTriggerModel.fromBundle(triggerBundle);
  }
}
