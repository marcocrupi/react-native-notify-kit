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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.os.Bundle;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

/**
 * Unit tests for {@link NotificationManager#shouldIncludeInData(String)} and {@link
 * NotificationManager#extractDataFromExtras(android.os.Bundle)} — the denylist filter and
 * bundle-to-bundle helper added for upstream invertase/notifee#393.
 *
 * <p>The end-to-end {@code getDisplayedNotifications()} path is intentionally not exercised here
 * because it depends on {@code android.app.NotificationManager.getActiveNotifications()}, which
 * would require a system service mock. Extracting the pure predicate and the extras iteration into
 * helper methods lets these tests run under Robolectric with a real {@link Bundle} implementation
 * and no system service at all.
 */
@RunWith(RobolectricTestRunner.class)
public class GetDisplayedNotificationsDataTest {

  // -------- shouldIncludeInData (pure predicate) --------

  @Test
  public void shouldIncludeInData_plainKey_returnsTrue() {
    assertTrue(NotificationManager.shouldIncludeInData("event"));
    assertTrue(NotificationManager.shouldIncludeInData("userId"));
    assertTrue(NotificationManager.shouldIncludeInData("conversation_id"));
  }

  @Test
  public void shouldIncludeInData_androidPrefix_returnsFalse() {
    assertFalse(NotificationManager.shouldIncludeInData("android.title"));
    assertFalse(NotificationManager.shouldIncludeInData("android.text"));
  }

  @Test
  public void shouldIncludeInData_androidLookalike_returnsTrue() {
    // The `android.` prefix intentionally includes the dot, so custom keys that
    // merely begin with the substring `android` are not accidentally filtered.
    assertTrue(NotificationManager.shouldIncludeInData("androidify"));
    assertTrue(NotificationManager.shouldIncludeInData("androidish"));
  }

  @Test
  public void shouldIncludeInData_googlePrefix_returnsFalse() {
    assertFalse(NotificationManager.shouldIncludeInData("google.sent_time"));
    assertFalse(NotificationManager.shouldIncludeInData("google.delivered_priority"));
  }

  @Test
  public void shouldIncludeInData_googleLookalike_returnsTrue() {
    // Same reasoning as androidLookalike — `google.` with dot keeps the filter precise.
    assertTrue(NotificationManager.shouldIncludeInData("googleish"));
    assertTrue(NotificationManager.shouldIncludeInData("googlebot"));
  }

  @Test
  public void shouldIncludeInData_gcmPrefix_returnsFalse() {
    assertFalse(NotificationManager.shouldIncludeInData("gcm.notification.foo"));
    assertFalse(NotificationManager.shouldIncludeInData("gcm.n.e"));
  }

  @Test
  public void shouldIncludeInData_notifeePrefix_returnsFalse() {
    // "notifee.notification" and "notifee.trigger" are the current internal
    // constants (EXTRA_NOTIFEE_NOTIFICATION / EXTRA_NOTIFEE_TRIGGER). They
    // are caught by the no-dot `notifee` prefix.
    assertFalse(NotificationManager.shouldIncludeInData("notifee.notification"));
    assertFalse(NotificationManager.shouldIncludeInData("notifee.trigger"));

    // `notifee` is INTENTIONALLY kept without the dot: the library reserves
    // its own namespace entirely, so `notifeeFoo` is also filtered. This
    // differs from `fcm.` (with dot, see below): for `notifee` the whole
    // prefix is library-owned and can collide with future internal constants,
    // whereas `fcm` is a third-party namespace where we prefer to let
    // realistic user keys like `fcmRegion` or `fcmToken` survive.
    assertFalse(NotificationManager.shouldIncludeInData("notifeeFoo"));
  }

  @Test
  public void shouldIncludeInData_fcmDottedPrefix_returnsFalse() {
    // `fcm.` uses the trailing dot so realistic user custom keys (fcmRegion,
    // fcmToken, fcmlike) can round-trip through `data`. This diverges from
    // iOS parseDataFromUserInfo:, which uses bare `[key hasPrefix:@"fcm"]`
    // specifically to catch `fcm_options` (see the `// fcm_options` marker
    // at NotifeeCoreUtil.m:627-628 and the dedicated
    // shouldIncludeInData_fcmOptionsExactKey_returnsFalse test above). Both
    // platforms drop `fcm_options`; Android additionally preserves bare-fcm
    // user keys (fcmRegion, fcmToken, …) that iOS drops as collateral.
    assertFalse(NotificationManager.shouldIncludeInData("fcm.notification"));
    assertFalse(NotificationManager.shouldIncludeInData("fcm.foo"));
  }

  @Test
  public void shouldIncludeInData_fcmLookalike_returnsTrue() {
    // These survive the Android filter. They would NOT survive the iOS
    // filter, which is an accepted cross-platform divergence in favor of
    // preserving realistic user data on Android. Note: `fcm_options` is a
    // deliberate EXCEPTION to this rule — see the dedicated test
    // shouldIncludeInData_fcmOptionsExactKey_returnsFalse below.
    assertTrue(NotificationManager.shouldIncludeInData("fcm"));
    assertTrue(NotificationManager.shouldIncludeInData("fcmlike"));
    assertTrue(NotificationManager.shouldIncludeInData("fcmRegion"));
    assertTrue(NotificationManager.shouldIncludeInData("fcmToken"));
  }

  @Test
  public void shouldIncludeInData_fcmOptionsExactKey_returnsFalse() {
    // `fcm_options` is the Firebase HTTP v1 Message.fcm_options analytics
    // label. On iOS it is caught by the bare `[key hasPrefix:@"fcm"]` filter
    // in NotifeeCoreUtil.m:627-628, which has an inline `// fcm_options`
    // comment documenting that the whole reason the iOS prefix is bare (not
    // dotted) is specifically to drop this key. On Android we switched the
    // prefix to `fcm.` (with dot) so realistic user keys like `fcmRegion`
    // can survive — but that alone would leak `fcm_options`. This test
    // guards the exact-match entry in EXCLUDED_DATA_KEYS that restores
    // parity with iOS for the one Firebase-reserved bare-`fcm` key.
    assertFalse(NotificationManager.shouldIncludeInData("fcm_options"));
  }

  @Test
  public void shouldIncludeInData_exactKeyBlocklist_returnsFalse() {
    assertFalse(NotificationManager.shouldIncludeInData("from"));
    assertFalse(NotificationManager.shouldIncludeInData("collapse_key"));
    assertFalse(NotificationManager.shouldIncludeInData("message_type"));
    assertFalse(NotificationManager.shouldIncludeInData("message_id"));
    assertFalse(NotificationManager.shouldIncludeInData("aps"));
  }

  @Test
  public void shouldIncludeInData_nullKey_returnsFalse() {
    assertFalse(NotificationManager.shouldIncludeInData(null));
  }

  // -------- extractDataFromExtras (bundle → bundle) --------

  @Test
  public void extractDataFromExtras_nullExtras_returnsEmptyBundle() {
    Bundle result = NotificationManager.extractDataFromExtras(null);
    assertNotNull(result);
    assertEquals(0, result.size());
  }

  @Test
  public void extractDataFromExtras_emptyExtras_returnsEmptyBundle() {
    Bundle result = NotificationManager.extractDataFromExtras(new Bundle());
    assertNotNull(result);
    assertEquals(0, result.size());
  }

  @Test
  public void extractDataFromExtras_mixedKeys_returnsOnlyCustomKeys() {
    Bundle extras = new Bundle();

    // Custom keys that should survive the filter.
    extras.putString("event", "chat_msg");
    extras.putString("userId", "42");

    // System keys that must be dropped.
    extras.putString("android.title", "Hello");
    extras.putString("android.text", "Body");
    extras.putString("google.sent_time", "123456");
    extras.putString("gcm.notification.e", "1");
    extras.putString("from", "12345");
    extras.putString("collapse_key", "do_not_collapse");
    extras.putString("message_id", "msg-abc");
    extras.putString("notifee.notification", "internal");
    extras.putString("fcm.foo", "reserved-dotted");

    // Custom key matching the iOS-divergent survivor pattern: `fcmRegion`
    // must appear in the result on Android, even though iOS would drop it.
    extras.putString("fcmRegion", "eu-west-1");

    // Non-String value to verify toString() coercion for the rare survivor.
    extras.putInt("count", 5);

    Bundle result = NotificationManager.extractDataFromExtras(extras);
    assertNotNull(result);

    Set<String> expected = new HashSet<>(Arrays.asList("event", "userId", "fcmRegion", "count"));
    assertEquals(expected, result.keySet());
    assertEquals("chat_msg", result.getString("event"));
    assertEquals("42", result.getString("userId"));
    assertEquals("eu-west-1", result.getString("fcmRegion"));
    assertEquals("5", result.getString("count"));
  }

  @Test
  public void extractDataFromExtras_onlySystemKeys_returnsEmptyBundle() {
    Bundle extras = new Bundle();
    extras.putString("android.title", "Hello");
    extras.putString("google.sent_time", "123");
    extras.putString("gcm.notification.foo", "bar");
    extras.putString("notifee.trigger", "internal");
    extras.putString("from", "12345");
    extras.putString("fcm.options", "reserved-dotted");
    // Firebase analytics label — exact-match filtered for iOS parity,
    // see shouldIncludeInData_fcmOptionsExactKey_returnsFalse.
    extras.putString("fcm_options", "{\"analytics_label\":\"foo\"}");

    Bundle result = NotificationManager.extractDataFromExtras(extras);
    assertNotNull(result);
    assertEquals(0, result.size());
  }

  @Test
  public void extractDataFromExtras_nullValueForCustomKey_isSkipped() {
    Bundle extras = new Bundle();
    extras.putString("event", "chat_msg");
    extras.putString("nullable", null);

    Bundle result = NotificationManager.extractDataFromExtras(extras);
    assertNotNull(result);
    assertEquals(1, result.size());
    assertEquals("chat_msg", result.getString("event"));
  }
}
