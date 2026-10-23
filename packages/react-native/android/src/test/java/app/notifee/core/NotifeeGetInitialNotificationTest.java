package app.notifee.core;

import static app.notifee.core.NotificationPendingIntent.EVENT_TYPE_INTENT_KEY;
import static app.notifee.core.NotificationPendingIntent.PENDING_INTENT_ID_INTENT_KEY;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.Bundle;
import app.notifee.core.event.InitialNotificationEvent;
import app.notifee.core.event.MainComponentEvent;
import app.notifee.core.model.NotificationModel;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.File;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContextImpl;
import org.robolectric.shadows.ShadowNotificationManager;
import org.robolectric.shadows.ShadowPackageManager;
import org.robolectric.shadows.ShadowPausedSystemClock;
import org.robolectric.shadows.ShadowPendingIntent;
import org.robolectric.shadows.ShadowSystemClock;

/**
 * Behavioral tests for {@link Notifee#getInitialNotification} one-shot consumption (#88).
 *
 * <p>Interactions are produced by the production display path ({@link
 * NotificationManager#displayNotification}) and the intents saved in the resulting PendingIntents.
 * A tap is simulated the way the system delivers it on Android 12+: {@link
 * NotificationReceiverActivity}, on top of the PendingIntent stack, runs first and posts the sticky
 * event; the launch Activity then receives its own copy of the launch Intent.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class NotifeeGetInitialNotificationTest {
  private static final String CHANNEL_ID = "initial-notification-consumption-test-channel";
  // More later interactions than a short record of claimed ids would hold.
  private static final int LATER_INTERACTIONS = 40;

  private Context context;

  @Before
  public void setUp() {
    context = RuntimeEnvironment.getApplication();
    ContextHolder.setApplicationContext(context);
    setTargetSdk(Build.VERSION_CODES.S);
    ShadowPendingIntent.reset();
    clearStickyEvents();
    // Each test starts as a fresh app process with fresh app storage.
    Notifee.resetInitialNotificationStateForTesting();
    InitialNotificationLedger.clearForTesting();

    Shadows.shadowOf(RuntimeEnvironment.getApplication())
        .grantPermissions(Manifest.permission.POST_NOTIFICATIONS);
    registerDefaultLaunchActivity();
    createChannel();
    nativeNotificationManager().cancelAll();
  }

  @After
  public void tearDown() {
    clearStickyEvents();
    Notifee.resetInitialNotificationStateForTesting();
    InitialNotificationLedger.clearForTesting();
    ShadowPendingIntent.reset();
  }

  // --- C1: one-shot consumption ---

  @Test
  public void stickyEventAndLaunchIntentOfSameTap_areReturnedOnce() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);

    Activity activity = launch(DefaultLaunchActivity.class, tap(flowA)).get();

    assertInitialNotification(getInitialNotification(activity), "A", "default");
    assertNull(getInitialNotification(activity));
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void launchIntentOfUnrecordedTap_isNotAnInteractionOnItsOwn() throws Exception {
    // A launch Intent whose tap the receiver never recorded is indistinguishable from one read
    // before its sticky event (W1); the tap is returned by its event. A tap whose event was lost
    // with its process is covered by tapNotConsumedBeforeProcessDeath_*.
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);

    Activity activity = launch(DefaultLaunchActivity.class, new Intent(flowA[0])).get();

    assertNull(getInitialNotification(activity));
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void consumption_leavesActivityIntentExtrasIntact() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Activity activity = launch(DefaultLaunchActivity.class, tap(flowA)).get();

    assertInitialNotification(getInitialNotification(activity), "A", "default");
    assertNull(getInitialNotification(activity));

    Intent intent = activity.getIntent();
    assertEquals("A", intent.getBundleExtra("notification").getString("id"));
    assertTrue(intent.hasExtra(EVENT_TYPE_INTENT_KEY));
    assertTrue(intent.hasExtra(NotificationPendingIntent.NOTIFICATION_ID_INTENT_KEY));
    assertNotNull(intent.getStringExtra(PENDING_INTENT_ID_INTENT_KEY));
    assertNotNull(intent.getBundleExtra("pressAction"));
  }

  // --- C2/C3: issue #88 and later interactions ---

  @Test
  public void issue88_laterTapThroughOnNewIntent_doesNotReplayColdStartNotification()
      throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Intent[] flowB = launchFlow(display(pressNotification("B")).contentIntent);

    // Cold start from A.
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, tap(flowA));
    Activity activity = controller.get();
    assertInitialNotification(getInitialNotification(activity), "A", "default");
    // Back through Recents.
    assertNull(getInitialNotification(activity));

    // Tap B from the background: delivered through onNewIntent, getIntent() still holds A.
    controller.newIntent(tap(flowB));
    assertEquals("A", activity.getIntent().getBundleExtra("notification").getString("id"));
    assertInitialNotification(getInitialNotification(activity), "B", "default");
    // Back through Recents: A must not be returned again.
    assertNull(getInitialNotification(activity));
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void laterTapCreatingNewActivityInstance_isReturnedOnce() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Intent[] flowB = launchFlow(display(pressNotification("B")).contentIntent);
    Activity first = launch(DefaultLaunchActivity.class, tap(flowA)).get();
    assertInitialNotification(getInitialNotification(first), "A", "default");

    Activity second = launch(DefaultLaunchActivity.class, tap(flowB)).get();

    assertInitialNotification(getInitialNotification(second), "B", "default");
    assertNull(getInitialNotification(second));
    assertNull(getInitialNotification(first));
  }

  @Test
  public void laterTapDeliveredThroughSetIntent_isReturnedOnce() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Intent[] flowB = launchFlow(display(pressNotification("B")).contentIntent);
    ActivityController<SetIntentLaunchActivity> controller =
        launch(SetIntentLaunchActivity.class, tap(flowA));
    Activity activity = controller.get();
    assertInitialNotification(getInitialNotification(activity), "A", "default");
    assertNull(getInitialNotification(activity));

    controller.newIntent(tap(flowB));
    assertEquals("B", activity.getIntent().getBundleExtra("notification").getString("id"));

    assertInitialNotification(getInitialNotification(activity), "B", "default");
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void relaunchFromRecentsInSameProcess_doesNotReplayConsumedNotification()
      throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, tap(flowA));
    assertInitialNotification(getInitialNotification(controller.get()), "A", "default");
    controller.pause().stop().destroy();

    // The task root was finished; Recents starts a new instance with a new copy of the task's
    // base Intent while the process is still alive.
    Intent fromRecents = new Intent(flowA[0]).addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY);
    Activity relaunched = launch(DefaultLaunchActivity.class, fromRecents).get();

    assertNull(getInitialNotification(relaunched));
  }

  @Test
  public void retapOfSameNotification_isANewValidInteraction() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, tap(flowA));
    Activity activity = controller.get();
    assertInitialNotification(getInitialNotification(activity), "A", "default");
    assertNull(getInitialNotification(activity));

    // Same PendingIntent tapped again (autoCancel disabled).
    controller.newIntent(tap(flowA));

    assertInitialNotification(getInitialNotification(activity), "A", "default");
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void redisplayedNotificationWithSameId_isANewValidInteraction() throws Exception {
    Intent[] firstFlow = launchFlow(display(pressNotification("A")).contentIntent);
    ActivityController<SetIntentLaunchActivity> controller =
        launch(SetIntentLaunchActivity.class, tap(firstFlow));
    Activity activity = controller.get();
    assertInitialNotification(getInitialNotification(activity), "A", "default");
    assertNull(getInitialNotification(activity));

    Intent[] secondFlow = launchFlow(display(pressNotification("A")).contentIntent);
    controller.newIntent(tap(secondFlow));

    assertInitialNotification(getInitialNotification(activity), "A", "default");
    assertNull(getInitialNotification(activity));
  }

  // --- C3: source availability order and concurrency ---

  @Test
  public void launchIntentObservedBeforeItsStickyEvent_isReturnedOnce() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Intent[] flowB = launchFlow(display(pressNotification("B")).contentIntent);
    ActivityController<SetIntentLaunchActivity> controller =
        launch(SetIntentLaunchActivity.class, tap(flowA));
    Activity activity = controller.get();
    assertInitialNotification(getInitialNotification(activity), "A", "default");

    // B reaches the (resumed) launch Activity before NotificationReceiverActivity posts B.
    controller.newIntent(new Intent(flowB[0]));
    assertNull(getInitialNotification(activity));
    runReceiver(flowB);

    assertInitialNotification(getInitialNotification(activity), "B", "default");
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void stickyEventConsumedBeforeLaunchIntentArrives_isReturnedOnce() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Intent[] flowB = launchFlow(display(pressNotification("B")).contentIntent);
    ActivityController<SetIntentLaunchActivity> controller =
        launch(SetIntentLaunchActivity.class, tap(flowA));
    Activity activity = controller.get();
    assertInitialNotification(getInitialNotification(activity), "A", "default");

    runReceiver(flowB);
    assertInitialNotification(getInitialNotification(activity), "B", "default");
    controller.newIntent(new Intent(flowB[0]));

    assertNull(getInitialNotification(activity));
  }

  @Test
  public void concurrentCalls_returnTheInteractionExactlyOnce() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Activity activity = launch(DefaultLaunchActivity.class, tap(flowA)).get();

    int callers = 8;
    CyclicBarrier start = new CyclicBarrier(callers);
    ExecutorService executor = Executors.newFixedThreadPool(callers);
    try {
      List<Future<Bundle>> results = new ArrayList<>();
      for (int i = 0; i < callers; i++) {
        results.add(
            executor.submit(
                () -> {
                  start.await(5, TimeUnit.SECONDS);
                  return getInitialNotification(activity);
                }));
      }

      List<Bundle> delivered = new ArrayList<>();
      for (Future<Bundle> result : results) {
        Bundle bundle = result.get(5, TimeUnit.SECONDS);
        if (bundle != null) {
          delivered.add(bundle);
        }
      }
      assertEquals("exactly one concurrent caller receives A", 1, delivered.size());
      assertInitialNotification(delivered.get(0), "A", "default");
    } finally {
      executor.shutdownNow();
    }
    assertNull(getInitialNotification(activity));
  }

  // --- W1: Intent observed before its sticky event in a process with no consumed sticky ---

  @Test
  public void w1_laterTapDeliveredThroughSetIntentBeforeItsStickyEvent_isReturnedOnce()
      throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    ActivityController<SetIntentLaunchActivity> controller =
        launch(SetIntentLaunchActivity.class, launcherIntent());
    Activity activity = controller.get();
    assertNull(getInitialNotification(activity));

    // onNewIntent(A)/setIntent(A) reaches the launch Activity before the receiver posts A.
    controller.newIntent(new Intent(flowA[0]));
    List<Bundle> delivered = new ArrayList<>();
    collect(delivered, getInitialNotification(activity));
    runReceiver(flowA);
    collect(delivered, getInitialNotification(activity));
    collect(delivered, getInitialNotification(activity));

    assertDeliveredOnce(delivered, "A");
  }

  @Test
  public void w1_coldStartIntentReadBeforeItsStickyEvent_isReturnedOnce() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Activity activity = launch(DefaultLaunchActivity.class, new Intent(flowA[0])).get();

    List<Bundle> delivered = new ArrayList<>();
    collect(delivered, getInitialNotification(activity));
    runReceiver(flowA);
    collect(delivered, getInitialNotification(activity));
    collect(delivered, getInitialNotification(activity));

    assertDeliveredOnce(delivered, "A");
  }

  @Test
  public void w1_receiverRacingConsumer_deliversEveryTapExactlyOnce() throws Exception {
    Intent[] flowA = launchFlow(display(nonAutoCancelPressNotification("A")).contentIntent);
    ActivityController<SetIntentLaunchActivity> controller =
        launch(SetIntentLaunchActivity.class, launcherIntent());
    Activity activity = controller.get();
    controller.newIntent(new Intent(flowA[0]));

    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      for (int tap = 0; tap < 100; tap++) {
        CyclicBarrier start = new CyclicBarrier(2);
        Future<?> receiver =
            executor.submit(
                () -> {
                  start.await(5, TimeUnit.SECONDS);
                  NotificationReceiverHandler.handleNotification(context, new Intent(flowA[1]));
                  return null;
                });
        Future<List<Bundle>> consumer =
            executor.submit(
                () -> {
                  start.await(5, TimeUnit.SECONDS);
                  List<Bundle> results = new ArrayList<>();
                  for (int i = 0; i < 20; i++) {
                    collect(results, getInitialNotification(activity));
                  }
                  return results;
                });
        receiver.get(5, TimeUnit.SECONDS);
        List<Bundle> delivered = consumer.get(5, TimeUnit.SECONDS);
        collect(delivered, getInitialNotification(activity));
        collect(delivered, getInitialNotification(activity));

        assertEquals("tap " + tap + " must be delivered exactly once", 1, delivered.size());
        assertInitialNotification(delivered.get(0), "A", null);
      }
    } finally {
      executor.shutdownNow();
    }
  }

  // --- W2: process death and Activity restore ---

  @Test
  public void w2a_restoreWithSavedStateAfterProcessDeath_doesNotReplayConsumedTap()
      throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, tap(flowA));
    assertInitialNotification(getInitialNotification(controller.get()), "A", "default");
    Bundle savedState = moveToBackground(controller);

    simulateProcessDeath();
    Activity restored = restore(DefaultLaunchActivity.class, new Intent(flowA[0]), savedState);

    assertNull(getInitialNotification(restored));
    assertNull(getInitialNotification(restored));
  }

  @Test
  public void w2a_setIntentHostRestoredAfterProcessDeath_doesNotReplayCreationTap()
      throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Intent[] flowB = launchFlow(display(pressNotification("B")).contentIntent);
    ActivityController<SetIntentLaunchActivity> controller =
        launch(SetIntentLaunchActivity.class, tap(flowA));
    assertInitialNotification(getInitialNotification(controller.get()), "A", "default");
    controller.newIntent(tap(flowB));
    assertInitialNotification(getInitialNotification(controller.get()), "B", "default");
    Bundle savedState = moveToBackground(controller);

    simulateProcessDeath();
    // The system restores the Activity with its creation Intent, not the one set by setIntent().
    Activity restored = restore(SetIntentLaunchActivity.class, new Intent(flowA[0]), savedState);

    assertNull(getInitialNotification(restored));
  }

  @Test
  public void w2a_restoredIntentOfAnotherNotification_doesNotStandInForTheLatestTap()
      throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Intent[] flowB = launchFlow(display(pressNotification("B")).contentIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, tap(flowA));
    assertInitialNotification(getInitialNotification(controller.get()), "A", "default");
    // B is tapped while the app runs; JS handles its press event and never asks for it here.
    controller.newIntent(tap(flowB));
    Bundle savedState = moveToBackground(controller);

    simulateProcessDeath();
    Activity restored = restore(DefaultLaunchActivity.class, new Intent(flowA[0]), savedState);

    // A was returned already; B's Intent did not survive, so A's Intent cannot stand in for it.
    assertNull(getInitialNotification(restored));
  }

  @Test
  public void w2b_relaunchFromRecentsAfterProcessDeath_doesNotReplayConsumedTap() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, tap(flowA));
    assertInitialNotification(getInitialNotification(controller.get()), "A", "default");
    controller.pause().stop().destroy();

    simulateProcessDeath();
    Intent fromRecents = new Intent(flowA[0]).addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY);
    Activity relaunched = launch(DefaultLaunchActivity.class, fromRecents).get();

    assertNull(getInitialNotification(relaunched));
  }

  @Test
  public void w2c_successiveRestoresWithNewIntentObjects_neverReplayConsumedTap() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, tap(flowA));
    assertInitialNotification(getInitialNotification(controller.get()), "A", "default");

    for (int restore = 0; restore < 3; restore++) {
      Bundle savedState = moveToBackground(controller);
      simulateProcessDeath();
      controller = restoreController(DefaultLaunchActivity.class, new Intent(flowA[0]), savedState);
      assertNull("restore " + restore, getInitialNotification(controller.get()));
    }
  }

  @Test
  public void tapNotConsumedBeforeProcessDeath_isReturnedOnceAcrossRestores() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, tap(flowA));
    // The process dies before JS asks for the initial notification.
    Bundle savedState = moveToBackground(controller);

    simulateProcessDeath();
    controller = restoreController(DefaultLaunchActivity.class, new Intent(flowA[0]), savedState);
    assertInitialNotification(getInitialNotification(controller.get()), "A", null);
    assertNull(getInitialNotification(controller.get()));

    savedState = moveToBackground(controller);
    simulateProcessDeath();
    controller = restoreController(DefaultLaunchActivity.class, new Intent(flowA[0]), savedState);
    assertNull(getInitialNotification(controller.get()));
  }

  @Test
  public void tapsAfterRestore_includingSameNotification_areNewValidInteractions()
      throws Exception {
    Intent[] flowA = launchFlow(display(nonAutoCancelPressNotification("A")).contentIntent);
    Intent[] flowB = launchFlow(display(pressNotification("B")).contentIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, tap(flowA));
    assertInitialNotification(getInitialNotification(controller.get()), "A", "default");
    Bundle savedState = moveToBackground(controller);

    simulateProcessDeath();
    controller = restoreController(DefaultLaunchActivity.class, new Intent(flowA[0]), savedState);
    Activity restored = controller.get();
    assertNull(getInitialNotification(restored));

    controller.newIntent(tap(flowB));
    assertInitialNotification(getInitialNotification(restored), "B", "default");
    assertNull(getInitialNotification(restored));

    controller.newIntent(tap(flowA));
    assertInitialNotification(getInitialNotification(restored), "A", "default");
    assertNull(getInitialNotification(restored));

    Intent[] redisplayedA = launchFlow(display(pressNotification("A")).contentIntent);
    controller.newIntent(tap(redisplayedA));
    assertInitialNotification(getInitialNotification(restored), "A", "default");
    assertNull(getInitialNotification(restored));
  }

  @Test
  public void stickyEventPostedAfterItsTapWasReturnedThroughTheIntent_isDropped() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Activity activity = launch(DefaultLaunchActivity.class, launcherIntent()).get();
    activity.setIntent(new Intent(flowA[0]));

    // The receiver recorded the tap; its event is not in the sticky slot yet.
    runReceiver(flowA);
    InitialNotificationEvent eventA = EventBus.removeStickEvent(InitialNotificationEvent.class);
    assertInitialNotification(getInitialNotification(activity), "A", null);

    EventBus.postSticky(eventA);
    assertNull(getInitialNotification(activity));
    assertNull(getInitialNotification(null));
  }

  @Test
  public void concurrentCallsAfterProcessDeath_returnTheLostTapExactlyOnce() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Bundle savedState = moveToBackground(launch(DefaultLaunchActivity.class, tap(flowA)));
    simulateProcessDeath();
    Activity restored = restore(DefaultLaunchActivity.class, new Intent(flowA[0]), savedState);

    int callers = 8;
    CyclicBarrier start = new CyclicBarrier(callers);
    ExecutorService executor = Executors.newFixedThreadPool(callers);
    try {
      List<Future<Bundle>> results = new ArrayList<>();
      for (int i = 0; i < callers; i++) {
        results.add(
            executor.submit(
                () -> {
                  start.await(5, TimeUnit.SECONDS);
                  return getInitialNotification(restored);
                }));
      }
      List<Bundle> delivered = new ArrayList<>();
      for (Future<Bundle> result : results) {
        collect(delivered, result.get(5, TimeUnit.SECONDS));
      }
      assertDeliveredOnce(delivered, "A");
    } finally {
      executor.shutdownNow();
    }
  }

  @Test
  public void launchIntentWithoutPendingIntentId_isNeverReturnedFromTheIntent() throws Exception {
    // PendingIntents created before the id existed (e.g. displayed by a previous app version).
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Intent launchIntent = new Intent(flowA[0]);
    launchIntent.removeExtra(PENDING_INTENT_ID_INTENT_KEY);
    Intent receiverIntent = new Intent(flowA[1]);
    receiverIntent.removeExtra(PENDING_INTENT_ID_INTENT_KEY);

    runReceiver(receiverIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, launchIntent);
    assertInitialNotification(getInitialNotification(controller.get()), "A", "default");
    assertNull(getInitialNotification(controller.get()));

    Bundle savedState = moveToBackground(controller);
    simulateProcessDeath();
    Activity restored = restore(DefaultLaunchActivity.class, new Intent(launchIntent), savedState);
    assertNull(getInitialNotification(restored));
  }

  @Test
  public void nullActivityIntent_returnsNull() {
    Activity activity = launch(DefaultLaunchActivity.class, launcherIntent()).get();
    activity.setIntent(null);

    assertNull(getInitialNotification(activity));
  }

  @Test
  @Config(sdk = 31)
  public void api31Boundary_restoreAfterProcessDeath_doesNotReplayConsumedTap() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, tap(flowA));
    assertInitialNotification(getInitialNotification(controller.get()), "A", "default");
    Bundle savedState = moveToBackground(controller);

    simulateProcessDeath();
    Activity restored = restore(DefaultLaunchActivity.class, new Intent(flowA[0]), savedState);

    assertNull(getInitialNotification(restored));
  }

  // --- W3: Intents without the marker (full-screen) ---

  @Test
  public void w3_fullScreenActivityRecreatedWithNewIntentObject_doesNotReplay() throws Exception {
    Intent fullScreenIntent =
        savedActivityIntent(
            display(fullScreenNotification("full-screen", "FullScreenComponent")).fullScreenIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, new Intent(fullScreenIntent));
    assertInitialNotification(getInitialNotification(controller.get()), "full-screen", null);
    controller.pause().stop().destroy();

    // Same process: Recents starts a new instance with a new copy of the base Intent.
    Intent fromRecents =
        new Intent(fullScreenIntent).addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY);
    Activity relaunched = launch(DefaultLaunchActivity.class, fromRecents).get();

    assertNull(getInitialNotification(relaunched));
  }

  @Test
  public void w3_fullScreenActivityRestoredAfterProcessDeath_doesNotReplay() throws Exception {
    Intent fullScreenIntent =
        savedActivityIntent(
            display(fullScreenNotification("full-screen", "FullScreenComponent")).fullScreenIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, new Intent(fullScreenIntent));
    assertInitialNotification(getInitialNotification(controller.get()), "full-screen", null);

    for (int restore = 0; restore < 2; restore++) {
      Bundle savedState = moveToBackground(controller);
      simulateProcessDeath();
      controller =
          restoreController(DefaultLaunchActivity.class, new Intent(fullScreenIntent), savedState);
      assertNull("restore " + restore, getInitialNotification(controller.get()));
    }
  }

  @Test
  @Config(sdk = 28)
  public void api28_fullScreenActivityRestoredAfterProcessDeath_doesNotReplay() throws Exception {
    Intent fullScreenIntent =
        savedActivityIntent(
            display(fullScreenNotification("full-screen", "FullScreenComponent")).fullScreenIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, new Intent(fullScreenIntent));
    assertInitialNotification(getInitialNotification(controller.get()), "full-screen", null);
    Bundle savedState = moveToBackground(controller);

    simulateProcessDeath();
    Activity restored =
        restore(DefaultLaunchActivity.class, new Intent(fullScreenIntent), savedState);

    assertNull(getInitialNotification(restored));
  }

  @Test
  public void w3_redisplayedFullScreenNotification_isANewValidInteraction() throws Exception {
    Intent first =
        savedActivityIntent(
            display(fullScreenNotification("full-screen", "FullScreenComponent")).fullScreenIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, new Intent(first));
    assertInitialNotification(getInitialNotification(controller.get()), "full-screen", null);
    Bundle savedState = moveToBackground(controller);
    simulateProcessDeath();
    controller = restoreController(DefaultLaunchActivity.class, new Intent(first), savedState);
    assertNull(getInitialNotification(controller.get()));
    controller.pause().stop().destroy();

    // Same notification id displayed again: its full-screen launch is a new interaction.
    Intent second =
        savedActivityIntent(
            display(fullScreenNotification("full-screen", "FullScreenComponent")).fullScreenIntent);
    Activity activity = launch(DefaultLaunchActivity.class, new Intent(second)).get();

    assertInitialNotification(getInitialNotification(activity), "full-screen", null);
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void fullScreenIntentNotConsumedBeforeProcessDeath_isReturnedOnceAfterRestore()
      throws Exception {
    Intent fullScreenIntent =
        savedActivityIntent(
            display(fullScreenNotification("full-screen", "FullScreenComponent")).fullScreenIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, new Intent(fullScreenIntent));
    Bundle savedState = moveToBackground(controller);

    simulateProcessDeath();
    controller =
        restoreController(DefaultLaunchActivity.class, new Intent(fullScreenIntent), savedState);

    assertInitialNotification(getInitialNotification(controller.get()), "full-screen", null);
    assertNull(getInitialNotification(controller.get()));
  }

  // --- R-1: full-screen claims are kept whatever the number of later interactions ---

  @Test
  public void r1_consumedFullScreenRestoredAfterManyLaterClaimsAndProcessDeath_isNotReplayed()
      throws Exception {
    Intent fullScreenA = fullScreenIntent("full-screen-A");
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, new Intent(fullScreenA));
    assertInitialNotification(getInitialNotification(controller.get()), "full-screen-A", null);
    for (int i = 0; i < LATER_INTERACTIONS; i++) {
      consumeFullScreenLaunch("full-screen-" + i);
    }
    Bundle savedState = moveToBackground(controller);

    simulateProcessDeath();
    Activity restored = restore(DefaultLaunchActivity.class, new Intent(fullScreenA), savedState);

    assertNull(getInitialNotification(restored));
  }

  @Test
  public void r1_activityKeepingConsumedFullScreenIntent_doesNotReplayItAfterManyLaterClaims()
      throws Exception {
    Intent fullScreenA = fullScreenIntent("full-screen-A");
    Activity activity = launch(DefaultLaunchActivity.class, new Intent(fullScreenA)).get();
    assertInitialNotification(getInitialNotification(activity), "full-screen-A", null);

    for (int i = 0; i < LATER_INTERACTIONS; i++) {
      consumeFullScreenLaunch("full-screen-" + i);
    }

    assertNull(getInitialNotification(activity));
  }

  @Test
  public void r1_consumedFullScreenIntents_areNotReplayedAfterHundredsOfLaterClaims()
      throws Exception {
    List<Intent> consumed = new ArrayList<>();
    ActivityController<SetIntentLaunchActivity> controller =
        launch(SetIntentLaunchActivity.class, launcherIntent());
    for (int i = 0; i < 300; i++) {
      Intent fullScreenIntent = fullScreenIntent("full-screen-" + i);
      controller.newIntent(new Intent(fullScreenIntent));
      assertInitialNotification(getInitialNotification(controller.get()), "full-screen-" + i, null);
      consumed.add(fullScreenIntent);
    }

    simulateProcessDeath();
    for (int i = 0; i < consumed.size(); i++) {
      Activity restored = launch(DefaultLaunchActivity.class, new Intent(consumed.get(i))).get();
      assertNull("full-screen-" + i, getInitialNotification(restored));
    }
  }

  @Test
  public void r1_fullScreenIntentsClaimedOutOfOrderAcrossProcessDeaths_areEachReturnedOnce()
      throws Exception {
    int count = 80;
    List<Intent> fullScreenIntents = new ArrayList<>();
    for (int i = 0; i < count; i++) {
      fullScreenIntents.add(fullScreenIntent("full-screen-" + i));
    }
    int[] deliveries = new int[count];
    Random random = new Random(88);

    // Each round presents the Intents in a new order, in new Activities, dying every few claims.
    for (int round = 0; round < 3; round++) {
      List<Integer> order = new ArrayList<>();
      for (int i = 0; i < count; i++) {
        order.add(i);
      }
      Collections.shuffle(order, random);
      // The first round leaves a third of the launches unconsumed.
      List<Integer> presented = round == 0 ? order.subList(0, count * 2 / 3) : order;
      for (int n = 0; n < presented.size(); n++) {
        int i = presented.get(n);
        Activity activity =
            launch(DefaultLaunchActivity.class, new Intent(fullScreenIntents.get(i))).get();
        Bundle initialNotification = getInitialNotification(activity);
        if (initialNotification != null) {
          assertInitialNotification(initialNotification, "full-screen-" + i, null);
          deliveries[i]++;
        }
        if (n % 7 == 0) {
          simulateProcessDeath();
        }
      }
    }

    for (int i = 0; i < count; i++) {
      assertEquals("full-screen-" + i + " deliveries", 1, deliveries[i]);
    }
  }

  @Test
  public void r1_launchedButUnconsumedFullScreen_staysClaimableAfterManyLaterInteractions()
      throws Exception {
    Intent fullScreenA = fullScreenIntent("full-screen-A");
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, new Intent(fullScreenA));
    // A's Activity goes to the background before JS asks for the initial notification.
    Bundle savedState = moveToBackground(controller);
    for (int i = 0; i < LATER_INTERACTIONS; i++) {
      consumeFullScreenLaunch("full-screen-" + i);
      Intent[] flow = launchFlow(display(pressNotification("tap-" + i)).contentIntent);
      Activity tapped = launch(DefaultLaunchActivity.class, tap(flow)).get();
      assertInitialNotification(getInitialNotification(tapped), "tap-" + i, "default");
    }

    simulateProcessDeath();
    controller =
        restoreController(DefaultLaunchActivity.class, new Intent(fullScreenA), savedState);
    assertInitialNotification(getInitialNotification(controller.get()), "full-screen-A", null);
    assertNull(getInitialNotification(controller.get()));

    savedState = moveToBackground(controller);
    simulateProcessDeath();
    controller =
        restoreController(DefaultLaunchActivity.class, new Intent(fullScreenA), savedState);
    assertNull(getInitialNotification(controller.get()));
  }

  @Test
  public void r1_displayedButNotYetLaunchedFullScreen_staysClaimableAfterManyLaterClaims()
      throws Exception {
    Intent fullScreenA = fullScreenIntent("full-screen-A");
    for (int i = 0; i < LATER_INTERACTIONS; i++) {
      consumeFullScreenLaunch("full-screen-" + i);
    }
    simulateProcessDeath();

    Activity activity = launch(DefaultLaunchActivity.class, new Intent(fullScreenA)).get();

    assertInitialNotification(getInitialNotification(activity), "full-screen-A", null);
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void r1_redisplaysWithSameNotificationId_neverReviveAnOlderConsumedLaunch()
      throws Exception {
    Intent first = fullScreenIntent("full-screen");
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, new Intent(first));
    assertInitialNotification(getInitialNotification(controller.get()), "full-screen", null);
    Bundle savedState = moveToBackground(controller);

    List<Intent> later = new ArrayList<>();
    for (int i = 0; i < LATER_INTERACTIONS; i++) {
      later.add(consumeFullScreenLaunch("full-screen"));
    }
    // Displayed again, not launched yet.
    Intent latest = fullScreenIntent("full-screen");

    simulateProcessDeath();
    assertNull(
        getInitialNotification(
            restore(DefaultLaunchActivity.class, new Intent(first), savedState)));
    for (Intent intent : later) {
      assertNull(getInitialNotification(launch(DefaultLaunchActivity.class, intent).get()));
    }
    Activity activity = launch(DefaultLaunchActivity.class, new Intent(latest)).get();
    assertInitialNotification(getInitialNotification(activity), "full-screen", null);
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void r1_concurrentClaimsOfOneFullScreenIntent_returnItOnce() throws Exception {
    Activity activity =
        launch(DefaultLaunchActivity.class, new Intent(fullScreenIntent("full-screen-A"))).get();

    int callers = 8;
    CyclicBarrier start = new CyclicBarrier(callers);
    ExecutorService executor = Executors.newFixedThreadPool(callers);
    try {
      List<Future<Bundle>> results = new ArrayList<>();
      for (int i = 0; i < callers; i++) {
        results.add(
            executor.submit(
                () -> {
                  start.await(5, TimeUnit.SECONDS);
                  return getInitialNotification(activity);
                }));
      }
      List<Bundle> delivered = new ArrayList<>();
      for (Future<Bundle> result : results) {
        collect(delivered, result.get(5, TimeUnit.SECONDS));
      }
      assertDeliveredOnce(delivered, "full-screen-A");
    } finally {
      executor.shutdownNow();
    }
  }

  @Test
  public void r1_concurrentFullScreenDisplays_areEachReturnedOnce() throws Exception {
    int count = 24;
    List<NotificationModel> models = new ArrayList<>();
    List<ListenableFuture<Void>> displays = new ArrayList<>();
    for (int i = 0; i < count; i++) {
      NotificationModel model = fullScreenNotification("full-screen-" + i, "FullScreenComponent");
      models.add(model);
      displays.add(NotificationManager.displayNotification(model, null));
    }
    Futures.allAsList(displays).get(10, TimeUnit.SECONDS);

    List<Intent> fullScreenIntents = new ArrayList<>();
    for (NotificationModel model : models) {
      Notification notification =
          Shadows.shadowOf(nativeNotificationManager()).getNotification(model.getHashCode());
      fullScreenIntents.add(new Intent(savedActivityIntent(notification.fullScreenIntent)));
    }
    for (int i = 0; i < count; i++) {
      Activity activity =
          launch(DefaultLaunchActivity.class, new Intent(fullScreenIntents.get(i))).get();
      assertInitialNotification(getInitialNotification(activity), "full-screen-" + i, null);
    }

    simulateProcessDeath();
    for (Intent intent : fullScreenIntents) {
      assertNull(getInitialNotification(launch(DefaultLaunchActivity.class, intent).get()));
    }
  }

  @Test
  public void r1_fullScreenClaimThatCannotBePersisted_isReturnedOnceAfterProcessDeath()
      throws Exception {
    Intent fullScreenA = fullScreenIntent("full-screen-A");
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, new Intent(fullScreenA));
    Activity activity = controller.get();
    List<Bundle> delivered = new ArrayList<>();

    withFailingPreferenceWrites(
        () -> {
          collect(delivered, getInitialNotification(activity));
          collect(delivered, getInitialNotification(activity));
          return null;
        });
    Bundle savedState = moveToBackground(controller);
    simulateProcessDeath();
    controller =
        restoreController(DefaultLaunchActivity.class, new Intent(fullScreenA), savedState);
    collect(delivered, getInitialNotification(controller.get()));
    collect(delivered, getInitialNotification(controller.get()));

    savedState = moveToBackground(controller);
    simulateProcessDeath();
    controller =
        restoreController(DefaultLaunchActivity.class, new Intent(fullScreenA), savedState);
    collect(delivered, getInitialNotification(controller.get()));

    assertDeliveredOnce(delivered, "full-screen-A");
  }

  @Test
  public void r1_fullScreenClaimThatCannotBePersisted_survivesALaterSuccessfulWrite()
      throws Exception {
    Intent fullScreenA = fullScreenIntent("full-screen-A");
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, new Intent(fullScreenA));
    Activity activity = controller.get();
    List<Bundle> delivered = new ArrayList<>();

    withFailingPreferenceWrites(
        () -> {
          collect(delivered, getInitialNotification(activity));
          return null;
        });
    // Storage works again and is written for an unrelated interaction.
    consumeFullScreenLaunch("full-screen-B");
    Bundle savedState = moveToBackground(controller);
    simulateProcessDeath();
    controller =
        restoreController(DefaultLaunchActivity.class, new Intent(fullScreenA), savedState);
    collect(delivered, getInitialNotification(controller.get()));
    collect(delivered, getInitialNotification(controller.get()));

    assertDeliveredOnce(delivered, "full-screen-A");
  }

  @Test
  public void r1_fullScreenDisplayedWhileStorageFails_isReturnedOnce() throws Exception {
    Intent fullScreenA = withFailingPreferenceWrites(() -> fullScreenIntent("full-screen-A"));
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, new Intent(fullScreenA));
    List<Bundle> delivered = new ArrayList<>();
    collect(delivered, getInitialNotification(controller.get()));
    collect(delivered, getInitialNotification(controller.get()));

    Bundle savedState = moveToBackground(controller);
    simulateProcessDeath();
    controller =
        restoreController(DefaultLaunchActivity.class, new Intent(fullScreenA), savedState);
    collect(delivered, getInitialNotification(controller.get()));

    // Its id is held in memory by the process that displayed it.
    assertDeliveredOnce(delivered, "full-screen-A");
  }

  @Test
  public void r1_unclaimedFullScreenIdsOfTheCurrentBoot_areKeptAsTimePasses() throws Exception {
    Intent fullScreenA = fullScreenIntent("full-screen-A");
    for (int i = 0; i < LATER_INTERACTIONS; i++) {
      ShadowSystemClock.advanceBy(Duration.ofHours(12));
      ShadowSystemClock.simulateDeepSleep(Duration.ofHours(12));
      fullScreenIntent("full-screen-" + i);
      simulateProcessDeath();
    }
    assertEquals(
        LATER_INTERACTIONS + 1,
        InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());

    Activity activity = launch(DefaultLaunchActivity.class, new Intent(fullScreenA)).get();

    assertInitialNotification(getInitialNotification(activity), "full-screen-A", null);
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void r1_unclaimedFullScreenIdsIssuedBeforeAReboot_areDroppedWithTheNextIssue()
      throws Exception {
    ShadowSystemClock.advanceBy(Duration.ofDays(3));
    for (int i = 0; i < LATER_INTERACTIONS; i++) {
      fullScreenIntent("full-screen-" + i);
    }
    assertEquals(
        LATER_INTERACTIONS, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());

    // Reboot: the process, its notifications and the system's Intent extras are gone, uptime
    // restarts.
    simulateProcessDeath();
    nativeNotificationManager().cancelAll();
    ShadowPausedSystemClock.reset();
    Intent fullScreenB = fullScreenIntent("full-screen-B");
    assertEquals(1, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());
    Intent fullScreenC = fullScreenIntent("full-screen-C");
    assertEquals(2, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());

    Activity activityB = launch(DefaultLaunchActivity.class, new Intent(fullScreenB)).get();
    assertInitialNotification(getInitialNotification(activityB), "full-screen-B", null);
    Activity activityC = launch(DefaultLaunchActivity.class, new Intent(fullScreenC)).get();
    assertInitialNotification(getInitialNotification(activityC), "full-screen-C", null);
    assertEquals(0, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());
  }

  // --- Null activity, missing/malformed extras, foreign intents ---

  @Test
  public void nullActivity_returnsStickyEventOnceThenNull() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    assertNull(getInitialNotification(null));

    runReceiver(flowA);

    assertInitialNotification(getInitialNotification(null), "A", "default");
    assertNull(getInitialNotification(null));
  }

  @Test
  public void activityIntentWithoutNotification_returnsNullAndKeepsExtras() {
    Intent launcherIntent = new Intent(Intent.ACTION_MAIN).putExtra("deep_link", "app://home");
    Activity activity = launch(DefaultLaunchActivity.class, launcherIntent).get();

    assertNull(getInitialNotification(activity));
    assertEquals("app://home", activity.getIntent().getStringExtra("deep_link"));
  }

  @Test
  public void malformedNotificationExtra_returnsNull() {
    Intent intent = new Intent(Intent.ACTION_MAIN).putExtra("notification", "not-a-bundle");
    Activity activity = launch(DefaultLaunchActivity.class, intent).get();

    assertNull(getInitialNotification(activity));
    assertNull(getInitialNotification(activity));
    assertEquals("not-a-bundle", activity.getIntent().getStringExtra("notification"));
  }

  @Test
  public void foreignIntentWithNotificationBundle_isReturnedOnceAndLeftIntact() {
    Bundle foreignNotification = new Bundle();
    foreignNotification.putString("id", "foreign");
    Intent intent =
        new Intent(Intent.ACTION_VIEW)
            .putExtra("notification", foreignNotification)
            .putExtra("deep_link", "app://foreign");
    Activity activity = launch(DefaultLaunchActivity.class, intent).get();

    assertInitialNotification(getInitialNotification(activity), "foreign", null);
    assertNull(getInitialNotification(activity));
    assertEquals("foreign", activity.getIntent().getBundleExtra("notification").getString("id"));
    assertEquals("app://foreign", activity.getIntent().getStringExtra("deep_link"));
  }

  // --- C4: regression anchors ---

  @Test
  public void everyLaunchFlowInteraction_postsStickyEventAndMarksLaunchIntent() throws Exception {
    List<Intent[]> flows = new ArrayList<>();
    flows.add(launchFlow(display(pressNotification("press-default")).contentIntent));
    flows.add(
        launchFlow(
            display(
                    notification(
                        "press-main-component",
                        androidWithPressAction(
                            pressAction("default", "default", "PressMainComponent"))))
                .contentIntent));
    flows.add(
        launchFlow(
            display(actionNotification("action-launch", pressAction("open", "default", null)))
                .actions[0]
                .actionIntent));
    flows.add(
        launchFlow(
            display(
                    actionNotification(
                        "action-main-component",
                        pressAction("open-main", null, "ActionMainComponent")))
                .actions[0]
                .actionIntent));

    List<String> pendingIntentIds = new ArrayList<>();
    long previousTapSequence = 0;
    for (Intent[] flow : flows) {
      String id = flow[0].getBundleExtra("notification").getString("id");
      assertTrue(id + " launch Intent carries the marker", flow[0].hasExtra(EVENT_TYPE_INTENT_KEY));
      String pendingIntentId = flow[0].getStringExtra(PENDING_INTENT_ID_INTENT_KEY);
      assertNotNull(id + " launch Intent carries the PendingIntent id", pendingIntentId);
      assertEquals(pendingIntentId, flow[1].getStringExtra(PENDING_INTENT_ID_INTENT_KEY));
      assertFalse(id + " PendingIntent ids are unique", pendingIntentIds.contains(pendingIntentId));
      pendingIntentIds.add(pendingIntentId);

      runReceiver(flow);

      InitialNotificationEvent event = EventBus.getStickyEvent(InitialNotificationEvent.class);
      assertNotNull(id + " receiver must post InitialNotificationEvent", event);
      assertEquals(id, event.getNotificationModel().getId());
      assertTrue(id + " tap is recorded", event.getTapSequence() > previousTapSequence);
      previousTapSequence = event.getTapSequence();
      clearStickyEvents();
    }
  }

  @Test
  public void actionPressWithLaunchActivity_returnsPressActionAndInputOnce() throws Exception {
    Intent[] flow =
        launchFlow(
            display(actionNotification("action", pressAction("reply", "default", null)))
                .actions[0]
                .actionIntent);

    Activity activity = launch(DefaultLaunchActivity.class, tapWithInput(flow, "Accepted")).get();

    Bundle initialNotification = getInitialNotification(activity);
    assertInitialNotification(initialNotification, "action", "reply");
    assertEquals("Accepted", initialNotification.getString("input"));
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void fullScreenIntent_isReturnedOnceAndKeepsMainComponent() throws Exception {
    Intent fullScreenIntent =
        savedActivityIntent(
            display(fullScreenNotification("full-screen", "FullScreenComponent")).fullScreenIntent);
    assertFalse(fullScreenIntent.hasExtra(EVENT_TYPE_INTENT_KEY));

    Activity activity = launch(DefaultLaunchActivity.class, new Intent(fullScreenIntent)).get();

    assertInitialNotification(getInitialNotification(activity), "full-screen", null);
    assertNull(getInitialNotification(activity));
    assertNull(getInitialNotification(activity));
    assertEquals("FullScreenComponent", Notifee.getInstance().getMainComponent("DefaultComponent"));
  }

  @Test
  public void fullScreenIntentConsumedThenLaterTap_returnsOnlyTheLaterTap() throws Exception {
    Intent fullScreenIntent =
        savedActivityIntent(
            display(fullScreenNotification("full-screen", "FullScreenComponent")).fullScreenIntent);
    Intent[] flowB = launchFlow(display(pressNotification("B")).contentIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, new Intent(fullScreenIntent));
    Activity activity = controller.get();
    assertInitialNotification(getInitialNotification(activity), "full-screen", null);

    controller.newIntent(tap(flowB));

    assertInitialNotification(getInitialNotification(activity), "B", "default");
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void fullScreenIntentAfterUnrelatedStickyEvent_isStillADistinctInteraction()
      throws Exception {
    Intent[] flowB = launchFlow(display(pressNotification("B")).contentIntent);
    Intent fullScreenIntent =
        savedActivityIntent(
            display(fullScreenNotification("full-screen", "FullScreenComponent")).fullScreenIntent);
    runReceiver(flowB);

    Activity activity = launch(DefaultLaunchActivity.class, new Intent(fullScreenIntent)).get();

    assertInitialNotification(getInitialNotification(activity), "B", "default");
    assertInitialNotification(getInitialNotification(activity), "full-screen", null);
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void pressActionOptOut_hasNoInitialNotification() throws Exception {
    Notification notification =
        display(
            notification(
                "opt-out",
                androidWithPressAction(
                    pressAction(NotificationPendingIntent.PRESS_ACTION_OPT_OUT_ID, null, null))));
    assertNull(notification.contentIntent);

    Activity activity = launch(DefaultLaunchActivity.class, new Intent(Intent.ACTION_MAIN)).get();

    assertNull(getInitialNotification(activity));
  }

  @Test
  @Config(sdk = 31)
  public void api31Boundary_launchFlowIsReturnedOnce() throws Exception {
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Intent[] flowB = launchFlow(display(pressNotification("B")).contentIntent);
    ActivityController<DefaultLaunchActivity> controller =
        launch(DefaultLaunchActivity.class, tap(flowA));
    Activity activity = controller.get();

    assertInitialNotification(getInitialNotification(activity), "A", "default");
    assertNull(getInitialNotification(activity));
    controller.newIntent(tap(flowB));
    assertInitialNotification(getInitialNotification(activity), "B", "default");
    assertNull(getInitialNotification(activity));
  }

  @Test
  @Config(sdk = 30)
  public void preAndroid12ReceiverServicePress_isReturnedOnce() throws Exception {
    assertLegacyReceiverServicePressIsReturnedOnce();
  }

  @Test
  public void targetSdkBelow31ReceiverServicePress_isReturnedOnce() throws Exception {
    setTargetSdk(Build.VERSION_CODES.R);
    assertLegacyReceiverServicePressIsReturnedOnce();
  }

  private void assertLegacyReceiverServicePressIsReturnedOnce() throws Exception {
    PendingIntent contentIntent = display(pressNotification("legacy")).contentIntent;
    ShadowPendingIntent shadowContentIntent = Shadows.shadowOf(contentIntent);
    assertTrue("legacy press must route to ReceiverService", shadowContentIntent.isService());

    Robolectric.buildService(ReceiverService.class)
        .create()
        .get()
        .onStartCommand(new Intent(shadowContentIntent.getSavedIntent()), 0, 1);
    Intent launchIntent =
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedActivity();
    assertNotNull("ReceiverService must launch the app", launchIntent);
    assertFalse(launchIntent.hasExtra("notification"));

    Activity activity = launch(DefaultLaunchActivity.class, launchIntent).get();

    assertInitialNotification(getInitialNotification(activity), "legacy", "default");
    assertNull(getInitialNotification(activity));
  }

  // --- Helpers ---

  private static Bundle getInitialNotification(Activity activity) {
    AtomicReference<Exception> error = new AtomicReference<>();
    AtomicReference<Bundle> result = new AtomicReference<>();
    CountDownLatch completed = new CountDownLatch(1);

    Notifee.getInstance()
        .getInitialNotification(
            activity,
            (e, bundle) -> {
              error.set(e);
              result.set(bundle);
              completed.countDown();
            });

    assertEquals("getInitialNotification must complete synchronously", 0, completed.getCount());
    assertNull(error.get());
    return result.get();
  }

  /**
   * @param pressActionId expected pressAction id, carried by interactions delivered through the
   *     sticky event; {@code null} when the pressAction is not part of the expectation.
   */
  private static void assertInitialNotification(
      Bundle initialNotification, String notificationId, String pressActionId) {
    assertNotNull("expected initial notification " + notificationId, initialNotification);
    Bundle notification = initialNotification.getBundle("notification");
    assertNotNull("initial notification must carry the notification", notification);
    assertEquals(notificationId, notification.getString("id"));

    if (pressActionId != null) {
      Bundle pressAction = initialNotification.getBundle("pressAction");
      assertNotNull("initial notification must carry the pressAction", pressAction);
      assertEquals(pressActionId, pressAction.getString("id"));
    }
  }

  private static <T extends Activity> ActivityController<T> launch(
      Class<T> activityClass, Intent intent) {
    return Robolectric.buildActivity(activityClass, intent).create().start().resume();
  }

  /** Backgrounds the Activity the way the system does before it may kill the process. */
  private static Bundle moveToBackground(ActivityController<?> controller) {
    Bundle savedState = new Bundle();
    controller.pause().stop().saveInstanceState(savedState);
    return savedState;
  }

  /**
   * Models the death of the app process: in-memory state (sticky events, statics, loaded
   * SharedPreferences) is lost, app storage survives and is read again from disk.
   */
  private static void simulateProcessDeath() {
    clearStickyEvents();
    Notifee.resetInitialNotificationStateForTesting();
    ShadowContextImpl.reset();
  }

  /** Recreates an Activity the way the system restores it in a new process. */
  private static <T extends Activity> ActivityController<T> restoreController(
      Class<T> activityClass, Intent intent, Bundle savedState) {
    return Robolectric.buildActivity(activityClass, intent)
        .create(savedState)
        .start()
        .restoreInstanceState(savedState)
        .postCreate(savedState)
        .resume();
  }

  private static <T extends Activity> Activity restore(
      Class<T> activityClass, Intent intent, Bundle savedState) {
    return restoreController(activityClass, intent, savedState).get();
  }

  private static Intent launcherIntent() {
    return new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
  }

  private static void collect(List<Bundle> delivered, Bundle initialNotification) {
    if (initialNotification != null) {
      delivered.add(initialNotification);
    }
  }

  private static void assertDeliveredOnce(List<Bundle> delivered, String notificationId) {
    assertEquals(notificationId + " must be delivered exactly once", 1, delivered.size());
    assertInitialNotification(delivered.get(0), notificationId, null);
  }

  /** Intents the system starts, bottom to top, when the user taps {@code pendingIntent}. */
  private static Intent[] launchFlow(PendingIntent pendingIntent) {
    assertNotNull("PendingIntent must be present", pendingIntent);
    ShadowPendingIntent shadowPendingIntent = Shadows.shadowOf(pendingIntent);
    assertTrue("Android 12+ launch flow must start activities", shadowPendingIntent.isActivity());
    Intent[] intents = shadowPendingIntent.getSavedIntents();
    assertEquals("launch flow must start the app and the receiver", 2, intents.length);
    assertEquals(
        NotificationReceiverActivity.class.getName(), intents[1].getComponent().getClassName());
    return intents;
  }

  /** Displays a full-screen notification and returns a copy of the Intent its launch starts. */
  private Intent fullScreenIntent(String id) throws Exception {
    // The saved Intent is updated in place when the notification is displayed again.
    return new Intent(
        savedActivityIntent(
            display(fullScreenNotification(id, "FullScreenComponent")).fullScreenIntent));
  }

  /** Displays, launches and consumes a full-screen notification; returns its launch Intent. */
  private Intent consumeFullScreenLaunch(String id) throws Exception {
    Intent fullScreenIntent = fullScreenIntent(id);
    Activity activity = launch(DefaultLaunchActivity.class, new Intent(fullScreenIntent)).get();
    assertInitialNotification(getInitialNotification(activity), id, null);
    assertNull(getInitialNotification(activity));
    return fullScreenIntent;
  }

  /** Runs {@code action} while the app's SharedPreferences cannot be written to disk. */
  private <T> T withFailingPreferenceWrites(Callable<T> action) throws Exception {
    File preferencesDir = new File(context.getDataDir(), "shared_prefs");
    assertTrue(preferencesDir.isDirectory() || preferencesDir.mkdirs());
    assertTrue(preferencesDir.setWritable(false));
    try {
      SharedPreferences probe =
          context.getSharedPreferences("write-failure-probe", Context.MODE_PRIVATE);
      assertFalse("writes must fail", probe.edit().putLong("probe", System.nanoTime()).commit());
      return action.call();
    } finally {
      preferencesDir.setWritable(true);
    }
  }

  private static Intent savedActivityIntent(PendingIntent pendingIntent) {
    assertNotNull("PendingIntent must be present", pendingIntent);
    ShadowPendingIntent shadowPendingIntent = Shadows.shadowOf(pendingIntent);
    assertTrue(shadowPendingIntent.isActivity());
    return shadowPendingIntent.getSavedIntent();
  }

  private static void runReceiver(Intent[] flow) {
    runReceiver(new Intent(flow[1]));
  }

  private static void runReceiver(Intent receiverIntent) {
    Robolectric.buildActivity(NotificationReceiverActivity.class, receiverIntent).create();
  }

  /** Delivers one tap and returns the new Intent the launch Activity receives for it. */
  private static Intent tap(Intent[] flow) {
    runReceiver(flow);
    return new Intent(flow[0]);
  }

  private static Intent tapWithInput(Intent[] flow, String input) {
    Intent receiverIntent = new Intent(flow[1]);
    Bundle results = new Bundle();
    results.putCharSequence(NotificationReceiverHandler.REMOTE_INPUT_RECEIVER_KEY, input);
    RemoteInput.addResultsToIntent(
        new RemoteInput[] {
          new RemoteInput.Builder(NotificationReceiverHandler.REMOTE_INPUT_RECEIVER_KEY).build()
        },
        receiverIntent,
        results);
    runReceiver(receiverIntent);
    return new Intent(flow[0]);
  }

  private Notification display(NotificationModel notificationModel) throws Exception {
    NotificationManager.displayNotification(notificationModel, null).get(5, TimeUnit.SECONDS);

    ShadowNotificationManager shadowNotificationManager =
        Shadows.shadowOf(nativeNotificationManager());
    Notification notification =
        shadowNotificationManager.getNotification(notificationModel.getHashCode());
    assertNotNull("notification must be posted", notification);
    return notification;
  }

  private android.app.NotificationManager nativeNotificationManager() {
    return (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
  }

  private static NotificationModel pressNotification(String id) {
    return notification(id, androidWithPressAction(pressAction("default", "default", null)));
  }

  private static NotificationModel nonAutoCancelPressNotification(String id) {
    Bundle androidBundle = androidWithPressAction(pressAction("default", "default", null));
    androidBundle.putBoolean("autoCancel", false);
    return notification(id, androidBundle);
  }

  private static NotificationModel actionNotification(String id, Bundle actionPressAction) {
    Bundle action = new Bundle();
    action.putString("title", "Action " + actionPressAction.getString("id"));
    action.putBundle("pressAction", actionPressAction);
    ArrayList<Bundle> actions = new ArrayList<>();
    actions.add(action);

    Bundle androidBundle = androidWithPressAction(pressAction("default", "default", null));
    androidBundle.putParcelableArrayList("actions", actions);
    return notification(id, androidBundle);
  }

  private static NotificationModel fullScreenNotification(String id, String mainComponent) {
    Bundle androidBundle = androidWithPressAction(pressAction("default", "default", null));
    androidBundle.putBundle("fullScreenAction", pressAction("default", "default", mainComponent));
    return notification(id, androidBundle);
  }

  private static Bundle androidWithPressAction(Bundle pressAction) {
    Bundle androidBundle = new Bundle();
    androidBundle.putString("channelId", CHANNEL_ID);
    androidBundle.putBundle("pressAction", pressAction);
    return androidBundle;
  }

  private static NotificationModel notification(String id, Bundle androidBundle) {
    Bundle notificationBundle = new Bundle();
    notificationBundle.putString("id", id);
    notificationBundle.putString("title", "Initial notification " + id);
    notificationBundle.putString("body", "Body " + id);
    notificationBundle.putBundle("android", androidBundle);
    return NotificationModel.fromBundle(notificationBundle);
  }

  private static Bundle pressAction(String id, String launchActivity, String mainComponent) {
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
    android.app.NotificationManager notificationManager = nativeNotificationManager();
    if (notificationManager.getNotificationChannel(CHANNEL_ID) == null) {
      notificationManager.createNotificationChannel(
          new NotificationChannel(
              CHANNEL_ID,
              "Initial notification consumption test",
              android.app.NotificationManager.IMPORTANCE_LOW));
    }
  }

  private static void setTargetSdk(int targetSdk) {
    RuntimeEnvironment.getApplication().getApplicationInfo().targetSdkVersion = targetSdk;
  }

  private static void clearStickyEvents() {
    EventBus.removeStickEvent(InitialNotificationEvent.class);
    EventBus.removeStickEvent(MainComponentEvent.class);
  }

  /**
   * Default {@code onNewIntent}: {@link #getIntent()} keeps the creation Intent (ReactActivity).
   */
  public static class DefaultLaunchActivity extends Activity {}

  /** App-level pattern that replaces {@link #getIntent()} on every new Intent. */
  public static class SetIntentLaunchActivity extends Activity {
    @Override
    protected void onNewIntent(Intent intent) {
      super.onNewIntent(intent);
      setIntent(intent);
    }
  }
}
