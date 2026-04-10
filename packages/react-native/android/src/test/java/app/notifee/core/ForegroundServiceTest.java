package app.notifee.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.app.Service;
import android.content.Intent;
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
  public void tearDown() {
    // Reset all accessible static fields to prevent cross-test pollution.
    // mCurrentNotificationBundle, mCurrentNotification, mCurrentHashCode are private static
    // and can only be reset via onStartCommand (the STOP path clears them).
    ForegroundService.mCurrentNotificationId = null;
    ForegroundService.mCurrentForegroundServiceType = -1;
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
}
