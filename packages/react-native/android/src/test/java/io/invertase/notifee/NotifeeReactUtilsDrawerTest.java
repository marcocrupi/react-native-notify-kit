package io.invertase.notifee;

import app.notifee.core.ContextHolder;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class NotifeeReactUtilsDrawerTest {

  @Before
  public void setUp() {
    ContextHolder.setApplicationContext(RuntimeEnvironment.getApplication());
  }

  @Test
  public void hideNotificationDrawer_whenStatusBarReflectionFails_doesNotCrash() {
    NotifeeReactUtils.INSTANCE.hideNotificationDrawer();
  }
}
