package app.notifee.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import app.notifee.core.event.InitialNotificationEvent;
import app.notifee.core.event.MainComponentEvent;
import app.notifee.core.event.NotificationEvent;
import java.util.ArrayList;
import java.util.List;
import org.greenrobot.eventbus.Subscribe;
import org.greenrobot.eventbus.ThreadMode;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ReceiverServiceInitialNotificationTest {

  private NotificationEventCapture capture;
  private ReceiverService service;
  private ServiceController<ReceiverService> serviceController;

  @Before
  public void setUp() {
    Context context = RuntimeEnvironment.getApplication();
    ContextHolder.setApplicationContext(context);
    clearStickyEvents();
    capture = new NotificationEventCapture();
    EventBus.register(capture);
    serviceController = Robolectric.buildService(ReceiverService.class).create();
    service = serviceController.get();
  }

  @After
  public void tearDown() {
    EventBus.unregister(capture);
    serviceController.destroy();
    clearStickyEvents();
  }

  @Test
  public void onActionPressIntent_withoutLaunch_preservesCurrentNoInitialNotificationBehavior() {
    Intent intent =
        buildServiceIntent(
            buildNotificationBundle("service-action-no-launch"),
            buildPressActionBundle("reply", null, null));

    service.onStartCommand(intent, 0, 1);

    assertEquals("one NotificationEvent should be posted", 1, capture.events.size());
    NotificationEvent event = capture.events.get(0);
    assertEquals(NotificationEvent.TYPE_ACTION_PRESS, event.getType());
    assertEquals("service-action-no-launch", event.getNotification().getId());
    assertNotNull("ACTION_PRESS extras should be preserved", event.getExtras());
    assertPressAction(event.getExtras(), "reply", null, null);

    assertNull(
        "pre-Android 12 ReceiverService currently does not post InitialNotificationEvent for"
            + " no-launch ACTION_PRESS",
        EventBus.getStickyEvent(InitialNotificationEvent.class));
  }

  @Test
  public void onActionPressIntent_withLaunch_postsInitialNotificationAfterPendingIntentSend() {
    Intent intent =
        buildServiceIntent(
            buildNotificationBundle("service-action-launch"),
            buildPressActionBundle(
                "reply-launch", TestLaunchActivity.class.getName(), "ServiceMainComponent"));

    service.onStartCommand(intent, 0, 1);

    assertEquals("one NotificationEvent should be posted", 1, capture.events.size());
    NotificationEvent event = capture.events.get(0);
    assertEquals(NotificationEvent.TYPE_ACTION_PRESS, event.getType());
    assertEquals("service-action-launch", event.getNotification().getId());
    assertNotNull("ACTION_PRESS extras should be preserved", event.getExtras());
    assertPressAction(
        event.getExtras(),
        "reply-launch",
        TestLaunchActivity.class.getName(),
        "ServiceMainComponent");

    InitialNotificationEvent initialNotificationEvent =
        EventBus.getStickyEvent(InitialNotificationEvent.class);
    assertNotNull(
        "pre-Android 12 ReceiverService currently posts InitialNotificationEvent when ACTION_PRESS"
            + " launches an activity",
        initialNotificationEvent);
    assertEquals("service-action-launch", initialNotificationEvent.getNotificationModel().getId());
    assertPressAction(
        initialNotificationEvent.getExtras(),
        "reply-launch",
        TestLaunchActivity.class.getName(),
        "ServiceMainComponent");
  }

  private static Intent buildServiceIntent(Bundle notificationBundle, Bundle pressActionBundle) {
    Intent intent = new Intent(RuntimeEnvironment.getApplication(), ReceiverService.class);
    intent.setAction(ReceiverService.ACTION_PRESS_INTENT);
    intent.putExtra("notification", notificationBundle);
    intent.putExtra("pressAction", pressActionBundle);
    return intent;
  }

  private static Bundle buildNotificationBundle(String id) {
    Bundle notificationBundle = new Bundle();
    notificationBundle.putString("id", id);
    notificationBundle.putString("title", "ReceiverService test " + id);
    notificationBundle.putString("body", "Body " + id);

    Bundle androidBundle = new Bundle();
    androidBundle.putString("channelId", "receiver-service-initial-test-channel");
    androidBundle.putBoolean("autoCancel", false);
    notificationBundle.putBundle("android", androidBundle);
    return notificationBundle;
  }

  private static Bundle buildPressActionBundle(
      String id, String launchActivity, String mainComponent) {
    Bundle pressActionBundle = new Bundle();
    pressActionBundle.putString("id", id);
    if (launchActivity != null) {
      pressActionBundle.putString("launchActivity", launchActivity);
    }
    if (mainComponent != null) {
      pressActionBundle.putString("mainComponent", mainComponent);
    }
    return pressActionBundle;
  }

  private static void assertPressAction(
      Bundle extras, String id, String launchActivity, String mainComponent) {
    Bundle pressAction = extras.getBundle("pressAction");
    assertNotNull("pressAction should be present", pressAction);
    assertEquals(id, pressAction.getString("id"));
    assertEquals(launchActivity, pressAction.getString("launchActivity"));
    assertEquals(mainComponent, pressAction.getString("mainComponent"));
  }

  private static void clearStickyEvents() {
    EventBus.removeStickEvent(InitialNotificationEvent.class);
    EventBus.removeStickEvent(MainComponentEvent.class);
  }

  public static class TestLaunchActivity extends Activity {}

  public static class NotificationEventCapture {
    final List<NotificationEvent> events = new ArrayList<>();

    @Subscribe(threadMode = ThreadMode.POSTING)
    public void onNotificationEvent(NotificationEvent event) {
      events.add(event);
    }
  }
}
