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
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowPendingIntent;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class ReceiverServicePendingIntentIdentityTest {

  @Before
  public void setUp() {
    ContextHolder.setApplicationContext(RuntimeEnvironment.getApplication());
    ShadowPendingIntent.reset();
  }

  @After
  public void tearDown() {
    ShadowPendingIntent.reset();
  }

  @Test
  public void differentNotifications_doNotCollide() {
    PendingIntent notificationA =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification-a", null, "done", "payload-a");
    PendingIntent notificationB =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification-b", null, "done", "payload-b");

    assertDistinctAndroidIdentity(notificationA, notificationB);
    assertEquals("payload-a", payloadVersion(savedIntent(notificationA)));
    assertEquals("payload-b", payloadVersion(savedIntent(notificationB)));
  }

  @Test
  public void deleteIntents_forDifferentNotificationsAreDistinct() {
    PendingIntent deleteA =
        createReceiverIntent(ReceiverService.DELETE_INTENT, "notification-a", "tag", null, null);
    PendingIntent deleteB =
        createReceiverIntent(ReceiverService.DELETE_INTENT, "notification-b", "tag", null, null);

    assertDistinctAndroidIdentity(deleteA, deleteB);
  }

  @Test
  public void actionPressIntents_forDifferentNotificationsAreDistinct() {
    PendingIntent actionA =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification-a", "tag", "done", null);
    PendingIntent actionB =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification-b", "tag", "done", null);

    assertDistinctAndroidIdentity(actionA, actionB);
  }

  @Test
  public void actionPressIntents_forDifferentActionsOnSameNotificationAreDistinct() {
    PendingIntent done =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification", "tag", "done", null);
    PendingIntent snooze =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification", "tag", "snooze", null);

    assertDistinctAndroidIdentity(done, snooze);
  }

  @Test
  public void sameInteractionReposted_reusesTokenAndUpdatesExtras() {
    PendingIntent original =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification", "tag", "done", "v1");
    Intent originalIntent = new Intent(Shadows.shadowOf(original).getSavedIntent());
    assertEquals("v1", payloadVersion(originalIntent));

    PendingIntent reposted =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification", "tag", "done", "v2");

    assertEquals(original, reposted);
    Intent updatedIntent = Shadows.shadowOf(reposted).getSavedIntent();
    assertTrue(originalIntent.filterEquals(updatedIntent));
    assertEquals(originalIntent.getData(), updatedIntent.getData());
    assertEquals("v2", payloadVersion(updatedIntent));
  }

  @Test
  public void sameNotificationId_withDifferentTagsIsDistinct() {
    PendingIntent tagA =
        createReceiverIntent(ReceiverService.ACTION_PRESS_INTENT, "same-id", "tag-a", "done", null);
    PendingIntent tagB =
        createReceiverIntent(ReceiverService.ACTION_PRESS_INTENT, "same-id", "tag-b", "done", null);

    assertDistinctAndroidIdentity(tagA, tagB);
  }

  @Test
  public void deletePressAndActionPress_areDistinctInteractionTypes() {
    PendingIntent delete =
        createReceiverIntent(ReceiverService.DELETE_INTENT, "notification", "tag", null, null);
    PendingIntent press =
        createReceiverIntent(ReceiverService.PRESS_INTENT, "notification", "tag", "done", null);
    PendingIntent actionPress =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification", "tag", "done", null);

    assertDistinctAndroidIdentity(delete, press);
    assertDistinctAndroidIdentity(delete, actionPress);
    assertDistinctAndroidIdentity(press, actionPress);
  }

  @Test
  public void delimiterHeavyValues_doNotCreateAmbiguousIdentity() {
    String delimiterHeavyValue = "/?&=%# spazio 雪";
    String tagA = "tag:" + delimiterHeavyValue + ":part";
    String notificationIdA = "item";
    String tagB = "tag:" + delimiterHeavyValue;
    String notificationIdB = "part:item";

    assertEquals(
        naiveColonIdentity(tagA, notificationIdA, "done"),
        naiveColonIdentity(tagB, notificationIdB, "done"));

    PendingIntent interactionA =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, notificationIdA, tagA, "done", null);
    PendingIntent interactionB =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, notificationIdB, tagB, "done", null);

    assertDistinctAndroidIdentity(interactionA, interactionB);

    Uri dataA = savedIntent(interactionA).getData();
    Uri dataB = savedIntent(interactionB).getData();
    assertNotNull(dataA);
    assertNotNull(dataB);
    assertEquals(tagA, dataA.getQueryParameter("notificationTag"));
    assertEquals(notificationIdA, dataA.getQueryParameter("notificationId"));
    assertEquals(tagB, dataB.getQueryParameter("notificationTag"));
    assertEquals(notificationIdB, dataB.getQueryParameter("notificationId"));
  }

  @Test
  public void nullEmptyAndLiteralNullTags_areDistinct() {
    PendingIntent nullTag =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification", null, "done", null);
    PendingIntent emptyTag =
        createReceiverIntent(ReceiverService.ACTION_PRESS_INTENT, "notification", "", "done", null);
    PendingIntent literalNullTag =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification", "null", "done", null);

    assertDistinctAndroidIdentity(nullTag, emptyTag);
    assertDistinctAndroidIdentity(nullTag, literalNullTag);
    assertDistinctAndroidIdentity(emptyTag, literalNullTag);

    Uri nullData = savedIntent(nullTag).getData();
    Uri emptyData = savedIntent(emptyTag).getData();
    Uri literalNullData = savedIntent(literalNullTag).getData();
    assertNotNull(nullData);
    assertNotNull(emptyData);
    assertNotNull(literalNullData);
    assertEquals("0", nullData.getQueryParameter("notificationTagPresent"));
    assertNull(nullData.getQueryParameter("notificationTag"));
    assertEquals("1", emptyData.getQueryParameter("notificationTagPresent"));
    assertEquals("", emptyData.getQueryParameter("notificationTag"));
    assertEquals("1", literalNullData.getQueryParameter("notificationTagPresent"));
    assertEquals("null", literalNullData.getQueryParameter("notificationTag"));
  }

  @Test
  public void requestCode_isStableAndDoesNotDependOnConstructionOrder() {
    PendingIntent originalA =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification-a", "tag", "done", "v1");
    PendingIntent notificationB =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification-b", "tag", "done", null);
    PendingIntent repostedA =
        createReceiverIntent(
            ReceiverService.ACTION_PRESS_INTENT, "notification-a", "tag", "done", "v2");

    ShadowPendingIntent shadowA = Shadows.shadowOf(originalA);
    ShadowPendingIntent shadowB = Shadows.shadowOf(notificationB);
    ShadowPendingIntent shadowRepostedA = Shadows.shadowOf(repostedA);

    assertEquals(shadowA.getRequestCode(), shadowB.getRequestCode());
    assertEquals(shadowA.getRequestCode(), shadowRepostedA.getRequestCode());
    assertNotEquals(originalA, notificationB);
    assertEquals(originalA, repostedA);
    assertEquals("v2", payloadVersion(shadowA.getSavedIntent()));
    assertTrue((shadowA.getFlags() & PendingIntent.FLAG_UPDATE_CURRENT) != 0);
    assertTrue((shadowA.getFlags() & PendingIntent.FLAG_MUTABLE) != 0);
  }

  private static PendingIntent createReceiverIntent(
      String action,
      String notificationId,
      String notificationTag,
      String pressActionId,
      String payloadVersion) {
    Bundle notification = new Bundle();
    notification.putString("id", notificationId);

    Bundle android = new Bundle();
    if (notificationTag != null) {
      android.putString("tag", notificationTag);
    }
    notification.putBundle("android", android);

    if (payloadVersion != null) {
      Bundle data = new Bundle();
      data.putString("version", payloadVersion);
      notification.putBundle("data", data);
    }

    if (pressActionId == null) {
      return ReceiverService.createIntent(action, new String[] {"notification"}, notification);
    }

    Bundle pressAction = new Bundle();
    pressAction.putString("id", pressActionId);
    return ReceiverService.createIntent(
        action, new String[] {"notification", "pressAction"}, notification, pressAction);
  }

  private static void assertDistinctAndroidIdentity(PendingIntent first, PendingIntent second) {
    ShadowPendingIntent firstShadow = Shadows.shadowOf(first);
    ShadowPendingIntent secondShadow = Shadows.shadowOf(second);
    Intent firstIntent = firstShadow.getSavedIntent();
    Intent secondIntent = secondShadow.getSavedIntent();

    assertNotEquals(first, second);
    assertTrue(firstShadow.isService());
    assertTrue(secondShadow.isService());
    assertEquals(firstShadow.getRequestCode(), secondShadow.getRequestCode());
    assertNotNull(firstIntent.getData());
    assertNotNull(secondIntent.getData());
    assertFalse(firstIntent.filterEquals(secondIntent));
    assertNotEquals(firstIntent.getData(), secondIntent.getData());
  }

  private static Intent savedIntent(PendingIntent pendingIntent) {
    Intent intent = Shadows.shadowOf(pendingIntent).getSavedIntent();
    assertNotNull(intent);
    return intent;
  }

  private static String payloadVersion(Intent intent) {
    Bundle notification = intent.getBundleExtra("notification");
    assertNotNull(notification);
    Bundle data = notification.getBundle("data");
    assertNotNull(data);
    return data.getString("version");
  }

  private static String naiveColonIdentity(
      String notificationTag, String notificationId, String pressActionId) {
    return ReceiverService.ACTION_PRESS_INTENT
        + ":"
        + notificationTag
        + ":"
        + notificationId
        + ":"
        + pressActionId;
  }
}
