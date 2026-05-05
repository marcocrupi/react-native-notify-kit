package app.notifee.core;

import static app.notifee.core.NotificationPendingIntent.EVENT_TYPE_INTENT_KEY;
import static app.notifee.core.NotificationPendingIntent.NOTIFICATION_ID_INTENT_KEY;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

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
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class NotificationReceiverHandlerInitialNotificationTest {

  private NotificationEventCapture capture;
  private Context context;

  @Before
  public void setUp() {
    context = RuntimeEnvironment.getApplication();
    ContextHolder.setApplicationContext(context);
    clearStickyEvents();
    capture = new NotificationEventCapture();
    EventBus.register(capture);
  }

  @After
  public void tearDown() {
    EventBus.unregister(capture);
    clearStickyEvents();
  }

  @Test
  public void handleNotification_typePress_postsNotificationEventAndInitialNotification() {
    Intent intent =
        buildHandlerIntent(
            NotificationEvent.TYPE_PRESS,
            buildNotificationBundle("handler-press"),
            buildPressActionBundle("default", "default", "HandlerMainComponent"));

    NotificationReceiverHandler.handleNotification(context, intent);

    assertEquals("one NotificationEvent should be posted", 1, capture.events.size());
    NotificationEvent event = capture.events.get(0);
    assertEquals(NotificationEvent.TYPE_PRESS, event.getType());
    assertEquals("handler-press", event.getNotification().getId());
    assertNotNull("PRESS extras should be preserved", event.getExtras());
    assertPressAction(event.getExtras(), "default", "default", "HandlerMainComponent");

    InitialNotificationEvent initialNotificationEvent =
        EventBus.getStickyEvent(InitialNotificationEvent.class);
    assertNotNull("TYPE_PRESS should post InitialNotificationEvent", initialNotificationEvent);
    assertEquals("handler-press", initialNotificationEvent.getNotificationModel().getId());
    assertPressAction(
        initialNotificationEvent.getExtras(), "default", "default", "HandlerMainComponent");
  }

  @Test
  public void handleNotification_typeActionPressWithoutLaunch_postsCurrentInitialNotification() {
    Intent intent =
        buildHandlerIntent(
            NotificationEvent.TYPE_ACTION_PRESS,
            buildNotificationBundle("handler-action-no-launch"),
            buildPressActionBundle("reply", null, null));

    NotificationReceiverHandler.handleNotification(context, intent);

    assertEquals("one NotificationEvent should be posted", 1, capture.events.size());
    NotificationEvent event = capture.events.get(0);
    assertEquals(NotificationEvent.TYPE_ACTION_PRESS, event.getType());
    assertEquals("handler-action-no-launch", event.getNotification().getId());
    assertNotNull("ACTION_PRESS extras should be preserved", event.getExtras());
    assertPressAction(event.getExtras(), "reply", null, null);

    InitialNotificationEvent initialNotificationEvent =
        EventBus.getStickyEvent(InitialNotificationEvent.class);
    assertNotNull(
        "Android 12+ handler currently posts InitialNotificationEvent for no-launch ACTION_PRESS",
        initialNotificationEvent);
    assertEquals("handler-action-no-launch", initialNotificationEvent.getNotificationModel().getId());
    assertPressAction(initialNotificationEvent.getExtras(), "reply", null, null);
  }

  private static Intent buildHandlerIntent(
      int type, Bundle notificationBundle, Bundle pressActionBundle) {
    Intent intent = new Intent();
    intent.putExtra(EVENT_TYPE_INTENT_KEY, type);
    intent.putExtra(NOTIFICATION_ID_INTENT_KEY, notificationBundle.getString("id").hashCode());
    intent.putExtra("notification", notificationBundle);
    intent.putExtra("pressAction", pressActionBundle);
    return intent;
  }

  private static Bundle buildNotificationBundle(String id) {
    Bundle notificationBundle = new Bundle();
    notificationBundle.putString("id", id);
    notificationBundle.putString("title", "Handler test " + id);
    notificationBundle.putString("body", "Body " + id);

    Bundle androidBundle = new Bundle();
    androidBundle.putString("channelId", "handler-initial-test-channel");
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

  public static class NotificationEventCapture {
    final List<NotificationEvent> events = new ArrayList<>();

    @Subscribe(threadMode = ThreadMode.POSTING)
    public void onNotificationEvent(NotificationEvent event) {
      events.add(event);
    }
  }
}
