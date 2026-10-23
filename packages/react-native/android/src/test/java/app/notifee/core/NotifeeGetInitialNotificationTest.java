package app.notifee.core;

import static app.notifee.core.NotificationPendingIntent.EVENT_TYPE_INTENT_KEY;
import static app.notifee.core.NotificationPendingIntent.PENDING_INTENT_ID_INTENT_KEY;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;

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
import android.os.BadParcelableException;
import android.os.Build;
import android.os.Bundle;
import app.notifee.core.event.InitialNotificationEvent;
import app.notifee.core.event.MainComponentEvent;
import app.notifee.core.event.NotificationEvent;
import app.notifee.core.model.NotificationModel;
import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Callback;
import com.facebook.react.bridge.CatalystInstance;
import com.facebook.react.bridge.JavaScriptContextHolder;
import com.facebook.react.bridge.JavaScriptModule;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.UIManager;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.turbomodule.core.interfaces.CallInvokerHolder;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import io.invertase.notifee.NotifeeApiModule;
import io.invertase.notifee.NotifeePackage;
import java.io.File;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.greenrobot.eventbus.Subscribe;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;
import org.mockito.Mockito;
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
 * event; the launch Activity then receives its own copy of the launch Intent. A full-screen launch
 * uses a sole private capture Activity, which starts the consumer after recording the launch.
 * Synthetic callback races also exercise the Activity fallback defensively.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class NotifeeGetInitialNotificationTest {
  private static final String CHANNEL_ID = "initial-notification-consumption-test-channel";
  // More later interactions than a short record of claimed ids would hold.
  private static final int LATER_INTERACTIONS = 40;
  // Action of the receiver Intent of a full-screen launch: part of its PendingIntent's identity.
  private static final String FULL_SCREEN_LAUNCH_ACTION = "app.notifee.core.FULL_SCREEN_LAUNCH";

  private Context context;
  // React instance hosting ReactLaunchActivity, once started (startReactInstance).
  private TestReactContext reactContext;
  private NotifeeApiModule notifeeModule;
  private NotificationEventRecorder eventRecorder;

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
    // These consumer classes stand in for manifest-declared, same-app Activities.
    ShadowPackageManager packageManager = Shadows.shadowOf(context.getPackageManager());
    for (Class<?> activity :
        new Class<?>[] {
          SetIntentLaunchActivity.class,
          ComponentCheckingLaunchActivity.class,
          ReactLaunchActivity.class,
          ReactExtrasClearingLaunchActivity.class,
          ReactSetIntentLaunchActivity.class
        }) {
      packageManager.addActivityIfNotPresent(new ComponentName(context, activity));
    }
    createChannel();
    nativeNotificationManager().cancelAll();
  }

  @After
  public void tearDown() {
    ContextHolder.setApplicationContext(context);
    clearStickyEvents();
    Notifee.resetInitialNotificationStateForTesting();
    InitialNotificationLedger.clearForTesting();
    ShadowPendingIntent.reset();
    ReactLaunchActivity.reactContext = null;
    if (eventRecorder != null) {
      EventBus.unregister(eventRecorder);
    }
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
        fullScreenLaunchIntent(
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
        fullScreenLaunchIntent(
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
        fullScreenLaunchIntent(
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
        fullScreenLaunchIntent(
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
        fullScreenLaunchIntent(
            display(fullScreenNotification("full-screen", "FullScreenComponent")).fullScreenIntent);
    Activity activity = launch(DefaultLaunchActivity.class, new Intent(second)).get();

    assertInitialNotification(getInitialNotification(activity), "full-screen", null);
    assertNull(getInitialNotification(activity));
  }

  @Test
  public void fullScreenIntentNotConsumedBeforeProcessDeath_isReturnedOnceAfterRestore()
      throws Exception {
    Intent fullScreenIntent =
        fullScreenLaunchIntent(
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
      fullScreenIntents.add(new Intent(fullScreenLaunchIntent(notification.fullScreenIntent)));
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
        fullScreenLaunchIntent(
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
        fullScreenLaunchIntent(
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
        fullScreenLaunchIntent(
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

  // --- F88-RT-01: launches delivered to an existing React Native Activity (onNewIntent) ---

  @Test
  @Config(sdk = {28, 31, 34, 35, 36, 37})
  public void rt01_fullScreenDeliveredToExistingReactActivity_isReturnedOnce() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    assertNull(jsGetInitialNotification());

    // singleTask: the system hands the launch to the existing instance.
    deliverFullScreen(controller, fullScreenFlow("FS-singleTask-new"));

    Intent creationIntent = controller.get().getIntent();
    assertEquals(Intent.ACTION_MAIN, creationIntent.getAction());
    assertFalse(creationIntent.hasExtra("notification"));
    assertInitialNotification(jsGetInitialNotification(), "FS-singleTask-new", null);
    assertNull(jsGetInitialNotification());
    assertEquals(0, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());
    assertTrue(reactContext.listenerExceptions.isEmpty());
  }

  @Test
  public void rt01_successiveFullScreens_includingSameNotificationId_areEachReturnedOnce()
      throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());

    for (int launch = 0; launch < 3; launch++) {
      deliverFullScreen(controller, fullScreenFlow("full-screen"));
      assertInitialNotification(jsGetInitialNotification(), "full-screen", null);
      assertNull("launch " + launch, jsGetInitialNotification());
    }
    deliverFullScreen(controller, fullScreenFlow("full-screen-A"));
    assertInitialNotification(jsGetInitialNotification(), "full-screen-A", null);
    deliverFullScreen(controller, fullScreenFlow("full-screen-B"));
    assertInitialNotification(jsGetInitialNotification(), "full-screen-B", null);
    assertNull(jsGetInitialNotification());
    assertEquals(0, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());
  }

  @Test
  public void rt01_laterFullScreenBeforeARead_replacesTheUnreadOneLikeALaterTap() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());

    deliverFullScreen(controller, fullScreenFlow("full-screen-A"));
    deliverFullScreen(controller, fullScreenFlow("full-screen-B"));

    // One new launch is kept, as the sticky event keeps the latest tap.
    assertInitialNotification(jsGetInitialNotification(), "full-screen-B", null);
    assertNull(jsGetInitialNotification());
    // A was superseded permanently, even though it was never returned.
    assertEquals(0, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());
  }

  @Test
  public void rt01_coldStartFromFullScreen_onlyTheLatestUnreadLaunchIsReturned() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launchFromFullScreen(ReactLaunchActivity.class, fullScreenFlow("full-screen-A"));
    assertInitialNotification(jsGetInitialNotification(), "full-screen-A", null);
    assertNull(jsGetInitialNotification());

    deliverFullScreen(controller, fullScreenFlow("full-screen-B"));
    assertInitialNotification(jsGetInitialNotification(), "full-screen-B", null);
    assertNull(jsGetInitialNotification());
    assertEquals(
        "full-screen-A",
        controller.get().getIntent().getBundleExtra("notification").getString("id"));

    // Creation launch not read before a later one: only the latest may be returned.
    ActivityController<ReactLaunchActivity> unread =
        launchFromFullScreen(ReactLaunchActivity.class, fullScreenFlow("full-screen-C"));
    deliverFullScreen(unread, fullScreenFlow("full-screen-D"));
    List<Bundle> delivered = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
      collect(delivered, jsGetInitialNotification());
    }
    assertEquals(1, delivered.size());
    assertInitialNotification(delivered.get(0), "full-screen-D", null);
  }

  @Test
  public void rt01_fullScreenDeliveredBeforeJsFirstUsesNotifee_isReturnedOnce() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());

    // JS has not called Notifee yet: it resolves the TurboModule on first use.
    deliverFullScreen(controller, fullScreenFlow("full-screen"));

    assertNull(notifeeModule);
    assertInitialNotification(jsGetInitialNotification(), "full-screen", null);
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void rt01_reloadedReactInstance_keepsUnreadLaunchAndTakesOverLaterOnes() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    deliverFullScreen(controller, fullScreenFlow("full-screen-A"));

    TestReactContext previous = reloadReactInstance(controller.get());

    assertInitialNotification(jsGetInitialNotification(), "full-screen-A", null);
    assertNull(jsGetInitialNotification());
    // A launch Intent handed to React Native only, here by the torn-down instance, is not one.
    previous.onNewIntent(
        controller.get(), fullScreenLaunchIntent(fullScreenFlow("full-screen-stale")));
    assertNull(jsGetInitialNotification());
    deliverFullScreen(controller, fullScreenFlow("full-screen-B"));
    assertInitialNotification(jsGetInitialNotification(), "full-screen-B", null);
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void rt01_readFullScreen_isNotReplayedAfterActivityRecreation() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    deliverFullScreen(controller, fullScreenFlow("full-screen"));
    assertInitialNotification(jsGetInitialNotification(), "full-screen", null);

    // Configuration change: a new instance gets the creation Intent; same process and instance.
    Bundle savedState = moveToBackground(controller);
    controller.destroy();
    restoreController(ReactLaunchActivity.class, launcherIntent(), savedState);

    assertNull(jsGetInitialNotification());
  }

  @Test
  public void rt01_unreadFullScreen_isReturnedOnceAfterActivityRecreation() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    deliverFullScreen(controller, fullScreenFlow("full-screen"));

    Bundle savedState = moveToBackground(controller);
    controller.destroy();
    restoreController(ReactLaunchActivity.class, launcherIntent(), savedState);

    assertInitialNotification(jsGetInitialNotification(), "full-screen", null);
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void rt01_readFullScreen_isNotReplayedAfterProcessDeath() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    Intent[] fullScreenFlow = fullScreenFlow("full-screen");
    deliverFullScreen(controller, fullScreenFlow);
    assertInitialNotification(jsGetInitialNotification(), "full-screen", null);
    Bundle savedState = moveToBackground(controller);

    simulateProcessDeath();
    startReactInstance();
    ActivityController<ReactLaunchActivity> restored =
        restoreController(ReactLaunchActivity.class, launcherIntent(), savedState);
    assertNull(jsGetInitialNotification());

    // The same launch presented again, to the Activity, or as the base Intent from Recents.
    deliverFullScreen(restored, fullScreenFlow);
    assertNull(jsGetInitialNotification());
    launch(
        ReactLaunchActivity.class,
        fullScreenLaunchIntent(fullScreenFlow)
            .addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY));
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void rt01_launchNotReadBeforeProcessDeath_isReturnedOnceWhenPresentedAgain()
      throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    Intent[] fullScreenFlow = fullScreenFlow("full-screen");
    deliverFullScreen(controller, fullScreenFlow);
    Bundle savedState = moveToBackground(controller);

    simulateProcessDeath();
    startReactInstance();
    // The system restores the Activity with its creation Intent: the recorded launch died with the
    // process, its interaction was not consumed.
    ActivityController<ReactLaunchActivity> restored =
        restoreController(ReactLaunchActivity.class, launcherIntent(), savedState);
    assertNull(jsGetInitialNotification());
    assertEquals(1, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());

    deliverFullScreen(restored, fullScreenFlow);
    assertInitialNotification(jsGetInitialNotification(), "full-screen", null);
    assertNull(jsGetInitialNotification());
    deliverFullScreen(restored, fullScreenFlow);
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void rt01_otherNewIntents_areNeitherReturnedNorDropTheUnreadLaunch() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    Intent[] consumedFlow = fullScreenFlow("consumed");
    deliverFullScreen(controller, consumedFlow);
    assertInitialNotification(jsGetInitialNotification(), "consumed", null);
    Intent consumed = fullScreenLaunchIntent(consumedFlow);
    Intent legacyFullScreen = fullScreenLaunchIntent(fullScreenFlow("legacy"));
    legacyFullScreen.removeExtra(PENDING_INTENT_ID_INTENT_KEY);
    Bundle foreignNotification = new Bundle();
    foreignNotification.putString("id", "foreign");

    deliverFullScreen(controller, fullScreenFlow("full-screen"));
    List<Intent> others = new ArrayList<>();
    others.add(launcherIntent());
    others.add(new Intent(Intent.ACTION_VIEW).putExtra("notification", foreignNotification));
    others.add(
        new Intent(Intent.ACTION_VIEW)
            .putExtra("notification", foreignNotification)
            .putExtra(PENDING_INTENT_ID_INTENT_KEY, UUID.randomUUID().toString()));
    others.add(
        new Intent(Intent.ACTION_MAIN)
            .putExtra("notification", "not-a-bundle")
            .putExtra(PENDING_INTENT_ID_INTENT_KEY, UUID.randomUUID().toString()));
    others.add(new Intent(consumed).putExtra(PENDING_INTENT_ID_INTENT_KEY, 88));
    others.add(new Intent(consumed));
    others.add(new Intent(consumed).addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY));
    others.add(legacyFullScreen);
    others.add(new UnreadableExtrasIntent());
    for (Intent other : others) {
      controller.newIntent(other);
    }

    assertInitialNotification(jsGetInitialNotification(), "full-screen", null);
    assertNull(jsGetInitialNotification());
    assertNull(jsGetInitialNotification());
    assertEquals(Intent.ACTION_MAIN, controller.get().getIntent().getAction());
    assertTrue(reactContext.listenerExceptions.isEmpty());
  }

  @Test
  public void rt01_recordedLaunch_isNotAffectedByLaterChangesToTheDeliveredIntents()
      throws Exception {
    startReactInstance();
    // Another SDK listening after Notifee, then the app, drop the extras they handled.
    reactContext.addActivityEventListener(
        new BaseActivityEventListener() {
          @Override
          public void onNewIntent(Intent intent) {
            intent.removeExtra("notification");
          }
        });
    ActivityController<ReactExtrasClearingLaunchActivity> controller =
        launch(ReactExtrasClearingLaunchActivity.class, launcherIntent());
    Intent[] flow = fullScreenFlow("full-screen", ReactExtrasClearingLaunchActivity.class);

    Intent delivered = fullScreenLaunchIntent(flow);
    controller.newIntent(delivered);
    Intent receiverIntent = fullScreenReceiverIntent(flow);
    runReceiver(receiverIntent);
    receiverIntent.replaceExtras((Bundle) null);

    assertNull(delivered.getExtras());
    assertInitialNotification(jsGetInitialNotification(), "full-screen", null);
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void rt01_tapsDeliveredToExistingReactActivity_areReturnedOnce() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Intent[] flowB =
        launchFlow(
            display(actionNotification("B", pressAction("reply", "default", null)))
                .actions[0]
                .actionIntent);
    Intent[] flowC = launchFlow(display(pressNotification("C")).contentIntent);

    controller.newIntent(tap(flowA));
    assertInitialNotification(jsGetInitialNotification(), "A", "default");
    assertNull(jsGetInitialNotification());

    controller.newIntent(tapWithInput(flowB, "Accepted"));
    Bundle actionPress = jsGetInitialNotification();
    assertInitialNotification(actionPress, "B", "reply");
    assertEquals("Accepted", actionPress.getString("input"));
    assertNull(jsGetInitialNotification());

    // The launch Intent reaches the Activity before the receiver posts the tap.
    controller.newIntent(new Intent(flowC[0]));
    assertNull(jsGetInitialNotification());
    runReceiver(flowC);
    assertInitialNotification(jsGetInitialNotification(), "C", "default");
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void rt01_tapAndFullScreenDeliveredBeforeARead_areEachReturnedOnce() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    Intent[] flowA = launchFlow(display(pressNotification("A")).contentIntent);
    Intent[] flowB = launchFlow(display(pressNotification("B")).contentIntent);

    deliverFullScreen(controller, fullScreenFlow("full-screen-1"));
    controller.newIntent(tap(flowA));
    assertInitialNotification(jsGetInitialNotification(), "A", "default");
    assertInitialNotification(jsGetInitialNotification(), "full-screen-1", null);
    assertNull(jsGetInitialNotification());

    controller.newIntent(tap(flowB));
    deliverFullScreen(controller, fullScreenFlow("full-screen-2"));
    assertInitialNotification(jsGetInitialNotification(), "B", "default");
    assertInitialNotification(jsGetInitialNotification(), "full-screen-2", null);
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void rt01_launchDeliveredWhileAnotherReactActivityIsCurrent_isReturnedOnce()
      throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> main =
        launch(ReactLaunchActivity.class, launcherIntent());
    // A second React Activity, created by a full-screen launch, is the current one.
    launchFromFullScreen(ReactLaunchActivity.class, fullScreenFlow("full-screen-A"));

    deliverFullScreen(main, fullScreenFlow("full-screen-B"));

    List<Bundle> delivered = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
      collect(delivered, jsGetInitialNotification());
    }
    assertEquals(1, delivered.size());
    assertInitialNotification(delivered.get(0), "full-screen-B", null);
  }

  @Test
  public void rt01_launchDelivered_isReturnedOnceWithoutCurrentActivity() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    deliverFullScreen(controller, fullScreenFlow("full-screen"));

    // The Activity is finished before JS asks; the React instance lives on.
    controller.pause().stop().destroy();
    assertNull(reactContext.getCurrentActivity());

    assertInitialNotification(jsGetInitialNotification(), "full-screen", null);
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void rt01_newIntentsRacingConcurrentReads_returnEveryLaunchOnce() throws Exception {
    assertConcurrentReadsReturnEveryLaunchOnce(ReactLaunchActivity.class);
  }

  @Test
  public void rt01_newIntentsRacingConcurrentReadsOnSetIntentHost_returnEveryLaunchOnce()
      throws Exception {
    // The launch is both recorded by the receiver and returned by getIntent().
    assertConcurrentReadsReturnEveryLaunchOnce(ReactSetIntentLaunchActivity.class);
  }

  @Test
  public void rt01_launchArrivingWhileTheKeptOneIsClaimed_isReturnedOnce() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    int rounds = 60;
    List<Intent[]> earlier = new ArrayList<>();
    List<Intent[]> later = new ArrayList<>();
    for (int round = 0; round < rounds; round++) {
      earlier.add(fullScreenFlow("earlier-" + round));
      later.add(fullScreenFlow("later-" + round));
    }

    int readers = 4;
    AtomicBoolean delivering = new AtomicBoolean(true);
    List<Bundle> delivered = Collections.synchronizedList(new ArrayList<>());
    ExecutorService executor = Executors.newFixedThreadPool(readers);
    try {
      List<Future<?>> readerResults = new ArrayList<>();
      for (int i = 0; i < readers; i++) {
        readerResults.add(
            executor.submit(
                () -> {
                  while (delivering.get()) {
                    collect(delivered, getInitialNotification(reactContext.getCurrentActivity()));
                  }
                  return null;
                }));
      }
      for (int round = 0; round < rounds; round++) {
        // The later launch arrives while a reader may be claiming the earlier one.
        deliverFullScreen(controller, earlier.get(round));
        deliverFullScreen(controller, later.get(round));
        collect(delivered, getInitialNotification(reactContext.getCurrentActivity()));
      }
      delivering.set(false);
      for (Future<?> readerResult : readerResults) {
        readerResult.get(10, TimeUnit.SECONDS);
      }
    } finally {
      executor.shutdownNow();
    }

    List<String> ids = new ArrayList<>();
    for (Bundle initialNotification : delivered) {
      ids.add(initialNotification.getBundle("notification").getString("id"));
    }
    for (int round = 0; round < rounds; round++) {
      // The earlier launch is replaced unless a read took it first.
      assertTrue(Collections.frequency(ids, "earlier-" + round) <= 1);
      assertEquals("later-" + round, 1, Collections.frequency(ids, "later-" + round));
    }
  }

  @Test
  public void rt01_launchWhoseClaimCannotBePersisted_isReturnedOnceWritesWorkAgain()
      throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    deliverFullScreen(controller, fullScreenFlow("full-screen"));
    List<Bundle> delivered = new ArrayList<>();

    withFailingPreferenceWrites(
        () -> {
          collect(delivered, jsGetInitialNotification());
          collect(delivered, jsGetInitialNotification());
          return null;
        });
    collect(delivered, jsGetInitialNotification());
    collect(delivered, jsGetInitialNotification());

    assertDeliveredOnce(delivered, "full-screen");
  }

  private void assertConcurrentReadsReturnEveryLaunchOnce(
      Class<? extends ReactLaunchActivity> hostClass) throws Exception {
    startReactInstance();
    ActivityController<? extends ReactLaunchActivity> controller =
        launch(hostClass, launcherIntent());
    int launches = 40;
    List<Intent[]> fullScreenFlows = new ArrayList<>();
    for (int i = 0; i < launches; i++) {
      fullScreenFlows.add(fullScreenFlow("full-screen-" + i, hostClass));
    }

    int readers = 4;
    AtomicBoolean delivering = new AtomicBoolean(true);
    List<Bundle> delivered = Collections.synchronizedList(new ArrayList<>());
    ExecutorService executor = Executors.newFixedThreadPool(readers);
    try {
      List<Future<?>> readerResults = new ArrayList<>();
      for (int i = 0; i < readers; i++) {
        readerResults.add(
            executor.submit(
                () -> {
                  while (delivering.get()) {
                    collect(delivered, getInitialNotification(reactContext.getCurrentActivity()));
                  }
                  return null;
                }));
      }
      for (Intent[] fullScreenFlow : fullScreenFlows) {
        // Launches arrive on the main thread, then JS asks.
        deliverFullScreen(controller, fullScreenFlow);
        collect(delivered, getInitialNotification(reactContext.getCurrentActivity()));
      }
      delivering.set(false);
      for (Future<?> readerResult : readerResults) {
        readerResult.get(10, TimeUnit.SECONDS);
      }
    } finally {
      executor.shutdownNow();
    }

    assertEquals(launches, delivered.size());
    List<String> ids = new ArrayList<>();
    for (Bundle initialNotification : delivered) {
      ids.add(initialNotification.getBundle("notification").getString("id"));
    }
    for (int i = 0; i < launches; i++) {
      assertEquals("full-screen-" + i, 1, Collections.frequency(ids, "full-screen-" + i));
    }
    assertNull(jsGetInitialNotification());
    assertTrue(reactContext.listenerExceptions.isEmpty());
  }

  // --- React instance startup: launches recorded by FullScreenNotificationActivity (#88) ---

  @Test
  @Config(sdk = {28, 31, 34, 35, 36, 37})
  public void startup_fullScreenDeliveredBeforeTheReactContextExists_isReturnedOnce()
      throws Exception {
    // The process was started for the Activity; its React instance has no ReactContext yet (W0).
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());

    deliverFullScreen(controller, fullScreenFlow("full-screen"));
    startReactInstance(controller.get());

    assertEquals(Intent.ACTION_MAIN, controller.get().getIntent().getAction());
    assertInitialNotification(jsGetInitialNotification(), "full-screen", null);
    assertNull(jsGetInitialNotification());
    assertEquals(0, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());
  }

  @Test
  @Config(sdk = {28, 31, 34, 35, 36, 37})
  public void startup_fullScreenDeliveredBeforeTheEagerModulesExist_isReturnedOnce()
      throws Exception {
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    // The ReactContext exists; the instance has not created its eager TurboModules yet (W1).
    createReactContext(controller.get());

    deliverFullScreen(controller, fullScreenFlow("full-screen"));
    initializeEagerTurboModules();

    assertInitialNotification(jsGetInitialNotification(), "full-screen", null);
    assertNull(jsGetInitialNotification());
    assertEquals(0, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());
    assertTrue(reactContext.listenerExceptions.isEmpty());
  }

  @Test
  public void startup_restoredActivityGivenAFullScreenBeforeReact_returnsItOnceNeverAgain()
      throws Exception {
    // An incoming call for an app killed in the background with its task in Recents: the system
    // restores the Activity in a new process, then hands it the launch while React starts.
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    Intent[] flow = fullScreenFlow("incoming-call");
    Bundle savedState = moveToBackground(controller);

    simulateProcessDeath();
    ActivityController<ReactLaunchActivity> restored =
        restoreController(ReactLaunchActivity.class, launcherIntent(), savedState);
    deliverFullScreen(restored, flow);
    startReactInstance(restored.get());

    assertInitialNotification(jsGetInitialNotification(), "incoming-call", null);
    assertNull(jsGetInitialNotification());

    // Restored again in a later process, and given the same launch again.
    savedState = moveToBackground(restored);
    simulateProcessDeath();
    restored = restoreController(ReactLaunchActivity.class, launcherIntent(), savedState);
    deliverFullScreen(restored, flow);
    startReactInstance(restored.get());
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void startup_fullScreenCreatingTheActivity_isReturnedOnceWhicheverIsCreatedFirst()
      throws Exception {
    for (boolean receiverFirst : new boolean[] {false, true}) {
      String id = receiverFirst ? "receiver-first" : "activity-first";
      Intent[] flow = fullScreenFlow(id);
      ActivityController<ReactLaunchActivity> controller;
      if (receiverFirst) {
        runReceiver(fullScreenReceiverIntent(flow));
        controller = launch(ReactLaunchActivity.class, fullScreenLaunchIntent(flow));
      } else {
        controller = launch(ReactLaunchActivity.class, fullScreenLaunchIntent(flow));
        runReceiver(fullScreenReceiverIntent(flow));
      }
      startReactInstance(controller.get());

      assertInitialNotification(jsGetInitialNotification(), id, null);
      assertNull(id, jsGetInitialNotification());

      // Restored with its creation Intent, the launch Intent, in a later process.
      Bundle savedState = moveToBackground(controller);
      simulateProcessDeath();
      ActivityController<ReactLaunchActivity> restored =
          restoreController(ReactLaunchActivity.class, fullScreenLaunchIntent(flow), savedState);
      startReactInstance(restored.get());
      assertNull(id, jsGetInitialNotification());
      restored.pause().stop().destroy();
    }
  }

  @Test
  public void startup_readBeforeTheReceiverIsCreated_doesNotConsumeTheLaunch() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    Intent[] flow = fullScreenFlow("full-screen");

    // The Activity receives the launch Intent; JS asks before the capture receiver callback runs.
    controller.newIntent(fullScreenLaunchIntent(flow));
    assertNull(jsGetInitialNotification());
    assertEquals(1, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());

    runReceiver(fullScreenReceiverIntent(flow));
    assertInitialNotification(jsGetInitialNotification(), "full-screen", null);
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void notifeeModule_isCreatedWhenJsFirstUsesIt_andListensToNoActivityEvent() {
    ReactModuleInfo moduleInfo =
        new NotifeePackage()
            .getReactModuleInfoProvider()
            .getReactModuleInfos()
            .get(NotifeeApiModule.NAME);
    assertNotNull(moduleInfo);
    assertTrue(moduleInfo.isTurboModule());
    assertFalse(moduleInfo.needsEagerInit());

    startReactInstance();
    assertNull("the React instance must not create the module", notifeeModule);
    assertNull(jsGetInitialNotification());
    assertNotNull(notifeeModule);
    assertTrue(reactContext.activityEventListeners.isEmpty());
    notifeeModule.invalidate();
  }

  // --- Full-screen capture receiver ---

  @Test
  public void fsReceiver_recordsTheLaunchWithoutTapEventsAndFinishes() throws Exception {
    NotificationEventRecorder events = recordTapEvents();
    Intent[] flow = fullScreenFlow("full-screen");

    FullScreenNotificationActivity receiver =
        Robolectric.buildActivity(
                FullScreenNotificationActivity.class, fullScreenReceiverIntent(flow))
            .create()
            .get();

    assertTrue(receiver.isFinishing());
    assertTrue(events.taps.isEmpty());
    assertNull(EventBus.getStickyEvent(InitialNotificationEvent.class));
    // Neither an Activity nor a React instance is needed to return it.
    assertInitialNotification(getInitialNotification(null), "full-screen", null);
    assertNull(getInitialNotification(null));
    assertEquals("FullScreenComponent", Notifee.getInstance().getMainComponent("DefaultComponent"));
  }

  @Test
  public void fsReceiver_createdBeforeTheContextIsKnown_recordsTheLaunch() throws Exception {
    Intent[] flow = fullScreenFlow("full-screen");
    ContextHolder.setApplicationContext(null);

    runReceiver(fullScreenReceiverIntent(flow));

    assertNotNull(ContextHolder.getApplicationContext());
    assertInitialNotification(getInitialNotification(null), "full-screen", null);
    assertNull(getInitialNotification(null));
  }

  @Test
  public void fsReceiver_forgedOrStaleLaunches_areNotRecordedAndKeepTheRecordedOne()
      throws Exception {
    NotificationEventRecorder events = recordTapEvents();
    Intent[] consumedFlow = fullScreenFlow("consumed");
    runReceiver(fullScreenReceiverIntent(consumedFlow));
    assertInitialNotification(getInitialNotification(null), "consumed", null);
    Intent[] flow = fullScreenFlow("full-screen");
    runReceiver(fullScreenReceiverIntent(flow));
    // Displayed, not launched yet.
    Intent[] otherFlow = fullScreenFlow("other");
    String tapPendingIntentId =
        launchFlow(display(pressNotification("tap")).contentIntent)[1].getStringExtra(
            PENDING_INTENT_ID_INTENT_KEY);
    Intent other = fullScreenReceiverIntent(otherFlow);

    // The receiver is exported: any app can start it with any Intent.
    List<Intent> forged = new ArrayList<>();
    forged.add(
        new Intent(other).putExtra(PENDING_INTENT_ID_INTENT_KEY, UUID.randomUUID().toString()));
    forged.add(fullScreenReceiverIntent(consumedFlow));
    forged.add(new Intent(other).putExtra(PENDING_INTENT_ID_INTENT_KEY, tapPendingIntentId));
    forged.add(new Intent(other).putExtra(EVENT_TYPE_INTENT_KEY, NotificationEvent.TYPE_PRESS));
    forged.add(new Intent(other).putExtra(PENDING_INTENT_ID_INTENT_KEY, 88));
    forged.add(new Intent(other).putExtra("notification", "not-a-bundle"));
    Intent withoutId = new Intent(other);
    withoutId.removeExtra(PENDING_INTENT_ID_INTENT_KEY);
    forged.add(withoutId);
    Intent withoutNotification = new Intent(other);
    withoutNotification.removeExtra("notification");
    forged.add(withoutNotification);
    forged.add(new Intent(other).replaceExtras((Bundle) null));
    forged.add(new Intent(other).setAction(null));
    forged.add(new Intent(other).setAction(Intent.ACTION_VIEW));
    forged.add(
        new UnreadableExtrasIntent()
            .setClass(context, FullScreenNotificationActivity.class)
            .setAction(other.getAction()));
    for (Intent intent : forged) {
      runReceiver(intent);
    }

    assertInitialNotification(getInitialNotification(null), "full-screen", null);
    assertNull(getInitialNotification(null));
    assertTrue(events.taps.isEmpty());
    // The other launch is still a valid one.
    runReceiver(fullScreenReceiverIntent(otherFlow));
    assertInitialNotification(getInitialNotification(null), "other", null);
    assertNull(getInitialNotification(null));
  }

  @Test
  public void fsReceiver_launchDeliveredAgain_isReturnedOnce() throws Exception {
    Intent[] flow = fullScreenFlow("full-screen");
    runReceiver(fullScreenReceiverIntent(flow));
    // Started again on top of an existing receiver (SINGLE_TOP | CLEAR_TOP): onNewIntent().
    ActivityController<FullScreenNotificationActivity> receiver =
        Robolectric.buildActivity(FullScreenNotificationActivity.class, new Intent()).create();
    receiver.newIntent(fullScreenReceiverIntent(flow));
    assertTrue(receiver.get().isFinishing());

    assertInitialNotification(getInitialNotification(null), "full-screen", null);
    assertNull(getInitialNotification(null));

    // Once read, never again: in this process, or in a later one.
    runReceiver(fullScreenReceiverIntent(flow));
    receiver.newIntent(fullScreenReceiverIntent(flow));
    assertNull(getInitialNotification(null));
    simulateProcessDeath();
    runReceiver(fullScreenReceiverIntent(flow));
    assertNull(getInitialNotification(null));
  }

  @Test
  public void fsReceiver_existingReceiverGivenTheLaunch_recordsIt() throws Exception {
    ActivityController<FullScreenNotificationActivity> receiver =
        Robolectric.buildActivity(FullScreenNotificationActivity.class, new Intent()).create();

    receiver.newIntent(fullScreenReceiverIntent(fullScreenFlow("full-screen")));

    assertInitialNotification(getInitialNotification(null), "full-screen", null);
    assertNull(getInitialNotification(null));
  }

  @Test
  public void fsReceiver_launchRecordedWhileTheRecordedOneIsClaimed_isKept() throws Exception {
    Intent[] flowA = fullScreenFlow("full-screen-A");
    Intent receiverB = fullScreenReceiverIntent(fullScreenFlow("full-screen-B"));
    ActivityController<FullScreenNotificationActivity> receiver =
        Robolectric.buildActivity(
                FullScreenNotificationActivity.class, fullScreenReceiverIntent(flowA))
            .create();
    CountDownLatch claiming = new CountDownLatch(1);
    CountDownLatch recorded = new CountDownLatch(1);
    ExecutorService executor = Executors.newSingleThreadExecutor();
    try {
      // A read claims A; it is held right after the claim, while B is recorded.
      Future<Bundle> read =
          executor.submit(
              () -> {
                try (MockedStatic<InitialNotificationLedger> ledger =
                    mockStatic(InitialNotificationLedger.class, Mockito.CALLS_REAL_METHODS)) {
                  ledger
                      .when(() -> InitialNotificationLedger.claimFullScreenLaunch(anyString()))
                      .thenAnswer(
                          invocation -> {
                            Object claimed = invocation.callRealMethod();
                            claiming.countDown();
                            // Bounded: a recording that waits for this read cannot signal.
                            recorded.await(500, TimeUnit.MILLISECONDS);
                            return claimed;
                          });
                  return getInitialNotification(null);
                }
              });
      assertTrue(claiming.await(5, TimeUnit.SECONDS));
      receiver.newIntent(receiverB);
      recorded.countDown();

      assertInitialNotification(read.get(5, TimeUnit.SECONDS), "full-screen-A", null);
    } finally {
      executor.shutdownNow();
    }
    assertInitialNotification(getInitialNotification(null), "full-screen-B", null);
    assertNull(getInitialNotification(null));
  }

  @Test
  public void fsReceiver_launchReturnedThroughItsActivityIntentFirst_isNotRecorded()
      throws Exception {
    Intent[] flow = fullScreenFlow("full-screen", DefaultLaunchActivity.class);
    Activity activity = launch(DefaultLaunchActivity.class, fullScreenLaunchIntent(flow)).get();
    assertInitialNotification(getInitialNotification(activity), "full-screen", null);

    runReceiver(fullScreenReceiverIntent(flow));

    assertNull(getInitialNotification(activity));
    assertNull(getInitialNotification(null));
  }

  // --- Full-screen PendingIntent ---

  @Test
  public void fsPendingIntent_startsReceiverThenConsumer() throws Exception {
    NotificationModel model = fullScreenNotification("full-screen", "FullScreenComponent");
    ShadowPendingIntent shadowPendingIntent = Shadows.shadowOf(display(model).fullScreenIntent);

    assertTrue(shadowPendingIntent.isActivity());
    assertEquals((int) model.getHashCode(), shadowPendingIntent.getRequestCode());
    assertEquals(
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE,
        shadowPendingIntent.getFlags());
    Intent[] saved = shadowPendingIntent.getSavedIntents();
    assertEquals(1, saved.length);
    Intent receiverIntent = saved[0];
    assertEquals(
        new ComponentName(context, FullScreenNotificationActivity.class),
        receiverIntent.getComponent());
    assertEquals(FULL_SCREEN_LAUNCH_ACTION, receiverIntent.getAction());
    assertEquals(
        Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_MULTIPLE_TASK,
        receiverIntent.getFlags());
    assertEquals(4, receiverIntent.getExtras().size());
    Intent destination =
        receiverIntent.getParcelableExtra(FullScreenNotificationActivity.LAUNCH_INTENT);
    assertNotNull(destination);
    assertEquals(
        new ComponentName(context, DefaultLaunchActivity.class), destination.getComponent());
    assertNull(destination.getAction());
    assertEquals(Intent.FLAG_ACTIVITY_NEW_TASK, destination.getFlags());
    assertNull("single payload source in the carrier", destination.getExtras());
    assertEquals("FullScreenComponent", receiverIntent.getStringExtra("mainComponent"));
    assertEquals("full-screen", receiverIntent.getBundleExtra("notification").getString("id"));
    assertNotNull(receiverIntent.getStringExtra(PENDING_INTENT_ID_INTENT_KEY));
    runReceiver(receiverIntent);
    Intent launched =
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedActivity();
    assertNotNull("the capture callback must launch its consumer itself", launched);
    assertEquals(destination.getComponent(), launched.getComponent());
    assertEquals(destination.getFlags(), launched.getFlags());
    assertEquals(3, launched.getExtras().size());
    assertFalse(launched.hasExtra(FullScreenNotificationActivity.LAUNCH_INTENT));
    assertEquals("full-screen", launched.getBundleExtra("notification").getString("id"));
    assertInitialNotification(getInitialNotification(null), "full-screen", null);
  }

  @Test
  public void fsPendingIntent_launchActivityFlags_areKeptOnTheLaunchIntent() throws Exception {
    // launchActivityFlags indexes: 1 SINGLE_TOP, 2 NEW_TASK, 3 MULTIPLE_TASK, 4 CLEAR_TOP,
    // 16 CLEAR_TASK.
    assertFullScreenLaunchFlags("none", flagIndexes(), Intent.FLAG_ACTIVITY_NEW_TASK);
    assertFullScreenLaunchFlags(
        "single-top",
        flagIndexes(1),
        Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
    assertFullScreenLaunchFlags(
        "clear-top",
        flagIndexes(1, 4),
        Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_NEW_TASK);
    assertFullScreenLaunchFlags(
        "clear-task",
        flagIndexes(2, 16),
        Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
    assertFullScreenLaunchFlags(
        "multiple-task",
        flagIndexes(2, 3),
        Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_MULTIPLE_TASK);
  }

  @Test
  public void fsPendingIntent_withoutMainComponent_isUnchanged() throws Exception {
    Bundle fullScreenAction = pressAction("default", "default", null);
    fullScreenAction.putIntegerArrayList("launchActivityFlags", flagIndexes(1));
    NotificationModel model = fullScreenNotification("legacy", fullScreenAction, new Bundle());
    ShadowPendingIntent shadowPendingIntent = Shadows.shadowOf(display(model).fullScreenIntent);

    assertEquals(1, shadowPendingIntent.getSavedIntents().length);
    assertEquals((int) model.getHashCode(), shadowPendingIntent.getRequestCode());
    assertEquals(
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE,
        shadowPendingIntent.getFlags());
    Intent launchIntent = shadowPendingIntent.getSavedIntent();
    assertEquals(
        new ComponentName(context, DefaultLaunchActivity.class), launchIntent.getComponent());
    assertEquals(Intent.FLAG_ACTIVITY_SINGLE_TOP, launchIntent.getFlags());
    assertNull(launchIntent.getExtras());
  }

  @Test
  public void fsPendingIntent_customLaunchActivity_isCreatedAfterCapture() throws Exception {
    Intent[] flow = fullScreenFlow("custom", SetIntentLaunchActivity.class);
    assertEquals(
        new ComponentName(context, SetIntentLaunchActivity.class),
        fullScreenLaunchIntent(flow).getComponent());

    ActivityController<SetIntentLaunchActivity> controller =
        launchFromFullScreen(SetIntentLaunchActivity.class, flow);

    assertInitialNotification(getInitialNotification(controller.get()), "custom", null);
    assertNull(getInitialNotification(controller.get()));
  }

  @Test
  public void fsPendingIntent_redisplayedNotification_updatesItsPendingIntent() throws Exception {
    android.app.NotificationManager notificationManager = nativeNotificationManager();
    NotificationModel first = fullScreenNotification("full-screen", "FullScreenComponent");
    NotificationManager.displayNotification(first, null).get(5, TimeUnit.SECONDS);
    PendingIntent firstPendingIntent =
        Shadows.shadowOf(notificationManager).getNotification(first.getHashCode()).fullScreenIntent;
    String firstId =
        Shadows.shadowOf(firstPendingIntent)
            .getSavedIntent()
            .getStringExtra(PENDING_INTENT_ID_INTENT_KEY);

    // Same notification id: same request code and last Intent, so FLAG_UPDATE_CURRENT updates it.
    NotificationModel second = fullScreenNotification("full-screen", "FullScreenComponent");
    NotificationManager.displayNotification(second, null).get(5, TimeUnit.SECONDS);
    PendingIntent secondPendingIntent =
        Shadows.shadowOf(notificationManager)
            .getNotification(second.getHashCode())
            .fullScreenIntent;

    assertSame(firstPendingIntent, secondPendingIntent);
    Intent primaryIntent = fullScreenLaunchIntent(secondPendingIntent);
    assertNotEquals(firstId, primaryIntent.getStringExtra(PENDING_INTENT_ID_INTENT_KEY));
    Activity activity =
        launchFromFullScreen(DefaultLaunchActivity.class, fullScreenFlow(secondPendingIntent))
            .get();
    assertInitialNotification(getInitialNotification(activity), "full-screen", null);
    assertNull(getInitialNotification(activity));
    // The first display was never launched.
    assertEquals(1, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());
  }

  @Test
  public void fsPendingIntent_isNotATapPendingIntentWithTheSameRequestCode() throws Exception {
    NotificationModel model = fullScreenNotification("full-screen", "FullScreenComponent");
    // A tap PendingIntent whose random request code is the full-screen notification's.
    Intent[] tapFlow = launchFlow(display(pressNotification("tap")).contentIntent);
    String tapPendingIntentId = tapFlow[1].getStringExtra(PENDING_INTENT_ID_INTENT_KEY);
    PendingIntent tap =
        PendingIntent.getActivities(
            context,
            model.getHashCode(),
            new Intent[] {new Intent(tapFlow[0]), new Intent(tapFlow[1])},
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);

    Notification notification = display(model);

    assertNotSame(tap, notification.fullScreenIntent);
    assertNotSame(notification.contentIntent, notification.fullScreenIntent);
    Intent tapReceiverIntent = launchFlow(tap)[1];
    assertNull(tapReceiverIntent.getAction());
    assertEquals(
        tapPendingIntentId, tapReceiverIntent.getStringExtra(PENDING_INTENT_ID_INTENT_KEY));
    assertEquals(
        NotificationEvent.TYPE_PRESS, tapReceiverIntent.getIntExtra(EVENT_TYPE_INTENT_KEY, 0));
    assertEquals("tap", tapReceiverIntent.getBundleExtra("notification").getString("id"));
  }

  @Test
  public void fsNotification_fullScreenLaunchAndTaps_areEachReturnedOnceWithTheirEvents()
      throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    NotificationEventRecorder events = recordTapEvents();
    Bundle action = new Bundle();
    action.putString("title", "Answer");
    action.putBundle("pressAction", pressAction("answer", "default", null));
    ArrayList<Bundle> actions = new ArrayList<>();
    actions.add(action);
    Bundle androidBundle = new Bundle();
    androidBundle.putParcelableArrayList("actions", actions);
    Notification notification =
        display(
            fullScreenNotification(
                "call",
                pressAction("default", ReactLaunchActivity.class.getName(), "CallComponent"),
                androidBundle));

    deliverFullScreen(controller, fullScreenFlow(notification.fullScreenIntent));
    assertInitialNotification(jsGetInitialNotification(), "call", null);
    assertTrue(events.taps.isEmpty());

    controller.newIntent(tap(launchFlow(notification.contentIntent)));
    assertInitialNotification(jsGetInitialNotification(), "call", "default");
    controller.newIntent(tapWithInput(launchFlow(notification.actions[0].actionIntent), "Hi"));
    Bundle actionPress = jsGetInitialNotification();
    assertInitialNotification(actionPress, "call", "answer");
    assertEquals("Hi", actionPress.getString("input"));
    assertNull(jsGetInitialNotification());
    assertEquals(2, events.taps.size());
    assertEquals(NotificationEvent.TYPE_PRESS, events.taps.get(0).getType());
    assertEquals(NotificationEvent.TYPE_ACTION_PRESS, events.taps.get(1).getType());
  }

  private void assertFullScreenLaunchFlags(
      String id, ArrayList<Integer> launchActivityFlags, int expectedFlags) throws Exception {
    Bundle fullScreenAction = pressAction("default", "default", "FullScreenComponent");
    fullScreenAction.putIntegerArrayList("launchActivityFlags", launchActivityFlags);
    Intent[] flow =
        fullScreenFlow(
            display(fullScreenNotification(id, fullScreenAction, new Bundle())).fullScreenIntent);

    assertEquals(id, expectedFlags, fullScreenLaunchIntent(flow).getFlags());
    assertEquals(
        id,
        Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_MULTIPLE_TASK,
        fullScreenReceiverIntent(flow).getFlags());
    runReceiver(fullScreenReceiverIntent(flow));
    Intent actual = Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedActivity();
    assertNotNull(actual);
    assertEquals(id, expectedFlags, actual.getFlags());
    assertEquals(fullScreenLaunchIntent(flow).getComponent(), actual.getComponent());
    assertEquals(3, actual.getExtras().size());
  }

  private static ArrayList<Integer> flagIndexes(Integer... indexes) {
    ArrayList<Integer> flags = new ArrayList<>();
    Collections.addAll(flags, indexes);
    return flags;
  }

  // --- Strict latest-wins regression witnesses ---

  /** RR-1a: latest-wins, read once at startup, then process death and restore. */
  @Test
  public void rr1a_supersededCreationLaunch_afterProcessDeathRestore() throws Exception {
    // Call C cold-starts the Activity; call D reaches it before React exists (W0).
    ActivityController<ReactLaunchActivity> controller =
        launchFromFullScreen(ReactLaunchActivity.class, fullScreenFlow("call-C"));
    deliverFullScreen(controller, fullScreenFlow("call-D"));
    startReactInstance(controller.get());
    assertInitialNotification(jsGetInitialNotification(), "call-D", null);

    // Hours later: backgrounded, process killed, task restored from Recents with its creation
    // Intent (call C).
    Bundle savedState = moveToBackground(controller);
    simulateProcessDeath();
    ActivityController<ReactLaunchActivity> restored =
        restoreController(
            ReactLaunchActivity.class, new Intent(controller.get().getIntent()), savedState);
    startReactInstance(restored.get());
    Bundle afterRestore = jsGetInitialNotification();
    assertNull("superseded call-C must not surface after restore", afterRestore);
  }

  /** RR-1b: the same within one process, on a second read (remount, JS reload, recreation). */
  @Test
  public void rr1b_supersededCreationLaunch_onSecondReadSameProcess() throws Exception {
    ActivityController<ReactLaunchActivity> controller =
        launchFromFullScreen(ReactLaunchActivity.class, fullScreenFlow("call-C"));
    deliverFullScreen(controller, fullScreenFlow("call-D"));
    startReactInstance(controller.get());
    assertInitialNotification(jsGetInitialNotification(), "call-D", null);
    Bundle second = jsGetInitialNotification();
    assertNull("superseded call-C must not be returned after call-D", second);
  }

  /** RR-1c control: the same two launches, both received while the Activity already exists. */
  @Test
  public void rr1c_control_supersededLaunchOnExistingActivity_isNotReturned() throws Exception {
    startReactInstance();
    ActivityController<ReactLaunchActivity> controller =
        launch(ReactLaunchActivity.class, launcherIntent());
    deliverFullScreen(controller, fullScreenFlow("call-C"));
    deliverFullScreen(controller, fullScreenFlow("call-D"));
    assertInitialNotification(jsGetInitialNotification(), "call-D", null);
    assertNull(jsGetInitialNotification());
    Bundle savedState = moveToBackground(controller);
    simulateProcessDeath();
    ActivityController<ReactLaunchActivity> restored =
        restoreController(ReactLaunchActivity.class, launcherIntent(), savedState);
    startReactInstance(restored.get());
    assertNull(jsGetInitialNotification());
  }

  @Test
  @Config(sdk = {28, 34, 37})
  public void rr01_replacedLaunchIsRetiredBeforeReadingTheReplacement() throws Exception {
    Intent[] flowC = fullScreenFlow("call-C");
    ActivityController<ReactLaunchActivity> controller =
        launchFromFullScreen(ReactLaunchActivity.class, flowC);
    deliverFullScreen(controller, fullScreenFlow("call-D"));
    Bundle savedState = moveToBackground(controller);
    Intent creationIntent = new Intent(controller.get().getIntent());

    // The replacement's in-memory payload may be lost here. The retired C must stay retired.
    simulateProcessDeath();
    ActivityController<ReactLaunchActivity> restored =
        restoreController(ReactLaunchActivity.class, creationIntent, savedState);
    startReactInstance(restored.get());
    assertNull(jsGetInitialNotification());
    runReceiver(fullScreenReceiverIntent(flowC));
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void rr01_replacementAfterProcessDeath_retiresTheRestoredCreationLaunch()
      throws Exception {
    Intent[] flowC = fullScreenFlow("call-C");
    ActivityController<ReactLaunchActivity> controller =
        launchFromFullScreen(ReactLaunchActivity.class, flowC);
    Bundle savedState = moveToBackground(controller);
    Intent creationIntent = new Intent(controller.get().getIntent());
    simulateProcessDeath();
    ActivityController<ReactLaunchActivity> restored =
        restoreController(ReactLaunchActivity.class, creationIntent, savedState);

    // No in-memory capture of C survives. D still has to replace it permanently.
    deliverFullScreen(restored, fullScreenFlow("call-D"));
    startReactInstance(restored.get());
    assertInitialNotification(jsGetInitialNotification(), "call-D", null);
    assertNull(jsGetInitialNotification());
    savedState = moveToBackground(restored);
    simulateProcessDeath();
    restored = restoreController(ReactLaunchActivity.class, creationIntent, savedState);
    startReactInstance(restored.get());
    assertNull(jsGetInitialNotification());
    runReceiver(fullScreenReceiverIntent(flowC));
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void rr01_replacementPreservesNotificationsThatHaveNotLaunched() throws Exception {
    ActivityController<ReactLaunchActivity> controller =
        launchFromFullScreen(ReactLaunchActivity.class, fullScreenFlow("call-C"));
    Intent[] unlaunched = fullScreenFlow("not-launched-yet");
    Intent[] replacement = fullScreenFlow("call-D");
    deliverFullScreen(controller, replacement);
    // Repeated delivery of D must not retire D itself.
    deliverFullScreen(controller, replacement);
    startReactInstance(controller.get());
    assertInitialNotification(jsGetInitialNotification(), "call-D", null);
    assertNull(jsGetInitialNotification());
    assertEquals(1, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());
    deliverFullScreen(controller, unlaunched);
    assertInitialNotification(jsGetInitialNotification(), "not-launched-yet", null);
    assertNull(jsGetInitialNotification());
    assertEquals(0, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());
  }

  @Test
  public void rr01_failedReplacementIsRetriedAtReadWithoutRedelivery() throws Exception {
    Intent[] flowC = fullScreenFlow("call-C");
    ActivityController<ReactLaunchActivity> controller =
        launchFromFullScreen(ReactLaunchActivity.class, flowC);
    Intent[] replacement = fullScreenFlow("call-D");
    withFailingPreferenceWrites(
        () -> {
          runReceiver(fullScreenReceiverIntent(replacement));
          return null;
        });
    // C is retired in memory; D's payload is kept and its next claim persists both changes.
    assertEquals(1, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());
    startReactInstance(controller.get());
    assertInitialNotification(jsGetInitialNotification(), "call-D", null);
    assertNull(jsGetInitialNotification());
    Bundle state = moveToBackground(controller);
    simulateProcessDeath();
    ActivityController<ReactLaunchActivity> restored =
        restoreController(
            ReactLaunchActivity.class, new Intent(controller.get().getIntent()), state);
    startReactInstance(restored.get());
    assertNull(jsGetInitialNotification());
    runReceiver(fullScreenReceiverIntent(flowC));
    assertNull(jsGetInitialNotification());
  }

  // --- Independent review regression witnesses ---
  @Test
  public void independent_failedReplacementReturnsLatestAfterStorageRecoveryWithoutRedelivery()
      throws Exception {
    ActivityController<ReactLaunchActivity> host =
        launchFromFullScreen(ReactLaunchActivity.class, fullScreenFlow("call-C"));
    Intent[] d = fullScreenFlow("call-D");
    withFailingPreferenceWrites(
        () -> {
          deliverFullScreen(host, d);
          return null;
        });
    startReactInstance(host.get());
    Bundle first = jsGetInitialNotification();
    assertInitialNotification(first, "call-D", null);
    assertNull(jsGetInitialNotification());
  }

  @Test
  public void independent_failedReplacementCanReturnDThenResurrectCThroughActivityFallback()
      throws Exception {
    Intent[] c = fullScreenFlow("call-C", SetIntentLaunchActivity.class);
    ActivityController<SetIntentLaunchActivity> host =
        launchFromFullScreen(SetIntentLaunchActivity.class, c);
    Bundle state = moveToBackground(host);
    Intent creation = new Intent(host.get().getIntent());
    simulateProcessDeath();
    host = restoreController(SetIntentLaunchActivity.class, creation, state);
    Intent[] d = fullScreenFlow("call-D", SetIntentLaunchActivity.class);
    final ActivityController<SetIntentLaunchActivity> restored = host;
    withFailingPreferenceWrites(
        () -> {
          deliverFullScreen(restored, d);
          return null;
        });
    Bundle first = getInitialNotification(host.get());
    assertInitialNotification(first, "call-D", null);
    state = moveToBackground(host);
    simulateProcessDeath();
    Activity afterDeath = restore(SetIntentLaunchActivity.class, creation, state);
    Bundle replay = getInitialNotification(afterDeath);
    assertNull("C was superseded by valid D before D was returned", replay);
  }

  @Test
  public void independent_failedTapClaimMustNotReplayAfterProcessDeath() throws Exception {
    Intent[] flow = launchFlow(display(pressNotification("tap-A")).contentIntent);
    ActivityController<DefaultLaunchActivity> host = launch(DefaultLaunchActivity.class, tap(flow));
    assertTrue(
        context
            .getSharedPreferences("app.notifee.core.initial_notification", Context.MODE_PRIVATE)
            .edit()
            .putLong("independent-witness-flush", 1)
            .commit());
    List<Bundle> delivered = new ArrayList<>();
    withFailingPreferenceWrites(
        () -> {
          collect(delivered, getInitialNotification(host.get()));
          return null;
        });
    Bundle state = moveToBackground(host);
    simulateProcessDeath();
    Activity afterDeath = restore(DefaultLaunchActivity.class, new Intent(flow[0]), state);
    collect(delivered, getInitialNotification(afterDeath));
    assertDeliveredOnce(delivered, "tap-A");
  }

  @Test
  public void independent_nominalPersistentReplacementAcrossTwoProcessDeaths() throws Exception {
    Intent[] c = fullScreenFlow("call-C");
    ActivityController<ReactLaunchActivity> host =
        launchFromFullScreen(ReactLaunchActivity.class, c);
    Intent creation = new Intent(host.get().getIntent());
    Bundle state = moveToBackground(host);
    simulateProcessDeath();
    host = restoreController(ReactLaunchActivity.class, creation, state);
    deliverFullScreen(host, fullScreenFlow("call-D"));
    state = moveToBackground(host);
    simulateProcessDeath();
    host = restoreController(ReactLaunchActivity.class, creation, state);
    assertNull(getInitialNotification(host.get()));
    runReceiver(fullScreenReceiverIntent(c));
    assertNull(getInitialNotification(host.get()));
  }

  @Test
  public void independent_failedRecoveredTapIntentClaimMustNotReplayAfterProcessDeath()
      throws Exception {
    Intent[] flow = launchFlow(display(pressNotification("tap-A")).contentIntent);
    ActivityController<DefaultLaunchActivity> host = launch(DefaultLaunchActivity.class, tap(flow));
    assertTrue(
        context
            .getSharedPreferences("app.notifee.core.initial_notification", Context.MODE_PRIVATE)
            .edit()
            .putLong("independent-witness-flush", 1)
            .commit());
    Bundle state = moveToBackground(host);
    simulateProcessDeath();
    final ActivityController<DefaultLaunchActivity> restored =
        restoreController(DefaultLaunchActivity.class, new Intent(flow[0]), state);
    List<Bundle> delivered = new ArrayList<>();
    withFailingPreferenceWrites(
        () -> {
          collect(delivered, getInitialNotification(restored.get()));
          return null;
        });
    state = moveToBackground(restored);
    simulateProcessDeath();
    collect(
        delivered,
        getInitialNotification(restore(DefaultLaunchActivity.class, new Intent(flow[0]), state)));
    assertDeliveredOnce(delivered, "tap-A");
  }

  @Test
  public void storage_failedTapClaim_keepsActionInputUntilTheReadCanBePersisted() throws Exception {
    Intent[] flow =
        launchFlow(
            display(actionNotification("reply", pressAction("answer", "default", null)))
                .actions[0]
                .actionIntent);
    ActivityController<DefaultLaunchActivity> host =
        launch(DefaultLaunchActivity.class, tapWithInput(flow, "Keep this reply"));
    withFailingPreferenceWrites(
        () -> {
          assertNull(getInitialNotification(host.get()));
          assertNull(getInitialNotification(host.get()));
          return null;
        });
    Bundle result = getInitialNotification(host.get());
    assertInitialNotification(result, "reply", "answer");
    assertEquals("Keep this reply", result.getString("input"));
    assertNull(getInitialNotification(host.get()));
    Bundle state = moveToBackground(host);
    simulateProcessDeath();
    assertNull(
        getInitialNotification(restore(DefaultLaunchActivity.class, new Intent(flow[0]), state)));
  }

  @Test
  public void storage_unreadableTapClaim_keepsTheStickyPayloadForRecovery() throws Exception {
    Intent[] flow = launchFlow(display(pressNotification("tap")).contentIntent);
    Activity host = launch(DefaultLaunchActivity.class, tap(flow)).get();
    SharedPreferences preferences =
        context.getSharedPreferences("app.notifee.core.initial_notification", Context.MODE_PRIVATE);
    assertTrue(preferences.edit().putString("claimed_tap_sequence", "unreadable").commit());
    assertNull(getInitialNotification(host));
    assertTrue(preferences.edit().putLong("claimed_tap_sequence", 0).commit());
    assertInitialNotification(getInitialNotification(host), "tap", "default");
    assertNull(getInitialNotification(host));
  }

  @Test
  public void storage_aNewTapBetweenClaimAndStickyRemoval_isPreserved() throws Exception {
    Intent[] a = launchFlow(display(pressNotification("A")).contentIntent);
    Intent[] b = launchFlow(display(pressNotification("B")).contentIntent);
    Activity host = launch(DefaultLaunchActivity.class, tap(a)).get();
    try (MockedStatic<InitialNotificationLedger> ledger =
        mockStatic(InitialNotificationLedger.class, Mockito.CALLS_REAL_METHODS)) {
      ledger
          .when(() -> InitialNotificationLedger.claimTap(org.mockito.ArgumentMatchers.anyLong()))
          .thenAnswer(
              invocation -> {
                Object result = invocation.callRealMethod();
                runReceiver(b);
                return result;
              });
      assertInitialNotification(getInitialNotification(host), "A", "default");
    }
    assertInitialNotification(getInitialNotification(host), "B", "default");
    assertNull(getInitialNotification(host));
  }

  @Test
  public void storage_failedFullScreenReplacements_keepOnlyLatestAndRetryAtRead() throws Exception {
    ActivityController<ReactLaunchActivity> host =
        launchFromFullScreen(ReactLaunchActivity.class, fullScreenFlow("C"));
    Intent[] d = fullScreenFlow("D");
    Intent[] e = fullScreenFlow("E");
    withFailingPreferenceWrites(
        () -> {
          deliverFullScreen(host, d);
          assertNull(getInitialNotification(host.get()));
          deliverFullScreen(host, e);
          assertNull(getInitialNotification(host.get()));
          return null;
        });
    assertInitialNotification(getInitialNotification(host.get()), "E", null);
    assertNull(getInitialNotification(host.get()));
    Bundle state = moveToBackground(host);
    simulateProcessDeath();
    assertNull(
        getInitialNotification(
            restore(ReactLaunchActivity.class, new Intent(host.get().getIntent()), state)));
    runReceiver(fullScreenReceiverIntent(d));
    assertNull(getInitialNotification(null));
  }

  @Test
  public void storage_failedReplacementLostWithProcess_preservesTheDurableCreationLaunch()
      throws Exception {
    Intent[] c = fullScreenFlow("call-C");
    ActivityController<ReactLaunchActivity> host =
        launchFromFullScreen(ReactLaunchActivity.class, c);
    Intent creation = new Intent(host.get().getIntent());
    Intent[] d = fullScreenFlow("call-D");
    String durableBefore = initialNotificationLedgerOnDisk();
    try (MockedStatic<Logger> logger = mockStatic(Logger.class, Mockito.CALLS_REAL_METHODS)) {
      withFailingPreferenceWrites(
          () -> {
            deliverFullScreen(host, d);
            return null;
          });
      logger.verify(
          () ->
              Logger.w(
                  "InitialNotificationLedger", "Failed to persist full-screen launch replacement"));
    }
    assertEquals(durableBefore, initialNotificationLedgerOnDisk());
    assertEquals(1, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());
    Bundle state = moveToBackground(host);
    simulateProcessDeath();
    assertEquals(durableBefore, initialNotificationLedgerOnDisk());
    Activity restored = restore(ReactLaunchActivity.class, creation, state);
    // PO: with no durable evidence of D, preserve the legitimate unread creation launch.
    assertInitialNotification(getInitialNotification(restored), "call-C", null);
    assertNull(getInitialNotification(restored));
  }

  @Test
  public void storage_multipleUnpersistedReplacementsLostWithProcess_preserveDurableRecovery()
      throws Exception {
    Intent[] c = fullScreenFlow("call-C");
    ActivityController<ReactLaunchActivity> host =
        launchFromFullScreen(ReactLaunchActivity.class, c);
    Intent creation = new Intent(host.get().getIntent());
    Intent[] d = fullScreenFlow("call-D");
    Intent[] e = fullScreenFlow("call-E");
    String durableBefore = initialNotificationLedgerOnDisk();
    try (MockedStatic<Logger> logger = mockStatic(Logger.class, Mockito.CALLS_REAL_METHODS)) {
      withFailingPreferenceWrites(
          () -> {
            deliverFullScreen(host, d);
            deliverFullScreen(host, e);
            return null;
          });
      logger.verify(
          () ->
              Logger.w(
                  "InitialNotificationLedger", "Failed to persist full-screen launch replacement"),
          Mockito.times(2));
    }
    assertEquals(durableBefore, initialNotificationLedgerOnDisk());
    assertEquals(1, InitialNotificationLedger.unclaimedFullScreenLaunchCountForTesting());
    Bundle state = moveToBackground(host);
    simulateProcessDeath();
    assertEquals(durableBefore, initialNotificationLedgerOnDisk());
    Activity restored = restore(ReactLaunchActivity.class, creation, state);
    assertInitialNotification(getInitialNotification(restored), "call-C", null);
    assertNull(getInitialNotification(restored));
  }

  @Test
  public void storage_successfulWriteAfterFailedReplacement_preventsResurrectionWithoutARead()
      throws Exception {
    ActivityController<ReactLaunchActivity> host =
        launchFromFullScreen(ReactLaunchActivity.class, fullScreenFlow("call-C"));
    Intent creation = new Intent(host.get().getIntent());
    Intent[] d = fullScreenFlow("call-D");
    withFailingPreferenceWrites(
        () -> {
          deliverFullScreen(host, d);
          return null;
        });
    // SharedPreferences commits the full in-memory map. Any successful write supplies the proof
    // that excludes the PO exception, even though D has never been read.
    assertTrue(
        context
            .getSharedPreferences("app.notifee.core.initial_notification", Context.MODE_PRIVATE)
            .edit()
            .putBoolean("successful-write-witness", true)
            .commit());
    Bundle state = moveToBackground(host);
    simulateProcessDeath();
    Activity restored = restore(ReactLaunchActivity.class, creation, state);
    assertNull(getInitialNotification(restored));
    assertNull(getInitialNotification(restored));
  }

  private String initialNotificationLedgerOnDisk() throws Exception {
    return new String(
        java.nio.file.Files.readAllBytes(
            new File(context.getDataDir(), "shared_prefs/app.notifee.core.initial_notification.xml")
                .toPath()),
        java.nio.charset.StandardCharsets.UTF_8);
  }

  @Test
  @Config(sdk = {26, 27, 28, 31, 33, 36, 37})
  public void rr02_fullScreenHasOnePrivateNoDisplayCaptureTarget() throws Exception {
    PendingIntent pending =
        display(fullScreenNotification("lock-screen", "FullScreenComponent")).fullScreenIntent;
    Intent[] saved = Shadows.shadowOf(pending).getSavedIntents();
    assertEquals(1, saved.length);
    assertEquals(
        new ComponentName(context, FullScreenNotificationActivity.class), saved[0].getComponent());
    assertEquals(
        Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_MULTIPLE_TASK, saved[0].getFlags());
    // Unit fixtures register synthetic Activities without a merged manifest. Inspect the actual
    // library declaration here; APK/PackageManager binding is independently checked at runtime.
    org.w3c.dom.NodeList activities =
        javax.xml.parsers.DocumentBuilderFactory.newInstance()
            .newDocumentBuilder()
            .parse(new File("src/main/AndroidManifest.xml"))
            .getElementsByTagName("activity");
    org.w3c.dom.Element declaration = null;
    for (int i = 0; i < activities.getLength(); i++) {
      org.w3c.dom.Element activity = (org.w3c.dom.Element) activities.item(i);
      if (FullScreenNotificationActivity.class
          .getName()
          .equals(activity.getAttribute("android:name"))) {
        declaration = activity;
      }
    }
    assertNotNull(declaration);
    assertEquals("false", declaration.getAttribute("android:exported"));
    assertEquals("@android:style/Theme.NoDisplay", declaration.getAttribute("android:theme"));
    // A noHistory task may be cancelled before its queued onCreate can capture the launch.
    assertEquals("false", declaration.getAttribute("android:noHistory"));
    assertEquals("true", declaration.getAttribute("android:excludeFromRecents"));
    assertEquals("", declaration.getAttribute("android:taskAffinity"));
    assertEquals("true", declaration.getAttribute("android:showWhenLocked"));
    assertEquals("true", declaration.getAttribute("android:turnScreenOn"));
  }

  @Test
  @Config(sdk = {26, 28, 34, 37})
  public void rr02_coldFullScreenRestoresMainComponentBeforeConsumerCreation() throws Exception {
    Intent[] flow =
        fullScreenFlow(
            display(
                    fullScreenNotification(
                        "cold-component",
                        "IncomingCall",
                        ComponentCheckingLaunchActivity.class.getName()))
                .fullScreenIntent);
    simulateProcessDeath();
    ActivityController<ComponentCheckingLaunchActivity> controller =
        launchFromFullScreen(ComponentCheckingLaunchActivity.class, flow);
    assertEquals("IncomingCall", controller.get().selectedMainComponent);
    assertNull("capture must not require a Notifee TurboModule", notifeeModule);
    assertInitialNotification(getInitialNotification(controller.get()), "cold-component", null);
    assertNull(getInitialNotification(controller.get()));
  }

  @Test
  public void rr02_onlyAValidUnreadFullScreenRestoresMainComponent() throws Exception {
    Intent[] flow = fullScreenFlow("real");
    EventBus.removeStickEvent(MainComponentEvent.class);
    runReceiver(fullScreenReceiverIntent(flow));
    assertEquals("FullScreenComponent", NotifeeApiModule.getMainComponent("DefaultComponent"));
    assertInitialNotification(getInitialNotification(null), "real", null);
    runReceiver(fullScreenReceiverIntent(flow));
    assertEquals("DefaultComponent", NotifeeApiModule.getMainComponent("DefaultComponent"));
    Intent forged = fullScreenReceiverIntent(fullScreenFlow("forged"));
    EventBus.removeStickEvent(MainComponentEvent.class);
    forged.putExtra(PENDING_INTENT_ID_INTENT_KEY, UUID.randomUUID().toString());
    forged.putExtra("mainComponent", "ForgedComponent");
    runReceiver(forged);
    assertEquals("DefaultComponent", NotifeeApiModule.getMainComponent("DefaultComponent"));
  }

  @Test
  public void invalidCapture_malformedNotificationCannotRetireUnreadLaunch() throws Exception {
    for (int variant = 0; variant < 5; variant++) {
      Intent[] c = fullScreenFlow("valid-C-" + variant);
      Intent[] d = fullScreenFlow("valid-D-" + variant);
      runReceiver(fullScreenReceiverIntent(c));
      Intent malformed = new Intent(fullScreenReceiverIntent(d));
      Bundle notification = new Bundle();
      if (variant == 1) notification.putInt("id", 88);
      if (variant == 2) notification.putString("id", null);
      if (variant == 3) notification.putString("id", "");
      if (variant == 4) notification.putBundle("id", new Bundle());
      malformed.putExtra("notification", notification);
      malformed.putExtra("mainComponent", "InvalidComponent");
      Object component = EventBus.getStickyEvent(MainComponentEvent.class);
      runReceiver(malformed);
      assertSame(component, EventBus.getStickyEvent(MainComponentEvent.class));
      assertInitialNotification(getInitialNotification(null), "valid-C-" + variant, null);
      assertNull(getInitialNotification(null));
      // Rejecting the corrupt copy must also preserve the genuine, issued D.
      runReceiver(fullScreenReceiverIntent(d));
      assertInitialNotification(getInitialNotification(null), "valid-D-" + variant, null);
      assertNull(getInitialNotification(null));
    }
  }

  @Test
  @Config(sdk = {26, 28, 33, 37})
  public void runtime_warmCaptureMustBeTheSolePendingIntentTarget() throws Exception {
    PendingIntent pending =
        display(fullScreenNotification("warm-capture", "IncomingCall")).fullScreenIntent;
    Intent[] saved = Shadows.shadowOf(pending).getSavedIntents();
    // A non-top member of getActivities can remain uncreated while the consumer is visible.
    assertEquals("capture must execute before it launches any consumer", 1, saved.length);
    assertEquals(
        "app.notifee.core.FullScreenNotificationActivity", saved[0].getComponent().getClassName());
    assertEquals(FULL_SCREEN_LAUNCH_ACTION, saved[0].getAction());
  }

  @Test
  public void fsPendingIntent_consumerIdentityIsPreservedAndRoutingStaysPrivate() throws Exception {
    NotificationModel a =
        fullScreenNotification("same-id", "ComponentA", DefaultLaunchActivity.class.getName());
    NotificationManager.displayNotification(a, null).get(5, TimeUnit.SECONDS);
    PendingIntent pendingA =
        Shadows.shadowOf(nativeNotificationManager())
            .getNotification(a.getHashCode())
            .fullScreenIntent;
    NotificationModel b =
        fullScreenNotification("same-id", "ComponentB", ReactLaunchActivity.class.getName());
    NotificationManager.displayNotification(b, null).get(5, TimeUnit.SECONDS);
    PendingIntent pendingB =
        Shadows.shadowOf(nativeNotificationManager())
            .getNotification(b.getHashCode())
            .fullScreenIntent;
    assertNotSame(
        "different consumer components must remain different identities", pendingA, pendingB);
    Bundle action = pressAction("default", ReactLaunchActivity.class.getName(), "UpdatedComponent");
    action.putIntegerArrayList("launchActivityFlags", flagIndexes(2, 16));
    NotificationModel updated = fullScreenNotification("same-id", action, new Bundle());
    NotificationManager.displayNotification(updated, null).get(5, TimeUnit.SECONDS);
    PendingIntent current =
        Shadows.shadowOf(nativeNotificationManager())
            .getNotification(updated.getHashCode())
            .fullScreenIntent;
    assertSame(pendingB, current);
    Intent[] flow = fullScreenFlow(current);
    assertEquals(
        android.net.Uri.fromParts("notifee-full-screen", ReactLaunchActivity.class.getName(), null),
        fullScreenReceiverIntent(flow).getData());
    Intent consumer = dispatchFullScreen(flow);
    assertNull(consumer.getData());
    assertNull(consumer.getAction());
    assertEquals(
        Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK, consumer.getFlags());
    assertEquals("UpdatedComponent", consumer.getStringExtra("mainComponent"));
    assertEquals(3, consumer.getExtras().size());
    Bundle result = getInitialNotification(null);
    assertInitialNotification(result, "same-id", null);
    assertEquals(1, result.size());
    assertFalse(
        result.getBundle("notification").containsKey(FullScreenNotificationActivity.LAUNCH_INTENT));
    assertNull(getInitialNotification(null));
  }

  @Test
  public void fullScreenCapture_isCompleteBeforeConsumerStartIsInvoked() throws Exception {
    Intent carrier = fullScreenReceiverIntent(fullScreenFlow("before-dispatch"));
    EventBus.removeStickEvent(MainComponentEvent.class);
    BeforeConsumerDispatchActivity capture =
        Robolectric.buildActivity(BeforeConsumerDispatchActivity.class, carrier).create().get();
    assertEquals("FullScreenComponent", capture.componentAtDispatch);
    assertInitialNotification(capture.initialAtDispatch, "before-dispatch", null);
    assertNull(notifeeModule);
    assertNull(getInitialNotification(null));
    assertTrue(capture.isFinishing());
    int screenFlags =
        android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
    assertEquals(screenFlags, capture.getWindow().getAttributes().flags & screenFlags);
    assertFalse(capture.consumer.hasExtra(FullScreenNotificationActivity.LAUNCH_INTENT));
    assertNull(capture.consumer.getData());
  }

  @Test
  public void fullScreenCapture_missingMalformedOrForeignDestinationCannotRetireC()
      throws Exception {
    for (int variant = 0; variant < 3; variant++) {
      Intent[] c = fullScreenFlow("C-target-" + variant);
      Intent[] d = fullScreenFlow("D-target-" + variant);
      runReceiver(fullScreenReceiverIntent(c));
      Intent invalid = fullScreenReceiverIntent(d);
      if (variant == 0) invalid.removeExtra(FullScreenNotificationActivity.LAUNCH_INTENT);
      if (variant == 1)
        invalid.putExtra(FullScreenNotificationActivity.LAUNCH_INTENT, "not-an-intent");
      if (variant == 2)
        invalid.putExtra(
            FullScreenNotificationActivity.LAUNCH_INTENT,
            new Intent().setComponent(new ComponentName("other.app", "other.app.Target")));
      runReceiver(invalid);
      assertInitialNotification(getInitialNotification(null), "C-target-" + variant, null);
      assertNull(getInitialNotification(null));
      runReceiver(fullScreenReceiverIntent(d));
      assertInitialNotification(getInitialNotification(null), "D-target-" + variant, null);
      assertNull(getInitialNotification(null));
    }
  }

  public static class BeforeConsumerDispatchActivity extends FullScreenNotificationActivity {
    String componentAtDispatch;
    Bundle initialAtDispatch;
    Intent consumer;

    @Override
    public void startActivity(Intent intent) {
      consumer = intent;
      componentAtDispatch = NotifeeApiModule.getMainComponent("MissingComponent");
      Notifee.getInstance()
          .getInitialNotification(null, (error, value) -> initialAtDispatch = value);
    }
  }

  @Test
  public void fullScreenCapture_unresolvableOrDisabledDestinationCannotRetireC() throws Exception {
    for (int variant = 0; variant < 2; variant++) {
      Intent[] c = fullScreenFlow("C-resolution-" + variant);
      Intent[] d = fullScreenFlow("D-resolution-" + variant);
      runReceiver(fullScreenReceiverIntent(c));
      Intent invalid = fullScreenReceiverIntent(d);
      Intent target =
          new Intent(
              (Intent) invalid.getParcelableExtra(FullScreenNotificationActivity.LAUNCH_INTENT));
      invalid.putExtra(FullScreenNotificationActivity.LAUNCH_INTENT, target);
      ComponentName component =
          new ComponentName(context.getPackageName(), "test.UndeclaredActivity");
      if (variant == 1) {
        component = new ComponentName(context, SetIntentLaunchActivity.class);
        context
            .getPackageManager()
            .setComponentEnabledSetting(
                component,
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                android.content.pm.PackageManager.DONT_KILL_APP);
      }
      target.setComponent(component);
      assertNull(context.getPackageManager().resolveActivity(target, 0));
      runReceiver(invalid);
      assertInitialNotification(getInitialNotification(null), "C-resolution-" + variant, null);
      assertNull(getInitialNotification(null));
      if (variant == 1)
        context
            .getPackageManager()
            .setComponentEnabledSetting(
                component,
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
                android.content.pm.PackageManager.DONT_KILL_APP);
      runReceiver(fullScreenReceiverIntent(d));
      assertInitialNotification(getInitialNotification(null), "D-resolution-" + variant, null);
      assertNull(getInitialNotification(null));
    }
  }

  @Test
  public void fullScreenCapture_queuedLaunchUsesNewIntentWhileCarrierIsFinishing()
      throws Exception {
    Intent[] c = fullScreenFlow("queued-C");
    Intent[] d = fullScreenFlow("queued-D");
    ActivityController<FullScreenNotificationActivity> carrier =
        Robolectric.buildActivity(FullScreenNotificationActivity.class, fullScreenReceiverIntent(c))
            .create();
    assertTrue(carrier.get().isFinishing());
    while (Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedActivity()
        != null) {}
    carrier.newIntent(fullScreenReceiverIntent(d));
    // Framework NewIntent callbacks do not replace the Activity's creation Intent.
    assertEquals(
        "queued-C", carrier.get().getIntent().getBundleExtra("notification").getString("id"));
    Intent consumer =
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedActivity();
    assertNotNull(consumer);
    assertEquals("queued-D", consumer.getBundleExtra("notification").getString("id"));
    assertEquals(Intent.FLAG_ACTIVITY_NEW_TASK, consumer.getFlags());
    assertNull(consumer.getData());
    assertFalse(consumer.hasExtra(FullScreenNotificationActivity.LAUNCH_INTENT));
    assertInitialNotification(getInitialNotification(null), "queued-D", null);
    assertNull(getInitialNotification(null));
    simulateProcessDeath();
    Activity oldConsumer = launch(ReactLaunchActivity.class, fullScreenLaunchIntent(c)).get();
    assertNull(getInitialNotification(oldConsumer));
    runReceiver(fullScreenReceiverIntent(d));
    assertNull(getInitialNotification(null));
  }

  // --- Helpers ---

  /**
   * Starts a React instance as React Native 0.85 does in bridgeless mode: a new ReactContext, then
   * the TurboModules that packages declare for eager initialization, created before the JS bundle
   * runs. Other TurboModules are created when JS first uses them.
   */
  private void startReactInstance() {
    startReactInstance(null);
  }

  /** Starts a React instance for {@code host}, already resumed, as ReactHostImpl does. */
  private void startReactInstance(Activity host) {
    createReactContext(host);
    initializeEagerTurboModules();
  }

  /**
   * Creates the ReactContext of a new React instance and moves it to the resumed state of {@code
   * host}, if any. ReactHostImpl creates it before the instance, which only queues the creation of
   * the eager TurboModules: until they exist, the context hands new Intents to the listeners
   * registered so far (W1). Before the context exists, ReactHostImpl drops them (W0).
   */
  private void createReactContext(Activity host) {
    reactContext = new TestReactContext(context);
    ReactLaunchActivity.reactContext = reactContext;
    notifeeModule = null;
    if (host != null) {
      reactContext.onHostResume(host);
    }
  }

  /**
   * ReactInstance#initializeEagerTurboModules: the modules of
   * ReactPackageTurboModuleManagerDelegate#getEagerInitModuleNames.
   */
  private void initializeEagerTurboModules() {
    NotifeePackage notifeePackage = new NotifeePackage();
    for (ReactModuleInfo moduleInfo :
        notifeePackage.getReactModuleInfoProvider().getReactModuleInfos().values()) {
      if (moduleInfo.isTurboModule() && moduleInfo.needsEagerInit()) {
        notifeeModule =
            (NotifeeApiModule) notifeePackage.getModule(moduleInfo.name(), reactContext);
      }
    }
  }

  /** Reloads JS: the instance's modules are invalidated and a new instance hosts the Activity. */
  private TestReactContext reloadReactInstance(Activity activity) {
    TestReactContext previous = reactContext;
    if (notifeeModule != null) {
      notifeeModule.invalidate();
    }
    startReactInstance();
    reactContext.onHostResume(activity);
    return previous;
  }

  /**
   * Calls getInitialNotification() as JS does: through the Notifee TurboModule (created on first
   * use unless the React instance created it), which passes its ReactContext's current Activity.
   */
  private Bundle jsGetInitialNotification() {
    if (notifeeModule == null) {
      notifeeModule =
          (NotifeeApiModule) new NotifeePackage().getModule(NotifeeApiModule.NAME, reactContext);
    }
    Promise promise = mock(Promise.class);
    WritableMap resolvedMap = mock(WritableMap.class);
    List<Bundle> resolvedBundles = new ArrayList<>();
    try (MockedStatic<Arguments> arguments = mockStatic(Arguments.class)) {
      arguments
          .when(() -> Arguments.fromBundle(any(Bundle.class)))
          .thenAnswer(
              invocation -> {
                resolvedBundles.add(invocation.getArgument(0));
                return resolvedMap;
              });
      notifeeModule.getInitialNotification(promise);
    }

    ArgumentCaptor<Object> resolved = ArgumentCaptor.forClass(Object.class);
    verify(promise).resolve(resolved.capture());
    if (resolved.getValue() == null) {
      assertTrue(resolvedBundles.isEmpty());
      return null;
    }
    assertSame(resolvedMap, resolved.getValue());
    assertEquals(1, resolvedBundles.size());
    return resolvedBundles.get(0);
  }

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
   * SharedPreferences, the React instance) is lost, app storage survives and is read again from
   * disk.
   */
  private static void simulateProcessDeath() {
    clearStickyEvents();
    Notifee.resetInitialNotificationStateForTesting();
    ShadowContextImpl.reset();
    ReactLaunchActivity.reactContext = null;
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

  /** Displays a full-screen notification and returns the Intent its launch Activity starts with. */
  private Intent fullScreenIntent(String id) throws Exception {
    return fullScreenLaunchIntent(
        display(fullScreenNotification(id, "FullScreenComponent")).fullScreenIntent);
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

  /** Capture carrier and destination used to drive callbacks; raw PI shape is tested separately. */
  private static Intent[] fullScreenFlow(PendingIntent pendingIntent) {
    assertNotNull("PendingIntent must be present", pendingIntent);
    ShadowPendingIntent shadow = Shadows.shadowOf(pendingIntent);
    assertTrue(shadow.isActivity());
    Intent[] saved = shadow.getSavedIntents();
    assertEquals("full-screen PI must have one target", 1, saved.length);
    Intent carrier = new Intent(saved[0]);
    if (!isReceiverIntent(carrier)) return new Intent[] {carrier}; // unchanged legacy
    Intent destination = carrier.getParcelableExtra(FullScreenNotificationActivity.LAUNCH_INTENT);
    assertNotNull(destination);
    Intent consumer = new Intent(destination).replaceExtras(new Bundle(carrier.getExtras()));
    consumer.removeExtra(FullScreenNotificationActivity.LAUNCH_INTENT);
    return new Intent[] {carrier, consumer};
  }

  /** The Intent a full-screen launch starts its launch Activity with. */
  private static Intent fullScreenLaunchIntent(PendingIntent pendingIntent) {
    return fullScreenLaunchIntent(fullScreenFlow(pendingIntent));
  }

  private static Intent fullScreenLaunchIntent(Intent[] flow) {
    for (Intent intent : flow) {
      if (!isReceiverIntent(intent)) {
        return new Intent(intent);
      }
    }
    throw new AssertionError("full-screen consumer Intent must be present");
  }

  /** The sole capture target; it starts the consumer from its own callback. */
  private static Intent fullScreenReceiverIntent(Intent[] flow) {
    assertEquals("full-screen launch must start the receiver and the app", 2, flow.length);
    for (Intent intent : flow) {
      if (isReceiverIntent(intent)) {
        return new Intent(intent);
      }
    }
    throw new AssertionError("full-screen receiver Intent must be present");
  }

  private static boolean isReceiverIntent(Intent intent) {
    return intent.getComponent() != null
        && FullScreenNotificationActivity.class
            .getName()
            .equals(intent.getComponent().getClassName());
  }

  /** Displays a full-screen notification launching {@code launchActivity}; returns its flow. */
  private Intent[] fullScreenFlow(String id, Class<? extends Activity> launchActivity)
      throws Exception {
    return fullScreenFlow(
        display(fullScreenNotification(id, "FullScreenComponent", launchActivity.getName()))
            .fullScreenIntent);
  }

  /** Displays a full-screen notification launching {@link ReactLaunchActivity}. */
  private Intent[] fullScreenFlow(String id) throws Exception {
    return fullScreenFlow(id, ReactLaunchActivity.class);
  }

  /**
   * Drives the capture callback and then delivery of its destination to an existing consumer. Raw
   * PI and synchronous dispatch are independently asserted by the shape/dispatch witnesses.
   */
  private static void deliverFullScreen(ActivityController<?> host, Intent[] flow) {
    host.newIntent(dispatchFullScreen(flow));
  }

  private static Intent dispatchFullScreen(Intent[] flow) {
    // Use the Intent actually started by production's capture callback, rather than synthesizing
    // delivery of the nested destination when the framework might never execute the capture.
    while (Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedActivity()
        != null) {}
    runReceiver(fullScreenReceiverIntent(flow));
    Intent actual = Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedActivity();
    assertNotNull("capture must synchronously dispatch its consumer", actual);
    assertEquals(fullScreenLaunchIntent(flow).getComponent(), actual.getComponent());
    assertEquals(fullScreenLaunchIntent(flow).getFlags(), actual.getFlags());
    assertFalse(actual.hasExtra(FullScreenNotificationActivity.LAUNCH_INTENT));
    return actual;
  }

  /** Starts the consumer Intent actually dispatched by the capture callback. */
  private static <T extends Activity> ActivityController<T> launchFromFullScreen(
      Class<T> activityClass, Intent[] flow) {
    return launch(activityClass, dispatchFullScreen(flow));
  }

  private static void runReceiver(Intent[] flow) {
    runReceiver(new Intent(flow[1]));
  }

  private static void runReceiver(Intent receiverIntent) {
    if (isReceiverIntent(receiverIntent)) {
      Robolectric.buildActivity(FullScreenNotificationActivity.class, receiverIntent).create();
    } else {
      Robolectric.buildActivity(NotificationReceiverActivity.class, receiverIntent).create();
    }
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
    ShadowNotificationManager shadowNotificationManager =
        Shadows.shadowOf(nativeNotificationManager());
    NotificationManager.displayNotification(notificationModel, null).get(5, TimeUnit.SECONDS);

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
    return fullScreenNotification(id, mainComponent, "default");
  }

  private static NotificationModel fullScreenNotification(
      String id, String mainComponent, String launchActivity) {
    return fullScreenNotification(
        id, pressAction("default", launchActivity, mainComponent), new Bundle());
  }

  private static NotificationModel fullScreenNotification(
      String id, Bundle fullScreenAction, Bundle androidBundle) {
    androidBundle.putString("channelId", CHANNEL_ID);
    androidBundle.putBundle("pressAction", pressAction("default", "default", null));
    androidBundle.putBundle("fullScreenAction", fullScreenAction);
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
   * Default {@code onNewIntent}: {@link #getIntent()} keeps the creation Intent. ReactActivity also
   * hands new Intents to React Native: {@link ReactLaunchActivity}.
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

  /**
   * Launch Activity hosting React Native as ReactActivity does in bridgeless mode (React Native
   * 0.85): its lifecycle and new Intents go to the React instance (ReactDelegate, ReactHostImpl),
   * which hands them to its ReactContext. onNewIntent() calls neither super.onNewIntent() nor
   * setIntent(), so {@link #getIntent()} keeps the creation Intent. Until the React instance has a
   * ReactContext ({@link #reactContext} null), ReactHostImpl drops new Intents.
   */
  public static class ComponentCheckingLaunchActivity extends ReactLaunchActivity {
    String selectedMainComponent;

    @Override
    protected void onCreate(Bundle state) {
      selectedMainComponent = NotifeeApiModule.getMainComponent("DefaultComponent");
      super.onCreate(state);
    }
  }

  public static class ReactLaunchActivity extends Activity {
    static TestReactContext reactContext;

    @Override
    protected void onResume() {
      super.onResume();
      if (reactContext != null) {
        reactContext.onHostResume(this);
      }
    }

    @Override
    protected void onPause() {
      super.onPause();
      if (reactContext != null) {
        reactContext.onHostPause();
      }
    }

    @Override
    protected void onDestroy() {
      super.onDestroy();
      // ReactHostImpl#onHostDestroy(Activity) acts for the current Activity only.
      if (reactContext != null && reactContext.getCurrentActivity() == this) {
        reactContext.onHostDestroy();
      }
    }

    @Override
    protected void onNewIntent(Intent intent) {
      // ReactHostImpl#onNewIntent: handed over with the host's current Activity.
      if (reactContext != null) {
        reactContext.onNewIntent(reactContext.getCurrentActivity(), intent);
      }
    }
  }

  /** React Native host whose app code clears a new Intent's extras once it handled them. */
  public static class ReactExtrasClearingLaunchActivity extends ReactLaunchActivity {
    @Override
    protected void onNewIntent(Intent intent) {
      super.onNewIntent(intent);
      intent.replaceExtras((Bundle) null);
    }
  }

  /** React Native host whose app code also replaces {@link #getIntent()} on every new Intent. */
  public static class ReactSetIntentLaunchActivity extends ReactLaunchActivity {
    @Override
    protected void onNewIntent(Intent intent) {
      super.onNewIntent(intent);
      setIntent(intent);
    }
  }

  /**
   * ReactContext of a bridgeless React instance, limited to Activity events: lifecycle and new
   * Intent dispatch are ReactContext's own, which BridgelessReactContext does not override.
   * Exceptions thrown by listeners are recorded instead of being reported to the ReactHost.
   */
  static class TestReactContext extends ReactApplicationContext {
    final List<Exception> listenerExceptions = Collections.synchronizedList(new ArrayList<>());
    final List<ActivityEventListener> activityEventListeners =
        Collections.synchronizedList(new ArrayList<>());

    TestReactContext(Context context) {
      super(context);
    }

    @Override
    public void addActivityEventListener(ActivityEventListener listener) {
      activityEventListeners.add(listener);
      super.addActivityEventListener(listener);
    }

    @Override
    public void handleException(Exception e) {
      listenerExceptions.add(e);
    }

    @Override
    public boolean isBridgeless() {
      return true;
    }

    @Override
    public boolean hasActiveReactInstance() {
      return true;
    }

    @Override
    public boolean hasReactInstance() {
      return true;
    }

    @Override
    public boolean hasActiveCatalystInstance() {
      return true;
    }

    @Override
    public boolean hasCatalystInstance() {
      return false;
    }

    @Override
    public void destroy() {}

    @Override
    public <T extends JavaScriptModule> T getJSModule(Class<T> jsInterface) {
      throw new UnsupportedOperationException();
    }

    @Override
    public <T extends NativeModule> boolean hasNativeModule(Class<T> nativeModuleInterface) {
      return false;
    }

    @Override
    public Collection<NativeModule> getNativeModules() {
      return Collections.emptyList();
    }

    @Override
    public <T extends NativeModule> T getNativeModule(Class<T> nativeModuleInterface) {
      return null;
    }

    @Override
    public NativeModule getNativeModule(String moduleName) {
      return null;
    }

    @Override
    public CatalystInstance getCatalystInstance() {
      throw new UnsupportedOperationException();
    }

    @Override
    public JavaScriptContextHolder getJavaScriptContextHolder() {
      return null;
    }

    @Override
    public CallInvokerHolder getJSCallInvokerHolder() {
      return null;
    }

    @Override
    public UIManager getFabricUIManager() {
      return null;
    }

    @Override
    public String getSourceURL() {
      return null;
    }

    @Override
    public void registerSegment(int segmentId, String path, Callback callback) {}
  }

  /** Records the tap events Notifee posts to its event subscribers. */
  public static class NotificationEventRecorder {
    final List<NotificationEvent> taps = Collections.synchronizedList(new ArrayList<>());

    @Subscribe
    public void onNotificationEvent(NotificationEvent event) {
      if (event.getType() == NotificationEvent.TYPE_PRESS
          || event.getType() == NotificationEvent.TYPE_ACTION_PRESS) {
        taps.add(event);
      }
    }
  }

  private NotificationEventRecorder recordTapEvents() {
    eventRecorder = new NotificationEventRecorder();
    EventBus.register(eventRecorder);
    return eventRecorder;
  }

  /** Intent whose extras cannot be read, as when its sender put classes this app does not have. */
  private static class UnreadableExtrasIntent extends Intent {
    @Override
    public boolean hasExtra(String name) {
      throw new BadParcelableException("ClassNotFoundException when unmarshalling");
    }

    @Override
    public String getStringExtra(String name) {
      throw new BadParcelableException("ClassNotFoundException when unmarshalling");
    }

    @Override
    public Bundle getBundleExtra(String name) {
      throw new BadParcelableException("ClassNotFoundException when unmarshalling");
    }
  }
}
