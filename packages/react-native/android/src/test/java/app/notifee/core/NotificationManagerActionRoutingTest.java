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

import static app.notifee.core.NotificationPendingIntent.EVENT_TYPE_INTENT_KEY;
import static app.notifee.core.event.NotificationEvent.TYPE_ACTION_PRESS;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.Bundle;
import app.notifee.core.event.MainComponentEvent;
import app.notifee.core.model.NotificationModel;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.ArrayList;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowNotificationManager;
import org.robolectric.shadows.ShadowPackageManager;
import org.robolectric.shadows.ShadowPendingIntent;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class NotificationManagerActionRoutingTest {
  private static final String CHANNEL_ID = "action-routing-test-channel";

  private Context context;

  @Before
  public void setUp() {
    context = RuntimeEnvironment.getApplication();
    ContextHolder.setApplicationContext(context);
    setTargetSdk(Build.VERSION_CODES.S);
    ShadowPendingIntent.reset();
    EventBus.removeStickEvent(MainComponentEvent.class);

    Shadows.shadowOf(RuntimeEnvironment.getApplication())
        .grantPermissions(Manifest.permission.POST_NOTIFICATIONS);
    registerDefaultLaunchActivity();
    createChannel();

    android.app.NotificationManager notificationManager =
        (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    notificationManager.cancelAll();
  }

  @After
  public void tearDown() {
    EventBus.removeStickEvent(MainComponentEvent.class);
    ShadowPendingIntent.reset();
  }

  @Test
  public void displayNotification_android12PlusNoLaunchAction_routesToReceiverService()
      throws Exception {
    ShadowPendingIntent shadowPendingIntent =
        actionPendingIntent(
            displayNotification(
                buildNotificationModel(
                    "android12-no-launch", buildPressAction("decline", null, null))));

    assertReceiverServiceActionIntent(shadowPendingIntent, "decline", null, null);
  }

  @Test
  public void displayNotification_android12PlusLaunchActivityAction_routesToLaunchActivity()
      throws Exception {
    ShadowPendingIntent shadowPendingIntent =
        actionPendingIntent(
            displayNotification(
                buildNotificationModel(
                    "android12-launch-activity",
                    buildPressAction("answer", ExplicitLaunchActivity.class.getName(), null))));

    assertLaunchActivityActionIntent(
        shadowPendingIntent,
        ExplicitLaunchActivity.class,
        "answer",
        ExplicitLaunchActivity.class.getName(),
        null);
  }

  @Test
  public void displayNotification_android12PlusMainComponentAction_routesToLaunchActivity()
      throws Exception {
    ShadowPendingIntent shadowPendingIntent =
        actionPendingIntent(
            displayNotification(
                buildNotificationModel(
                    "android12-main-component",
                    buildPressAction("open-main", null, "CustomMainComponent"))));

    assertLaunchActivityActionIntent(
        shadowPendingIntent, DefaultLaunchActivity.class, "open-main", null, "CustomMainComponent");
  }

  @Test
  public void displayNotification_android12PlusDefaultActionId_routesToLaunchActivity()
      throws Exception {
    ShadowPendingIntent shadowPendingIntent =
        actionPendingIntent(
            displayNotification(
                buildNotificationModel(
                    "android12-default-action", buildPressAction("default", null, null))));

    assertLaunchActivityActionIntent(
        shadowPendingIntent, DefaultLaunchActivity.class, "default", null, null);
  }

  @Test
  @Config(sdk = 30)
  public void displayNotification_preAndroid12LaunchActivityAction_keepsReceiverServiceRoute()
      throws Exception {
    setTargetSdk(Build.VERSION_CODES.S);

    ShadowPendingIntent shadowPendingIntent =
        actionPendingIntent(
            displayNotification(
                buildNotificationModel(
                    "pre-android12-launch-activity",
                    buildPressAction("answer", ExplicitLaunchActivity.class.getName(), null))));

    assertReceiverServiceActionIntent(
        shadowPendingIntent, "answer", ExplicitLaunchActivity.class.getName(), null);
  }

  @Test
  public void displayNotification_targetBelow31LaunchActivityAction_keepsReceiverServiceRoute()
      throws Exception {
    setTargetSdk(Build.VERSION_CODES.R);

    ShadowPendingIntent shadowPendingIntent =
        actionPendingIntent(
            displayNotification(
                buildNotificationModel(
                    "target-below31-launch-activity",
                    buildPressAction("answer", ExplicitLaunchActivity.class.getName(), null))));

    assertReceiverServiceActionIntent(
        shadowPendingIntent, "answer", ExplicitLaunchActivity.class.getName(), null);
  }

  private Notification displayNotification(NotificationModel notificationModel) throws Exception {
    ListenableFuture<Void> future =
        NotificationManager.displayNotification(notificationModel, null);
    future.get(5, TimeUnit.SECONDS);

    android.app.NotificationManager notificationManager =
        (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    ShadowNotificationManager shadowNotificationManager = Shadows.shadowOf(notificationManager);
    Notification notification =
        shadowNotificationManager.getNotification(notificationModel.getHashCode());
    assertNotNull("notification must be posted", notification);
    return notification;
  }

  private static ShadowPendingIntent actionPendingIntent(Notification notification) {
    assertNotNull("action array must be present", notification.actions);
    assertEquals("one action must be built", 1, notification.actions.length);

    PendingIntent pendingIntent = notification.actions[0].actionIntent;
    assertNotNull("action PendingIntent must be present", pendingIntent);
    return Shadows.shadowOf(pendingIntent);
  }

  private static void assertReceiverServiceActionIntent(
      ShadowPendingIntent shadowPendingIntent,
      String id,
      String launchActivity,
      String mainComponent) {
    assertTrue("action PendingIntent must target ReceiverService", shadowPendingIntent.isService());

    Intent intent = shadowPendingIntent.getSavedIntent();
    assertNotNull("service intent must be saved", intent);
    assertEquals(ReceiverService.ACTION_PRESS_INTENT, intent.getAction());
    assertEquals(ReceiverService.class.getName(), intent.getComponent().getClassName());
    assertPressAction(intent.getBundleExtra("pressAction"), id, launchActivity, mainComponent);
  }

  private static void assertLaunchActivityActionIntent(
      ShadowPendingIntent shadowPendingIntent,
      Class<? extends Activity> launchActivityClass,
      String id,
      String launchActivity,
      String mainComponent) {
    assertTrue(
        "action PendingIntent must use the launch-activity path", shadowPendingIntent.isActivity());

    Intent[] intents = shadowPendingIntent.getSavedIntents();
    assertNotNull("activity intent stack must be saved", intents);
    assertEquals("launch path must include app launch and receiver activity", 2, intents.length);
    assertEquals(launchActivityClass.getName(), intents[0].getComponent().getClassName());
    assertEquals(
        NotificationReceiverActivity.class.getName(), intents[1].getComponent().getClassName());
    assertEquals(TYPE_ACTION_PRESS, intents[1].getIntExtra(EVENT_TYPE_INTENT_KEY, -1));
    assertPressAction(intents[1].getBundleExtra("pressAction"), id, launchActivity, mainComponent);
  }

  private static void assertPressAction(
      Bundle pressAction, String id, String launchActivity, String mainComponent) {
    assertNotNull("pressAction extras must be present", pressAction);
    assertEquals(id, pressAction.getString("id"));
    assertEquals(launchActivity, pressAction.getString("launchActivity"));
    assertEquals(mainComponent, pressAction.getString("mainComponent"));
  }

  private void registerDefaultLaunchActivity() {
    Intent launcherIntent = new Intent(Intent.ACTION_MAIN);
    launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER);
    launcherIntent.setPackage(context.getPackageName());

    ResolveInfo resolveInfo = new ResolveInfo();
    resolveInfo.activityInfo = new ActivityInfo();
    resolveInfo.activityInfo.packageName = context.getPackageName();
    resolveInfo.activityInfo.name = DefaultLaunchActivity.class.getName();

    ShadowPackageManager shadowPackageManager = Shadows.shadowOf(context.getPackageManager());
    shadowPackageManager.addActivityIfNotPresent(
        new ComponentName(context.getPackageName(), DefaultLaunchActivity.class.getName()));
    shadowPackageManager.addResolveInfoForIntent(launcherIntent, resolveInfo);
  }

  private void createChannel() {
    android.app.NotificationManager notificationManager =
        (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (notificationManager.getNotificationChannel(CHANNEL_ID) == null) {
      NotificationChannel channel =
          new NotificationChannel(
              CHANNEL_ID, "Action routing test", android.app.NotificationManager.IMPORTANCE_LOW);
      notificationManager.createNotificationChannel(channel);
    }
  }

  private static void setTargetSdk(int targetSdk) {
    RuntimeEnvironment.getApplication().getApplicationInfo().targetSdkVersion = targetSdk;
  }

  private static NotificationModel buildNotificationModel(String id, Bundle pressAction) {
    Bundle notificationBundle = new Bundle();
    notificationBundle.putString("id", id);
    notificationBundle.putString("title", "Action routing " + id);
    notificationBundle.putString("body", "Body " + id);

    Bundle androidBundle = new Bundle();
    androidBundle.putString("channelId", CHANNEL_ID);

    Bundle action = new Bundle();
    action.putString("title", "Action " + pressAction.getString("id"));
    action.putBundle("pressAction", pressAction);
    ArrayList<Bundle> actions = new ArrayList<>();
    actions.add(action);
    androidBundle.putParcelableArrayList("actions", actions);

    notificationBundle.putBundle("android", androidBundle);
    return NotificationModel.fromBundle(notificationBundle);
  }

  private static Bundle buildPressAction(String id, String launchActivity, String mainComponent) {
    Bundle pressAction = new Bundle();
    pressAction.putString("id", id);
    if (launchActivity != null) {
      pressAction.putString("launchActivity", launchActivity);
    }
    if (mainComponent != null) {
      pressAction.putString("mainComponent", mainComponent);
    }
    return pressAction;
  }

  public static class DefaultLaunchActivity extends Activity {}

  public static class ExplicitLaunchActivity extends Activity {}
}
