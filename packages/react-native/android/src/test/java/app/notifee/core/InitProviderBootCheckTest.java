package app.notifee.core;

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

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

/**
 * Unit tests for the BOOT_COUNT-based cold-start reschedule decision logic added for upstream
 * invertase/notifee#734. Exhaustively covers the pure decision helper {@link
 * InitProvider#shouldRescheduleAfterBoot}.
 *
 * <p>The integration path {@code runBootCheck → rescheduleNotifications} is intentionally not
 * exercised here because {@code rescheduleNotifications} touches a real Room database via {@code
 * WorkDataRepository.getInstance}, which is not set up in this unit-test environment. That path is
 * covered by the instrumented {@code RebootRecoveryTest} and by the manual Step 4 smoke test.
 */
@RunWith(RobolectricTestRunner.class)
public class InitProviderBootCheckTest {

  @Test
  public void shouldRescheduleAfterBoot_firstRun_withValidBootCount_returnsFalse() {
    // lastKnown == -1 means "no baseline recorded yet". We record the baseline
    // and skip reschedule to avoid firing stale triggers on fresh installs.
    assertFalse(InitProvider.shouldRescheduleAfterBoot(5, -1));
  }

  @Test
  public void shouldRescheduleAfterBoot_sameBoot_returnsFalse() {
    // Same app process, same device boot → nothing to recover.
    assertFalse(InitProvider.shouldRescheduleAfterBoot(5, 5));
  }

  @Test
  public void shouldRescheduleAfterBoot_newBoot_returnsTrue() {
    // Reboot detected since last run → recover scheduled alarms.
    assertTrue(InitProvider.shouldRescheduleAfterBoot(6, 5));
  }

  @Test
  public void shouldRescheduleAfterBoot_bootCountDecreased_returnsTrue() {
    // BOOT_COUNT decreasing is unexpected but possible (factory reset, counter
    // rollover on exotic ROMs). Any change is treated as "unknown transition
    // since last run" → conservative reschedule.
    assertTrue(InitProvider.shouldRescheduleAfterBoot(3, 5));
  }

  @Test
  public void shouldRescheduleAfterBoot_bootCountUnavailable_returnsTrue() {
    // BOOT_COUNT couldn't be read → we can't tell if a reboot happened, so we
    // reschedule conservatively. This also covers emulators and rooted ROMs
    // where the Settings.Global row is missing or throws.
    assertTrue(InitProvider.shouldRescheduleAfterBoot(-1, 5));
  }

  @Test
  public void shouldRescheduleAfterBoot_bootCountUnavailable_andFirstRun_returnsTrue() {
    // Degenerate case: first run AND BOOT_COUNT unavailable. The "unavailable"
    // branch wins over the "first run" branch because we genuinely don't know
    // if the device has rebooted since install.
    assertTrue(InitProvider.shouldRescheduleAfterBoot(-1, -1));
  }
}
