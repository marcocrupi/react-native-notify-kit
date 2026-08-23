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

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * Unit coverage for the cross-version access contract backing the {@code android.fullScreenIntent}
 * field of {@code getNotificationSettings()}.
 */
@RunWith(RobolectricTestRunner.class)
public class FullScreenIntentUtilsTest {

  @Test
  @Config(sdk = 28)
  public void returnsTrueBelowApi29WithoutPermission() {
    Context context = mock(Context.class);
    when(context.checkSelfPermission(Manifest.permission.USE_FULL_SCREEN_INTENT))
        .thenReturn(PackageManager.PERMISSION_DENIED);

    assertTrue(FullScreenIntentUtils.canUseFullScreenIntent(context));
  }

  @Test
  @Config(sdk = 33)
  public void reflectsPermissionAndRereadsItFromApi29Through33() {
    Context context = mock(Context.class);
    when(context.checkSelfPermission(Manifest.permission.USE_FULL_SCREEN_INTENT))
        .thenReturn(PackageManager.PERMISSION_GRANTED, PackageManager.PERMISSION_DENIED);

    assertTrue(FullScreenIntentUtils.canUseFullScreenIntent(context));
    assertFalse(FullScreenIntentUtils.canUseFullScreenIntent(context));
  }

  @Test
  @Config(sdk = 34)
  public void reflectsAccessChangesOnApi34() {
    Context context = mock(Context.class);
    NotificationManager notificationManager = mock(NotificationManager.class);
    when(context.getSystemService(Context.NOTIFICATION_SERVICE)).thenReturn(notificationManager);
    when(notificationManager.canUseFullScreenIntent()).thenReturn(true, false);

    assertTrue(FullScreenIntentUtils.canUseFullScreenIntent(context));
    assertFalse(FullScreenIntentUtils.canUseFullScreenIntent(context));
  }

  @Test
  @Config(sdk = 35)
  public void keepsConsultingNotificationManagerAboveApi34() {
    Context context = mock(Context.class);
    NotificationManager notificationManager = mock(NotificationManager.class);
    when(context.getSystemService(Context.NOTIFICATION_SERVICE)).thenReturn(notificationManager);
    when(notificationManager.canUseFullScreenIntent()).thenReturn(true);

    assertTrue(FullScreenIntentUtils.canUseFullScreenIntent(context));
  }
}
