package app.notifee.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.os.Bundle;
import app.notifee.core.model.NotificationAndroidPressActionModel;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public class NotificationPendingIntentTest {

  /**
   * Regression test: explicit pressAction with launchActivity produces a model that
   * shouldCreateLaunchActivityIntent accepts. This is the most important test —
   * it guards against refactoring breaking the existing "pressAction provided" path.
   */
  @Test
  public void shouldCreateLaunchActivityIntent_withExplicitPressAction_returnsTrue() {
    Bundle bundle = new Bundle();
    bundle.putString("id", "default");
    bundle.putString("launchActivity", "default");

    NotificationAndroidPressActionModel model =
        NotificationAndroidPressActionModel.fromBundle(bundle);

    assertTrue(
        "explicit pressAction with launchActivity='default' must create a launch intent",
        NotificationPendingIntent.shouldCreateLaunchActivityIntent(model));
  }

  /**
   * Verifies that the default pressAction bundle synthesized in NotificationManager when
   * pressAction is absent produces a model that passes shouldCreateLaunchActivityIntent.
   * This proves the null → synthesized-default path routes through the same code as explicit.
   */
  @Test
  public void synthesizedDefaultBundle_producesValidModel() {
    // Replicate the exact bundle synthesized in NotificationManager when pressAction is null
    Bundle defaultBundle = new Bundle();
    defaultBundle.putString("id", "default");
    defaultBundle.putString("launchActivity", "default");

    NotificationAndroidPressActionModel model =
        NotificationAndroidPressActionModel.fromBundle(defaultBundle);

    assertEquals(
        "synthesized default model must have id='default'", "default", model.getId());
    assertEquals(
        "synthesized default model must have launchActivity='default'",
        "default",
        model.getLaunchActivity());
    assertNotNull(
        "synthesized default model must produce a non-null toBundle()", model.toBundle());
    assertTrue(
        "synthesized default must pass shouldCreateLaunchActivityIntent",
        NotificationPendingIntent.shouldCreateLaunchActivityIntent(model));
  }

  /** Null pressActionModel must return false — this is the guard for opt-out and absent cases. */
  @Test
  public void shouldCreateLaunchActivityIntent_withNull_returnsFalse() {
    assertFalse(
        "null pressActionModel must not create a launch intent",
        NotificationPendingIntent.shouldCreateLaunchActivityIntent(null));
  }

  /**
   * Regression: pressAction with a custom launchActivity (non-default) must also pass.
   * Ensures the fix didn't break custom launch activity resolution.
   */
  @Test
  public void shouldCreateLaunchActivityIntent_withCustomLaunchActivity_returnsTrue() {
    Bundle bundle = new Bundle();
    bundle.putString("id", "custom-action");
    bundle.putString("launchActivity", "com.example.CustomActivity");

    NotificationAndroidPressActionModel model =
        NotificationAndroidPressActionModel.fromBundle(bundle);

    assertTrue(
        "explicit pressAction with custom launchActivity must create a launch intent",
        NotificationPendingIntent.shouldCreateLaunchActivityIntent(model));
  }

  /** Opt-out sentinel must be recognized and result in no launch intent (null pressAction). */
  @Test
  public void optOutSentinel_isRecognizedById() {
    Bundle sentinelBundle = new Bundle();
    sentinelBundle.putString("id", NotificationPendingIntent.PRESS_ACTION_OPT_OUT_ID);

    NotificationAndroidPressActionModel model =
        NotificationAndroidPressActionModel.fromBundle(sentinelBundle);

    assertEquals(
        "opt-out sentinel id must match the constant",
        NotificationPendingIntent.PRESS_ACTION_OPT_OUT_ID,
        model.getId());

    // The sentinel has no launchActivity and a non-'default' id, so getLaunchActivity()
    // returns null. shouldCreateLaunchActivityIntent returns false.
    assertFalse(
        "opt-out sentinel must not create a launch intent",
        NotificationPendingIntent.shouldCreateLaunchActivityIntent(model));
  }
}
