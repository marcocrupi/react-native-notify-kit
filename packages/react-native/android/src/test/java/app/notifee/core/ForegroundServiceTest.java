package app.notifee.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Bundle;
import androidx.core.app.NotificationCompat;
import app.notifee.core.event.NotificationEvent;
import java.lang.reflect.Field;
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
public class ForegroundServiceTest {

  @Before
  public void setUp() {
    // Initialize ContextHolder so the service can access the application context
    ContextHolder.setApplicationContext(RuntimeEnvironment.getApplication());
  }

  @After
  public void tearDown() throws Exception {
    // Reset public and private static fields to prevent cross-test pollution. The three private
    // statics are cleared via reflection here so that tests which seed them directly (to exercise
    // onTimeout without running the full START path) cannot leak state into neighbouring tests.
    ForegroundService.mCurrentNotificationId = null;
    ForegroundService.mCurrentForegroundServiceType = -1;
    setPrivateStatic("mCurrentNotificationBundle", null);
    setPrivateStatic("mCurrentNotification", null);
    setPrivateStatic("mCurrentHashCode", 0);
  }

  /**
   * Regression test for Bug #1: a STOP intent arriving on a fresh service instance that has never
   * called startForeground() must not crash. The defensive startForeground() path should fire,
   * satisfying Android's contract, and the service should stop cleanly.
   */
  @Test
  public void onStartCommand_stopIntentBeforeStart_doesNotCrash() {
    ServiceController<ForegroundService> controller =
        Robolectric.buildService(ForegroundService.class);
    ForegroundService service = controller.create().get();

    Intent stopIntent = new Intent();
    stopIntent.setAction(ForegroundService.STOP_FOREGROUND_SERVICE_ACTION);

    // This should not throw — the defensive startForeground() path handles the case
    int result = service.onStartCommand(stopIntent, 0, 1);
    assertEquals(Service.START_STICKY_COMPATIBILITY, result);
  }

  /**
   * Regression test: a null intent (service recreation after process kill) must not crash. Android
   * may deliver a null intent when recreating a service.
   */
  @Test
  public void onStartCommand_nullIntent_doesNotCrash() {
    ServiceController<ForegroundService> controller =
        Robolectric.buildService(ForegroundService.class);
    ForegroundService service = controller.create().get();

    // Null intent simulates service recreation after process kill
    int result = service.onStartCommand(null, 0, 1);
    assertEquals(Service.START_STICKY_COMPATIBILITY, result);
  }

  /**
   * Verifies that after the STOP path, the public static state fields are reset to their initial
   * values. Only checks the two public static fields (mCurrentNotificationId and
   * mCurrentForegroundServiceType) — the three private static fields (mCurrentNotificationBundle,
   * mCurrentNotification, mCurrentHashCode) are not directly accessible from tests.
   */
  @Test
  public void onStartCommand_stopIntent_resetsPublicStaticState() {
    ServiceController<ForegroundService> controller =
        Robolectric.buildService(ForegroundService.class);
    ForegroundService service = controller.create().get();

    // Set some stale state to simulate a prior invocation
    ForegroundService.mCurrentNotificationId = "test-id";
    ForegroundService.mCurrentForegroundServiceType = 42;

    Intent stopIntent = new Intent();
    stopIntent.setAction(ForegroundService.STOP_FOREGROUND_SERVICE_ACTION);

    service.onStartCommand(stopIntent, 0, 1);

    // Public static state should be reset
    assertEquals(null, ForegroundService.mCurrentNotificationId);
    assertEquals(-1, ForegroundService.mCurrentForegroundServiceType);
  }

  /**
   * Bug A regression: on API 34+ with no foregroundServiceType declared in the manifest, the
   * defensive STOP path must throw a RuntimeException (causing a crash with an actionable message)
   * instead of silently catching and proceeding to stopSelf() — which would leave Android's
   * 5-second startForeground() contract unsatisfied and result in a cryptic ANR.
   */
  @Test(expected = RuntimeException.class)
  @Config(sdk = 34)
  public void onStartCommand_stopIntentApi34NoManifestType_throwsRuntimeException() {
    // Robolectric's default shadow PackageManager returns FOREGROUND_SERVICE_TYPE_NONE (0)
    // for services without an explicit foregroundServiceType in the test manifest.
    ServiceController<ForegroundService> controller =
        Robolectric.buildService(ForegroundService.class);
    ForegroundService service = controller.create().get();

    Intent stopIntent = new Intent();
    stopIntent.setAction(ForegroundService.STOP_FOREGROUND_SERVICE_ACTION);
    service.onStartCommand(stopIntent, 0, 1);
  }

  /**
   * Bug A regression: the RuntimeException message must contain the documentation URL so the
   * developer debugging the crash can find the fix immediately.
   */
  @Test
  @Config(sdk = 34)
  public void onStartCommand_stopIntentApi34NoManifestType_messageContainsDocUrl() {
    ServiceController<ForegroundService> controller =
        Robolectric.buildService(ForegroundService.class);
    ForegroundService service = controller.create().get();

    Intent stopIntent = new Intent();
    stopIntent.setAction(ForegroundService.STOP_FOREGROUND_SERVICE_ACTION);
    try {
      service.onStartCommand(stopIntent, 0, 1);
      fail("Expected RuntimeException");
    } catch (RuntimeException e) {
      assertTrue(
          "Message should contain documentation URL",
          e.getMessage().contains("foreground-service-setup-android-14"));
    }
  }

  /**
   * Backward compatibility: on API levels below 34, the defensive path should run normally without
   * the proactive manifest check. No foregroundServiceType declaration is required pre-API 34.
   */
  @Test
  @Config(sdk = 33)
  public void onStartCommand_stopIntentApiBelow34_defensivePathRunsNormally() {
    ServiceController<ForegroundService> controller =
        Robolectric.buildService(ForegroundService.class);
    ForegroundService service = controller.create().get();

    Intent stopIntent = new Intent();
    stopIntent.setAction(ForegroundService.STOP_FOREGROUND_SERVICE_ACTION);

    // Should not throw on API 33, regardless of manifest
    int result = service.onStartCommand(stopIntent, 0, 1);
    assertEquals(Service.START_STICKY_COMPATIBILITY, result);
  }

  /**
   * Idempotency: when mStartForegroundCalled is already true (the service has previously called
   * startForeground() successfully), the helper must be a no-op. Verified by sending two
   * consecutive STOP intents — the second should not crash even on API 33 where the first succeeded
   * via the defensive path.
   */
  @Test
  @Config(sdk = 33)
  public void onStartCommand_stopIntentAfterSuccessfulStart_skipsDefensivePath() {
    ServiceController<ForegroundService> controller =
        Robolectric.buildService(ForegroundService.class);
    ForegroundService service = controller.create().get();

    Intent stopIntent = new Intent();
    stopIntent.setAction(ForegroundService.STOP_FOREGROUND_SERVICE_ACTION);

    // First STOP — triggers defensive startForeground
    service.onStartCommand(stopIntent, 0, 1);

    // Second STOP — helper should be no-op since mStartForegroundCalled is now true
    int result = service.onStartCommand(stopIntent, 0, 2);
    assertEquals(Service.START_STICKY_COMPATIBILITY, result);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // START path and onTimeout event emission (regression guards for 9.1.13)
  // ──────────────────────────────────────────────────────────────────────────

  private static final String TEST_CHANNEL_ID = "fgs-test-channel";

  /**
   * START happy path: a valid intent with a notification payload must drive the service through
   * {@code startForeground()} and leave {@code mCurrentNotificationId} populated so a subsequent
   * STOP/onTimeout can reference it. Runs on SDK 33 to avoid the API 34+ manifest-type check, which
   * would require a test-specific {@code foregroundServiceType} declaration.
   */
  @Test
  @Config(sdk = 33)
  public void onStartCommand_startIntent_setsCurrentNotificationIdAndCallsStartForeground()
      throws Exception {
    createChannel();
    ServiceController<ForegroundService> controller =
        Robolectric.buildService(ForegroundService.class);
    ForegroundService service = controller.create().get();

    String id = "fgs-start-happy";
    int result =
        service.onStartCommand(
            buildStartIntent(id, id.hashCode()), /* flags= */ 0, /* startId= */ 1);

    assertEquals(Service.START_NOT_STICKY, result);
    assertEquals(id, ForegroundService.mCurrentNotificationId);
    // Robolectric's ShadowService records the most recent Notification passed to
    // startForeground(); a non-null result proves the 3-arg startForeground() overload on the
    // API 33 branch of onStartCommand was exercised and Android's contract was satisfied.
    Notification posted = org.robolectric.Shadows.shadowOf(service).getLastForegroundNotification();
    assertNotNull("startForeground() must have been called during the START path", posted);
    // The private static mCurrentHashCode tracks the caller-supplied hash; verifying it via
    // reflection proves the START branch fully ran (not just the early-return path).
    Field hashField = ForegroundService.class.getDeclaredField("mCurrentHashCode");
    hashField.setAccessible(true);
    assertEquals(id.hashCode(), hashField.getInt(null));
  }

  /**
   * Regression guard for the 9.1.13 {@code onTimeout(int)} fix (upstream invertase/notifee#703). On
   * API 34, Android's single-argument {@code onTimeout} fires when a {@code shortService} FGS
   * exceeds its 3-minute budget. The handler must:
   *
   * <ol>
   *   <li>emit a {@link NotificationEvent} with type {@link NotificationEvent#TYPE_FG_TIMEOUT},
   *   <li>carry the originating notification model so JS can correlate the event,
   *   <li>populate {@code startId} and {@code fgsType} extras (the latter is {@code -1} as a
   *       sentinel on the single-argument variant), and
   *   <li>reset the service's static tracking state.
   * </ol>
   */
  @Test
  @Config(sdk = 34)
  public void onTimeout_api34_emitsFgTimeoutEventWithStartIdAndSentinelFgsType() throws Exception {
    ServiceController<ForegroundService> controller =
        Robolectric.buildService(ForegroundService.class);
    ForegroundService service = controller.create().get();

    String id = "fgs-timeout-api34";
    seedActiveForegroundServiceState(id);

    FgsEventCapture capture = new FgsEventCapture();
    EventBus.register(capture);
    try {
      int startId = 42;
      service.onTimeout(startId);

      assertEquals(
          "exactly one NotificationEvent should be emitted on timeout", 1, capture.events.size());
      NotificationEvent event = capture.events.get(0);
      assertEquals(NotificationEvent.TYPE_FG_TIMEOUT, event.getType());
      assertNotNull(
          "timeout event must carry the originating notification", event.getNotification());
      assertEquals(id, event.getNotification().getId());
      assertNotNull("timeout event must carry startId/fgsType extras", event.getExtras());
      assertEquals(startId, event.getExtras().getInt("startId"));
      // handleTimeout is called with -1 as the fgsType sentinel from the single-argument overload.
      assertEquals(-1, event.getExtras().getInt("fgsType"));
    } finally {
      EventBus.unregister(capture);
    }

    assertNull(
        "mCurrentNotificationId must be cleared after onTimeout",
        ForegroundService.mCurrentNotificationId);
    assertEquals(-1, ForegroundService.mCurrentForegroundServiceType);
  }

  /**
   * Regression guard for the API 35+ {@code onTimeout(int, int)} overload, which supersedes the
   * single-argument variant and surfaces the type-specific timeout cause (e.g. {@code
   * FOREGROUND_SERVICE_TYPE_DATA_SYNC}'s new Android 15 cumulative cap). The emitted event must
   * carry the explicit {@code fgsType} value, not the sentinel.
   */
  @Test
  @Config(sdk = 35)
  public void onTimeout_api35_emitsFgTimeoutEventWithExplicitFgsType() throws Exception {
    ServiceController<ForegroundService> controller =
        Robolectric.buildService(ForegroundService.class);
    ForegroundService service = controller.create().get();

    String id = "fgs-timeout-api35";
    seedActiveForegroundServiceState(id);

    FgsEventCapture capture = new FgsEventCapture();
    EventBus.register(capture);
    try {
      int startId = 7;
      int fgsType = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
      service.onTimeout(startId, fgsType);

      assertEquals(1, capture.events.size());
      NotificationEvent event = capture.events.get(0);
      assertEquals(NotificationEvent.TYPE_FG_TIMEOUT, event.getType());
      assertEquals(id, event.getNotification().getId());
      assertNotNull(event.getExtras());
      assertEquals(startId, event.getExtras().getInt("startId"));
      assertEquals(fgsType, event.getExtras().getInt("fgsType"));
    } finally {
      EventBus.unregister(capture);
    }

    assertNull(ForegroundService.mCurrentNotificationId);
  }

  /**
   * Defensive behaviour: if onTimeout fires on a service instance whose static state has already
   * been cleared (a race between STOP and the Android system delivering a delayed timeout), the
   * handler must not crash and must not post a stray event.
   */
  @Test
  @Config(sdk = 34)
  public void onTimeout_withNoActiveState_doesNotCrashOrEmitEvent() {
    ServiceController<ForegroundService> controller =
        Robolectric.buildService(ForegroundService.class);
    ForegroundService service = controller.create().get();

    FgsEventCapture capture = new FgsEventCapture();
    EventBus.register(capture);
    try {
      service.onTimeout(/* startId= */ 99);
      assertEquals(0, capture.events.size());
    } finally {
      EventBus.unregister(capture);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private static void createChannel() {
    Context context = RuntimeEnvironment.getApplication();
    NotificationManager nm =
        (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm != null && nm.getNotificationChannel(TEST_CHANNEL_ID) == null) {
      NotificationChannel channel =
          new NotificationChannel(
              TEST_CHANNEL_ID, "FGS test channel", NotificationManager.IMPORTANCE_LOW);
      nm.createNotificationChannel(channel);
    }
  }

  private static Bundle buildNotificationBundle(String id) {
    Bundle bundle = new Bundle();
    bundle.putString("id", id);
    bundle.putString("title", "FGS test " + id);
    Bundle androidBundle = new Bundle();
    androidBundle.putString("channelId", TEST_CHANNEL_ID);
    bundle.putBundle("android", androidBundle);
    return bundle;
  }

  private static Notification buildNotification() {
    Context context = RuntimeEnvironment.getApplication();
    return new NotificationCompat.Builder(context, TEST_CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle("FGS test")
        .build();
  }

  private static Intent buildStartIntent(String id, int hashCode) {
    Intent intent = new Intent();
    intent.setAction(ForegroundService.START_FOREGROUND_SERVICE_ACTION);
    intent.putExtra("hashCode", hashCode);
    intent.putExtra("notification", buildNotification());
    intent.putExtra("notificationBundle", buildNotificationBundle(id));
    return intent;
  }

  /**
   * Populates the service's private static tracking fields directly, simulating the post-START
   * state that onTimeout expects to observe. Using reflection here (rather than running a full
   * START first) keeps the onTimeout tests SDK-independent — the START path would trip the API 34+
   * manifest-type check, but onTimeout itself is sdk-agnostic because its body only uses pre-API-34
   * primitives.
   */
  private static void seedActiveForegroundServiceState(String id) throws Exception {
    ForegroundService.mCurrentNotificationId = id;
    ForegroundService.mCurrentForegroundServiceType = 1;
    setPrivateStatic("mCurrentNotificationBundle", buildNotificationBundle(id));
    setPrivateStatic("mCurrentNotification", buildNotification());
    setPrivateStatic("mCurrentHashCode", id.hashCode());
  }

  private static void setPrivateStatic(String name, Object value) throws Exception {
    Field field = ForegroundService.class.getDeclaredField(name);
    field.setAccessible(true);
    field.set(null, value);
  }

  /**
   * greenrobot EventBus subscriber that records every {@link NotificationEvent} posted during a
   * test. {@link ThreadMode#POSTING} fires the subscriber synchronously on the caller thread, so
   * the test can inspect {@code events} immediately after {@code post()} returns without any looper
   * advancement.
   */
  public static class FgsEventCapture {
    final List<NotificationEvent> events = new ArrayList<>();

    @Subscribe(threadMode = ThreadMode.POSTING)
    public void onNotificationEvent(NotificationEvent event) {
      events.add(event);
    }
  }
}
