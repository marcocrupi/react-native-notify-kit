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

import static org.junit.Assert.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;

import android.os.Bundle;
import app.notifee.core.model.NotificationModel;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public class NotificationManagerCreateTriggerNotificationCurrentBehaviorTest {
  private MockedStatic<NotificationManager> notificationManagerMock;
  private NotificationModel notificationModel;

  @Before
  public void setUp() {
    notificationModel = buildNotificationModel("create-trigger-current-behavior");
    notificationManagerMock = mockStatic(NotificationManager.class, CALLS_REAL_METHODS);
    notificationManagerMock
        .when(() -> NotificationManager.createTimestampTriggerNotification(any(), any()))
        .thenReturn(Futures.immediateFuture(null));
    notificationManagerMock
        .when(() -> NotificationManager.createIntervalTriggerNotification(any(), any()))
        .thenReturn(Futures.immediateFuture(null));
  }

  @After
  public void tearDown() {
    if (notificationManagerMock != null) {
      notificationManagerMock.close();
    }
  }

  @Test
  public void createTriggerNotification_missingType_dispatchesTimestampBranch() throws Exception {
    Bundle triggerBundle = new Bundle();

    assertCompletes(NotificationManager.createTriggerNotification(notificationModel, triggerBundle));

    verifyTimestampBranch(triggerBundle);
    verifyIntervalBranchNeverCalled();
  }

  @Test
  public void createTriggerNotification_explicitNullType_dispatchesTimestampBranch()
      throws Exception {
    Bundle triggerBundle = new Bundle();
    triggerBundle.putString("type", null);

    assertCompletes(NotificationManager.createTriggerNotification(notificationModel, triggerBundle));

    verifyTimestampBranch(triggerBundle);
    verifyIntervalBranchNeverCalled();
  }

  @Test
  public void createTriggerNotification_integerZero_dispatchesTimestampBranch() throws Exception {
    Bundle triggerBundle = triggerBundleWithType(Integer.valueOf(0));

    assertCompletes(NotificationManager.createTriggerNotification(notificationModel, triggerBundle));

    verifyTimestampBranch(triggerBundle);
    verifyIntervalBranchNeverCalled();
  }

  @Test
  public void createTriggerNotification_integerOne_dispatchesIntervalBranch() throws Exception {
    Bundle triggerBundle = triggerBundleWithType(Integer.valueOf(1));

    assertCompletes(NotificationManager.createTriggerNotification(notificationModel, triggerBundle));

    verifyIntervalBranch(triggerBundle);
    verifyTimestampBranchNeverCalled();
  }

  @Test
  public void createTriggerNotification_otherInteger_completesWithoutScheduling() throws Exception {
    Bundle triggerBundle = triggerBundleWithType(Integer.valueOf(99));

    assertCompletes(NotificationManager.createTriggerNotification(notificationModel, triggerBundle));

    verifyTimestampBranchNeverCalled();
    verifyIntervalBranchNeverCalled();
  }

  @Test
  public void createTriggerNotification_doubleType_truncatesBeforeDispatch() throws Exception {
    Bundle triggerBundle = triggerBundleWithType(Double.valueOf(1.9d));

    assertCompletes(NotificationManager.createTriggerNotification(notificationModel, triggerBundle));

    verifyIntervalBranch(triggerBundle);
    verifyTimestampBranchNeverCalled();
  }

  @Test
  public void createTriggerNotification_unsupportedType_preservesClassCastException() {
    assertThrows(
        ClassCastException.class,
        () ->
            NotificationManager.createTriggerNotification(
                notificationModel, triggerBundleWithType(Long.valueOf(1L))));
    assertThrows(
        ClassCastException.class,
        () ->
            NotificationManager.createTriggerNotification(
                notificationModel, triggerBundleWithType(Float.valueOf(1.5f))));
    assertThrows(
        ClassCastException.class,
        () ->
            NotificationManager.createTriggerNotification(
                notificationModel, triggerBundleWithType("1")));

    verifyTimestampBranchNeverCalled();
    verifyIntervalBranchNeverCalled();
  }

  private void verifyTimestampBranch(Bundle triggerBundle) {
    notificationManagerMock.verify(
        () ->
            NotificationManager.createTimestampTriggerNotification(
                same(notificationModel), same(triggerBundle)));
  }

  private void verifyIntervalBranch(Bundle triggerBundle) {
    notificationManagerMock.verify(
        () ->
            NotificationManager.createIntervalTriggerNotification(
                same(notificationModel), same(triggerBundle)));
  }

  private void verifyTimestampBranchNeverCalled() {
    notificationManagerMock.verify(
        () -> NotificationManager.createTimestampTriggerNotification(any(), any()), never());
  }

  private void verifyIntervalBranchNeverCalled() {
    notificationManagerMock.verify(
        () -> NotificationManager.createIntervalTriggerNotification(any(), any()), never());
  }

  private static void assertCompletes(ListenableFuture<Void> future) throws Exception {
    future.get(5, TimeUnit.SECONDS);
  }

  private static NotificationModel buildNotificationModel(String id) {
    Bundle notificationBundle = new Bundle();
    notificationBundle.putString("id", id);
    return NotificationModel.fromBundle(notificationBundle);
  }

  private static Bundle triggerBundleWithType(Object type) {
    Bundle triggerBundle = new Bundle();
    putBundleValue(triggerBundle, "type", type);
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
}
