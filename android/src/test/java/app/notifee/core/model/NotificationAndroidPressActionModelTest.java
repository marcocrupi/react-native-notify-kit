package app.notifee.core.model;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import android.os.Bundle;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public class NotificationAndroidPressActionModelTest {

  @Test
  public void getLaunchActivity_defaultId_noLaunchActivity_returnsDefault() {
    Bundle bundle = new Bundle();
    bundle.putString("id", "default");

    NotificationAndroidPressActionModel model =
        NotificationAndroidPressActionModel.fromBundle(bundle);

    assertEquals(
        "when id is 'default' and launchActivity is not set, should return 'default'",
        "default",
        model.getLaunchActivity());
  }

  @Test
  public void getLaunchActivity_defaultId_explicitLaunchActivity_returnsExplicit() {
    Bundle bundle = new Bundle();
    bundle.putString("id", "default");
    bundle.putString("launchActivity", "com.example.CustomActivity");

    NotificationAndroidPressActionModel model =
        NotificationAndroidPressActionModel.fromBundle(bundle);

    assertEquals(
        "when id is 'default' and launchActivity is explicitly set, should return the explicit"
            + " value",
        "com.example.CustomActivity",
        model.getLaunchActivity());
  }

  @Test
  public void getLaunchActivity_nonDefaultId_noLaunchActivity_returnsNull() {
    Bundle bundle = new Bundle();
    bundle.putString("id", "custom-action");

    NotificationAndroidPressActionModel model =
        NotificationAndroidPressActionModel.fromBundle(bundle);

    assertNull(
        "when id is not 'default' and launchActivity is not set, should return null",
        model.getLaunchActivity());
  }
}
