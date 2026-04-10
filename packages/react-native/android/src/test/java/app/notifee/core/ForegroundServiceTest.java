package app.notifee.core;

import static org.junit.Assert.assertEquals;

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
}
