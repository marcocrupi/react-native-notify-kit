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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

/**
 * Unit coverage for {@link ResourceUtils#getFallbackSmallIconId(Context)} — the three-layer
 * fallback that keeps a notification valid when the user-supplied {@code smallIcon} string cannot
 * be resolved. Guards the invariant that the method never returns 0 and never throws, which is what
 * {@link app.notifee.core.NotificationManager} relies on to avoid the {@code
 * IllegalArgumentException: Invalid notification (no valid small icon)} crash that motivated the
 * fix (upstream invertase/notifee#733).
 */
@RunWith(RobolectricTestRunner.class)
public class ResourceUtilsFallbackIconTest {

  @Test
  public void returnsApplicationInfoIcon_whenIconNonZero() {
    ApplicationInfo info = new ApplicationInfo();
    info.icon = 0x7f080001;
    info.logo = 0x7f080002;
    Context context = mock(Context.class);
    when(context.getApplicationInfo()).thenReturn(info);

    assertEquals(0x7f080001, ResourceUtils.getFallbackSmallIconId(context));
  }

  @Test
  public void returnsApplicationInfoLogo_whenIconZeroAndLogoNonZero() {
    ApplicationInfo info = new ApplicationInfo();
    info.icon = 0;
    info.logo = 0x7f080002;
    Context context = mock(Context.class);
    when(context.getApplicationInfo()).thenReturn(info);

    assertEquals(0x7f080002, ResourceUtils.getFallbackSmallIconId(context));
  }

  @Test
  public void returnsSystemDefault_whenIconAndLogoZero() {
    ApplicationInfo info = new ApplicationInfo();
    info.icon = 0;
    info.logo = 0;
    Context context = mock(Context.class);
    when(context.getApplicationInfo()).thenReturn(info);

    assertEquals(android.R.drawable.ic_dialog_info, ResourceUtils.getFallbackSmallIconId(context));
  }

  @Test
  public void returnsSystemDefault_whenGetApplicationInfoThrows() {
    Context context = mock(Context.class);
    when(context.getApplicationInfo()).thenThrow(new RuntimeException("boom"));

    assertEquals(android.R.drawable.ic_dialog_info, ResourceUtils.getFallbackSmallIconId(context));
  }

  @Test
  public void returnsSystemDefault_whenContextIsNull() {
    assertEquals(android.R.drawable.ic_dialog_info, ResourceUtils.getFallbackSmallIconId(null));
  }

  @Test
  public void neverReturnsZero_acrossAllPaths() {
    // Path 1: icon present
    ApplicationInfo infoIcon = new ApplicationInfo();
    infoIcon.icon = 0x7f080001;
    Context ctxIcon = mock(Context.class);
    when(ctxIcon.getApplicationInfo()).thenReturn(infoIcon);
    assertNotEquals(0, ResourceUtils.getFallbackSmallIconId(ctxIcon));

    // Path 2: logo fallback
    ApplicationInfo infoLogo = new ApplicationInfo();
    infoLogo.logo = 0x7f080002;
    Context ctxLogo = mock(Context.class);
    when(ctxLogo.getApplicationInfo()).thenReturn(infoLogo);
    assertNotEquals(0, ResourceUtils.getFallbackSmallIconId(ctxLogo));

    // Path 3: system default (empty ApplicationInfo, icon and logo both zero)
    Context ctxEmpty = mock(Context.class);
    when(ctxEmpty.getApplicationInfo()).thenReturn(new ApplicationInfo());
    assertNotEquals(0, ResourceUtils.getFallbackSmallIconId(ctxEmpty));

    // Path 4: exception branch
    Context ctxThrows = mock(Context.class);
    when(ctxThrows.getApplicationInfo()).thenThrow(new RuntimeException());
    assertNotEquals(0, ResourceUtils.getFallbackSmallIconId(ctxThrows));

    // Path 5: null context
    assertNotEquals(0, ResourceUtils.getFallbackSmallIconId(null));
  }
}
