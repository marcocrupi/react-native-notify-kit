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
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import android.app.AlarmManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.os.Bundle;
import androidx.core.app.NotificationChannelCompat;
import androidx.core.app.NotificationManagerCompat;
import app.notifee.core.database.WorkDataEntity;
import app.notifee.core.database.WorkDataRepository;
import app.notifee.core.utility.AlarmUtils;
import app.notifee.core.utility.ObjectUtils;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class NotifeeAlarmManagerCurrentBehaviorTest {
  private static final String CHANNEL_ID = "manager-current-behavior-channel";
  private static final long OLD_ANCHOR_OFFSET_MS = TimeUnit.HOURS.toMillis(2);

  private Context context;
  private WorkDataRepository repo;

  @Before
  public void setUp() throws Exception {
    context = RuntimeEnvironment.getApplication();
    ContextHolder.setApplicationContext(context);
    repo = WorkDataRepository.getInstance(context);
    repo.deleteAll().get(5, TimeUnit.SECONDS);

    NotificationChannelCompat channel =
        new NotificationChannelCompat.Builder(
                CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_DEFAULT)
            .setName("Manager Current Behavior")
            .build();
    NotificationManagerCompat.from(context).createNotificationChannel(channel);
  }

  @After
  public void tearDown() throws Exception {
    if (repo != null) {
      repo.deleteAll().get(5, TimeUnit.SECONDS);
    }
    if (context != null) {
      NotificationManagerCompat.from(context).cancelAll();
    }
  }

  @Test
  public void displayScheduledNotification_missingRepeatFrequency_deletesRoomRow()
      throws Exception {
    String id = "am-repeat-missing";
    long oldAnchor = oldAnchor();
    seedDisplayRow(id, timestampTriggerWithRepeatValue(null, false, oldAnchor));

    runDisplayScheduledNotification(id);

    assertNull(
        "missing repeatFrequency must take the one-shot delete branch",
        repo.getWorkDataById(id).get(5, TimeUnit.SECONDS));
  }

  @Test
  public void displayScheduledNotification_explicitNullRepeatFrequency_updatesRoomRow()
      throws Exception {
    String id = "am-repeat-null";
    long oldAnchor = oldAnchor();
    seedDisplayRow(id, timestampTriggerWithRepeatValue(null, true, oldAnchor));

    long minExpectedAnchor = System.currentTimeMillis();
    runDisplayScheduledNotification(id);

    assertRowUpdatedToFuture(id, oldAnchor, minExpectedAnchor);
  }

  @Test
  public void displayScheduledNotification_minusOneRepeatFrequency_deletesRoomRow()
      throws Exception {
    String id = "am-repeat-minus-one";
    long oldAnchor = oldAnchor();
    seedDisplayRow(id, timestampTriggerWithRepeatValue(Integer.valueOf(-1), true, oldAnchor));

    runDisplayScheduledNotification(id);

    assertNull(
        "repeatFrequency -1 must take the one-shot delete branch",
        repo.getWorkDataById(id).get(5, TimeUnit.SECONDS));
  }

  @Test
  public void displayScheduledNotification_integerRepeatFrequencies_updateRoomRow()
      throws Exception {
    for (int repeatFrequency = 0; repeatFrequency <= 3; repeatFrequency++) {
      String id = "am-repeat-int-" + repeatFrequency;
      long oldAnchor = oldAnchor();
      seedDisplayRow(id, timestampTriggerWithRepeatValue(repeatFrequency, true, oldAnchor));

      long minExpectedAnchor = System.currentTimeMillis();
      runDisplayScheduledNotification(id);

      assertRowUpdatedToFuture(id, oldAnchor, minExpectedAnchor);
    }
  }

  @Test
  public void displayScheduledNotification_doubleRepeatFrequency_truncatesAndUpdatesRoomRow()
      throws Exception {
    String id = "am-repeat-double";
    long oldAnchor = oldAnchor();
    seedDisplayRow(id, timestampTriggerWithRepeatValue(Double.valueOf(0.9d), true, oldAnchor));

    long minExpectedAnchor = System.currentTimeMillis();
    runDisplayScheduledNotification(id);

    assertRowUpdatedToFuture(id, oldAnchor, minExpectedAnchor);
  }

  @Test
  public void displayScheduledNotification_unsupportedRepeatFrequency_keepsRoomRowUnchanged()
      throws Exception {
    assertUnsupportedRepeatFrequencyKeepsRow(Long.valueOf(0L), "long");
    assertUnsupportedRepeatFrequencyKeepsRow(Float.valueOf(0.5f), "float");
    assertUnsupportedRepeatFrequencyKeepsRow("0", "string");
  }

  @Test
  public void rescheduleNotification_missingType_dispatchesTimestampAndUpdatesRoomRow()
      throws Exception {
    WorkDataEntity updated =
        runRescheduleNotificationExpectingUpdate(rescheduleTriggerWithType(null, false));

    assertEquals("am-type", updated.getId());
  }

  @Test
  public void rescheduleNotification_explicitNullType_dispatchesTimestampAndUpdatesRoomRow()
      throws Exception {
    WorkDataEntity updated =
        runRescheduleNotificationExpectingUpdate(rescheduleTriggerWithType(null, true));

    assertEquals("am-type", updated.getId());
  }

  @Test
  public void rescheduleNotification_integerZero_dispatchesTimestampAndUpdatesRoomRow()
      throws Exception {
    WorkDataEntity updated =
        runRescheduleNotificationExpectingUpdate(
            rescheduleTriggerWithType(Integer.valueOf(0), true));

    assertEquals("am-type", updated.getId());
  }

  @Test
  public void rescheduleNotification_integerOne_completesWithoutRoomUpdate() throws Exception {
    runRescheduleNotificationExpectingNoUpdate(rescheduleTriggerWithType(Integer.valueOf(1), true));
  }

  @Test
  public void rescheduleNotification_otherInteger_completesWithoutRoomUpdate() throws Exception {
    runRescheduleNotificationExpectingNoUpdate(rescheduleTriggerWithType(Integer.valueOf(99), true));
  }

  @Test
  public void rescheduleNotification_doubleType_truncatesToTimestampBranch() throws Exception {
    WorkDataEntity updated =
        runRescheduleNotificationExpectingUpdate(
            rescheduleTriggerWithType(Double.valueOf(0.9d), true));

    assertEquals("am-type", updated.getId());
  }

  @Test
  public void rescheduleNotification_unsupportedType_preservesClassCastException() {
    assertUnsupportedTypeThrows(Long.valueOf(0L));
    assertUnsupportedTypeThrows(Float.valueOf(0.5f));
    assertUnsupportedTypeThrows("0");
  }

  @Test
  public void rescheduleNotifications_intervalAndDefaultType_keepRoomRowsUnchanged()
      throws Exception {
    assertRescheduleNotificationsKeepsRowUnchanged(Integer.valueOf(1), "interval");
    assertRescheduleNotificationsKeepsRowUnchanged(Integer.valueOf(99), "default");
  }

  @Test
  public void rescheduleNotifications_unsupportedType_keepsRoomRowAfterPerEntityCatch()
      throws Exception {
    assertRescheduleNotificationsKeepsRowUnchanged(Long.valueOf(0L), "long");
    assertRescheduleNotificationsKeepsRowUnchanged(Float.valueOf(0.5f), "float");
    assertRescheduleNotificationsKeepsRowUnchanged("0", "string");
  }

  private void assertUnsupportedRepeatFrequencyKeepsRow(Object repeatFrequency, String suffix)
      throws Exception {
    String id = "am-repeat-" + suffix;
    long oldAnchor = oldAnchor();
    seedDisplayRow(id, timestampTriggerWithRepeatValue(repeatFrequency, true, oldAnchor));

    runDisplayScheduledNotification(id);

    WorkDataEntity row = repo.getWorkDataById(id).get(5, TimeUnit.SECONDS);
    assertNotNull(
        "unsupported repeatFrequency must fail before update/delete and leave the row", row);
    assertEquals(
        "unsupported repeatFrequency must not rewrite the persisted timestamp",
        oldAnchor,
        triggerTimestamp(row));
  }

  private void assertRescheduleNotificationsKeepsRowUnchanged(Object typeValue, String suffix)
      throws Exception {
    repo.deleteAll().get(5, TimeUnit.SECONDS);
    String id = "am-type-reboot-" + suffix;
    Bundle triggerBundle = rescheduleTriggerWithType(typeValue, true);
    seedDisplayRow(id, triggerBundle);
    long originalTimestamp =
        triggerTimestamp(repo.getWorkDataById(id).get(5, TimeUnit.SECONDS));

    runRescheduleNotificationsFromRoom();

    WorkDataEntity row = repo.getWorkDataById(id).get(5, TimeUnit.SECONDS);
    assertNotNull("reboot recovery must leave no-op/wrong-type rows in Room", row);
    assertEquals(
        "reboot recovery must not rewrite no-op/wrong-type trigger rows",
        originalTimestamp,
        triggerTimestamp(row));
  }

  private WorkDataEntity runRescheduleNotificationExpectingUpdate(Bundle triggerBundle)
      throws Exception {
    WorkDataRepository mockRepo = mock(WorkDataRepository.class);
    when(mockRepo.update(any())).thenReturn(Futures.immediateFuture(null));
    AlarmManager mockAlarmManager = mock(AlarmManager.class);
    ArgumentCaptor<WorkDataEntity> updateCaptor = ArgumentCaptor.forClass(WorkDataEntity.class);

    try (MockedStatic<WorkDataRepository> repoMock = mockStatic(WorkDataRepository.class);
        MockedStatic<AlarmUtils> alarmUtilsMock = mockStatic(AlarmUtils.class)) {
      repoMock.when(() -> WorkDataRepository.getInstance(any())).thenReturn(mockRepo);
      alarmUtilsMock.when(AlarmUtils::getAlarmManager).thenReturn(mockAlarmManager);

      new NotifeeAlarmManager()
          .rescheduleNotification(buildEntity("am-type", triggerBundle))
          .get(5, TimeUnit.SECONDS);

      verify(mockRepo).update(updateCaptor.capture());
      return updateCaptor.getValue();
    }
  }

  private void runRescheduleNotificationExpectingNoUpdate(Bundle triggerBundle) throws Exception {
    WorkDataRepository mockRepo = mock(WorkDataRepository.class);
    AlarmManager mockAlarmManager = mock(AlarmManager.class);

    try (MockedStatic<WorkDataRepository> repoMock = mockStatic(WorkDataRepository.class);
        MockedStatic<AlarmUtils> alarmUtilsMock = mockStatic(AlarmUtils.class)) {
      repoMock.when(() -> WorkDataRepository.getInstance(any())).thenReturn(mockRepo);
      alarmUtilsMock.when(AlarmUtils::getAlarmManager).thenReturn(mockAlarmManager);

      new NotifeeAlarmManager()
          .rescheduleNotification(buildEntity("am-type", triggerBundle))
          .get(5, TimeUnit.SECONDS);

      verify(mockRepo, never()).update(any());
    }
  }

  private void assertUnsupportedTypeThrows(Object typeValue) {
    WorkDataRepository mockRepo = mock(WorkDataRepository.class);

    try (MockedStatic<WorkDataRepository> repoMock = mockStatic(WorkDataRepository.class)) {
      repoMock.when(() -> WorkDataRepository.getInstance(any())).thenReturn(mockRepo);

      assertThrows(
          ClassCastException.class,
          () ->
              new NotifeeAlarmManager()
                  .rescheduleNotification(
                      buildEntity("am-type", rescheduleTriggerWithType(typeValue, true))));

      verify(mockRepo, never()).update(any());
    }
  }

  private void runDisplayScheduledNotification(String id) {
    BroadcastReceiver.PendingResult pendingResult = mock(BroadcastReceiver.PendingResult.class);
    Bundle alarmManagerNotification = new Bundle();
    alarmManagerNotification.putString("notificationId", id);

    NotifeeAlarmManager.displayScheduledNotification(alarmManagerNotification, pendingResult);

    verify(pendingResult, timeout(10_000)).finish();
  }

  private void runRescheduleNotificationsFromRoom() {
    BroadcastReceiver.PendingResult pendingResult = mock(BroadcastReceiver.PendingResult.class);

    new RoomBackedAlarmManager().rescheduleNotifications(pendingResult);

    verify(pendingResult, timeout(10_000)).finish();
  }

  private void seedDisplayRow(String id, Bundle triggerBundle) throws Exception {
    repo.insert(buildEntity(id, triggerBundle)).get(5, TimeUnit.SECONDS);
  }

  private WorkDataEntity buildEntity(String id, Bundle triggerBundle) {
    return new WorkDataEntity(
        id,
        ObjectUtils.bundleToBytes(notificationBundle(id)),
        ObjectUtils.bundleToBytes(triggerBundle),
        true);
  }

  private void assertRowUpdatedToFuture(String id, long oldAnchor, long minExpectedAnchor)
      throws Exception {
    WorkDataEntity row = repo.getWorkDataById(id).get(5, TimeUnit.SECONDS);
    assertNotNull("repeating trigger row must survive after update branch", row);

    long updatedAnchor = triggerTimestamp(row);
    assertTrue(
        "repeating trigger timestamp must be advanced by the update branch",
        updatedAnchor > oldAnchor);
    assertTrue(
        "repeating trigger timestamp must be advanced to the future",
        updatedAnchor >= minExpectedAnchor);
  }

  private static long triggerTimestamp(WorkDataEntity row) {
    return ObjectUtils.getLong(ObjectUtils.bytesToBundle(row.getTrigger()).get("timestamp"));
  }

  private static long oldAnchor() {
    return System.currentTimeMillis() - OLD_ANCHOR_OFFSET_MS;
  }

  private static Bundle notificationBundle(String id) {
    Bundle notificationBundle = new Bundle();
    notificationBundle.putString("id", id);
    notificationBundle.putString("title", "Manager Current Behavior " + id);

    Bundle androidBundle = new Bundle();
    androidBundle.putString("channelId", CHANNEL_ID);
    notificationBundle.putBundle("android", androidBundle);

    return notificationBundle;
  }

  private static Bundle timestampTriggerWithRepeatValue(
      Object repeatFrequency, boolean includeRepeatFrequency, long timestamp) {
    Bundle triggerBundle = new Bundle();
    triggerBundle.putInt("type", 0);
    triggerBundle.putLong("timestamp", timestamp);
    if (includeRepeatFrequency) {
      putBundleValue(triggerBundle, "repeatFrequency", repeatFrequency);
    }

    Bundle alarmManagerBundle = new Bundle();
    alarmManagerBundle.putInt("type", 3);
    triggerBundle.putBundle("alarmManager", alarmManagerBundle);

    return triggerBundle;
  }

  private static Bundle rescheduleTriggerWithType(Object typeValue, boolean includeType) {
    Bundle triggerBundle = new Bundle();
    if (includeType) {
      putBundleValue(triggerBundle, "type", typeValue);
    }
    triggerBundle.putLong("timestamp", System.currentTimeMillis() + TimeUnit.MINUTES.toMillis(10));
    triggerBundle.putInt("repeatFrequency", 0);

    Bundle alarmManagerBundle = new Bundle();
    alarmManagerBundle.putInt("type", 3);
    triggerBundle.putBundle("alarmManager", alarmManagerBundle);

    return triggerBundle;
  }

  private static void putBundleValue(Bundle bundle, String key, Object value) {
    if (value == null) {
      bundle.putString(key, null);
    } else if (value instanceof Integer) {
      bundle.putInt(key, (Integer) value);
    } else if (value instanceof Double) {
      bundle.putDouble(key, (Double) value);
    } else if (value instanceof Long) {
      bundle.putLong(key, (Long) value);
    } else if (value instanceof Float) {
      bundle.putFloat(key, (Float) value);
    } else if (value instanceof String) {
      bundle.putString(key, (String) value);
    } else {
      throw new IllegalArgumentException("Unsupported test value: " + value);
    }
  }

  private class RoomBackedAlarmManager extends NotifeeAlarmManager {
    @Override
    ListenableFuture<List<WorkDataEntity>> getScheduledNotifications() {
      return repo.getAllWithAlarmManager(true);
    }
  }
}
