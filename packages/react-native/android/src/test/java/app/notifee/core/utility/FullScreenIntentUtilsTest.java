package app.notifee.core.utility;

/*
 * Copyright (c) 2016-present Invertase Limited & Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this library except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import android.app.NotificationManager;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * Unit coverage for {@link FullScreenIntentUtils#canUseFullScreenIntent(NotificationManager)},
 * which backs the {@code android.fullScreenIntent} field of {@code getNotificationSettings()}.
 *
 * <p>Android 14 / API 34 turned {@code USE_FULL_SCREEN_INTENT} into a user-revocable special app
 * access. The interesting behavior is therefore the API level boundary, so each case pins the SDK
 * with {@link Config} and injects the {@link NotificationManager} rather than relying on a shadow —
 * Robolectric does not implement {@code canUseFullScreenIntent()}.
 */
@RunWith(RobolectricTestRunner.class)
public class FullScreenIntentUtilsTest {

  @Test
  @Config(sdk = 33)
  public void returnsTrueBelowApi34WithoutConsultingNotificationManager() {
    // Deliberately unstubbed: an unstubbed boolean mock answers false, so a true result proves
    // the version guard short-circuited. The method is not referenced by name here because it
    // does not exist on the API 33 android-all jar Robolectric loads for this case.
    NotificationManager notificationManager = mock(NotificationManager.class);

    assertTrue(FullScreenIntentUtils.canUseFullScreenIntent(notificationManager));
  }

  @Test
  @Config(sdk = 34)
  public void returnsTrueOnApi34WhenGranted() {
    NotificationManager notificationManager = mock(NotificationManager.class);
    when(notificationManager.canUseFullScreenIntent()).thenReturn(true);

    assertTrue(FullScreenIntentUtils.canUseFullScreenIntent(notificationManager));
  }

  @Test
  @Config(sdk = 34)
  public void returnsFalseOnApi34WhenDenied() {
    NotificationManager notificationManager = mock(NotificationManager.class);
    when(notificationManager.canUseFullScreenIntent()).thenReturn(false);

    assertFalse(FullScreenIntentUtils.canUseFullScreenIntent(notificationManager));
  }

  @Test
  @Config(sdk = 35)
  public void keepsConsultingNotificationManagerAboveApi34() {
    // Guards against the version check regressing into an equality test against 34.
    NotificationManager notificationManager = mock(NotificationManager.class);
    when(notificationManager.canUseFullScreenIntent()).thenReturn(false);

    assertFalse(FullScreenIntentUtils.canUseFullScreenIntent(notificationManager));
  }

  @Test
  @Config(sdk = 34)
  public void failsOpenWhenNotificationManagerIsUnavailable() {
    assertTrue(FullScreenIntentUtils.canUseFullScreenIntent(null));
  }
}
