package app.notifee.core.model;

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

import static org.junit.Assert.assertNull;

import android.os.Bundle;
import app.notifee.core.ContextHolder;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

/**
 * Unit coverage for {@link NotificationAndroidModel#getSmallIcon()}.
 *
 * <p>The method returns {@code null} when the smallIcon string cannot be resolved to a valid
 * resource id. This is the trigger condition that {@link app.notifee.core.NotificationManager}
 * translates into the launcher-icon fallback (upstream invertase/notifee#733).
 *
 * <p>The happy path (valid resource id returned) is covered end-to-end by smoke tests on real
 * devices — unit-testing it here would require a real drawable registered against the test
 * application package, which Robolectric does not stage by default.
 */
@RunWith(RobolectricTestRunner.class)
public class NotificationAndroidModelSmallIconFallbackTest {

  @Before
  public void setUp() {
    // getSmallIcon() -> ResourceUtils.getImageResourceId() -> getResourceIdByName() reads
    // ContextHolder.getApplicationContext() to call context.getResources().getIdentifier(...).
    // Robolectric does not auto-populate ContextHolder, so we wire it up here. Same pattern
    // used by ForegroundServiceTest and NotifeeAlarmManagerHandleStaleTest.
    ContextHolder.setApplicationContext(RuntimeEnvironment.getApplication());
  }

  @Test
  public void returnsNull_whenSmallIconKeyMissing() {
    Bundle bundle = new Bundle();
    NotificationAndroidModel model = NotificationAndroidModel.fromBundle(bundle);
    assertNull(model.getSmallIcon());
  }

  @Test
  public void returnsNull_whenSmallIconCannotBeResolved() {
    Bundle bundle = new Bundle();
    bundle.putString("smallIcon", "nonexistent_icon_name_for_test");
    NotificationAndroidModel model = NotificationAndroidModel.fromBundle(bundle);
    assertNull(model.getSmallIcon());
  }

  @Test
  public void returnsNull_whenSmallIconEmptyString() {
    Bundle bundle = new Bundle();
    bundle.putString("smallIcon", "");
    NotificationAndroidModel model = NotificationAndroidModel.fromBundle(bundle);
    assertNull(model.getSmallIcon());
  }
}
