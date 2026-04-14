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

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.fail;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import android.os.Bundle;
import app.notifee.core.database.WorkDataRepository;
import app.notifee.core.model.NotificationModel;
import app.notifee.core.model.TimestampTriggerModel;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.MoreExecutors;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

/**
 * Regression guards for the {@code NotifeeAlarmManager.handleStaleNonRepeatingTrigger} resilience
 * chain introduced for upstream invertase/notifee#734 and hardened in Step 7 after a post-Step-6
 * code review flagged two latent holes:
 *
 * <ol>
 *   <li><b>HIGH #1</b> — {@code Futures.catchingAsync(..., Throwable.class, ...)} was swallowing
 *       {@link Error} subclasses including {@link OutOfMemoryError}. On a memory-pressured cold
 *       boot (the exact target scenario of #734) this would mask a JVM-level failure and cause the
 *       handler to proceed to a Room write seconds before process termination. Narrowed to {@link
 *       Exception} so Errors propagate as batch failures.
 *   <li><b>MEDIUM #1</b> — if {@code NotificationManager.displayNotification} threw a synchronous
 *       exception before returning its {@link ListenableFuture} (e.g. NPE from {@code
 *       NotificationModel.getAndroid()} upstream of the work Callable), the throw would bypass
 *       {@code catchingAsync} entirely because the primary input future did not yet exist. Wrapping
 *       the call in {@link Futures#submitAsync} converts any sync throw from the {@code
 *       AsyncCallable} into a failed future the catching branch can observe.
 * </ol>
 *
 * <p>Test strategy: {@link MockedStatic} intercepts both {@code NotificationManager} and {@code
 * WorkDataRepository} static calls so the helper can be exercised in isolation without a real
 * Android notification channel, a real notification post, or a real Room database. Each test stubs
 * {@code displayNotification} with a specific failure shape and asserts whether {@code deleteById}
 * is invoked.
 *
 * <p>Mockito 5.x's default {@link org.mockito.internal.creation.bytebuddy.InlineByteBuddyMockMaker}
 * makes {@code mockStatic} available without an explicit {@code mockito-inline} dependency — the
 * fork already uses {@code mockito-core:5.19.0} per {@code build.gradle:154}.
 */
@RunWith(RobolectricTestRunner.class)
public class NotifeeAlarmManagerHandleStaleTest {

  /** 1 hour in the past — well inside the 24h STALE_TRIGGER_GRACE_PERIOD_MS window. */
  private static final long STALE_WITHIN_GRACE_OFFSET_MS = 60L * 60 * 1000;

  /**
   * Same-thread executor. Required because Mockito {@link MockedStatic} stubs are thread-local to
   * the thread that activated them — if the production code dispatched the {@code
   * submitAsync}/{@code catchingAsync}/{@code transformAsync} chain to a worker thread pool, the
   * real {@code NotificationManager.displayNotification} would be called instead of the stub,
   * masking the exact regression this test is guarding against. Passing the directExecutor into the
   * {@code handleStaleNonRepeatingTrigger(..., Executor)} overload keeps the whole chain on the
   * test thread where the stubs are active.
   */
  private static final Executor DIRECT_EXECUTOR = MoreExecutors.directExecutor();

  private MockedStatic<NotificationManager> notificationManagerMock;
  private MockedStatic<WorkDataRepository> workDataRepositoryMock;
  private WorkDataRepository mockRepo;

  @Before
  public void setUp() {
    // ContextHolder is consulted inside handleStaleNonRepeatingTrigger via
    // WorkDataRepository.getInstance(getApplicationContext()) — populate with Robolectric's
    // application context so the static call does not NPE before our mock intercepts it.
    ContextHolder.setApplicationContext(RuntimeEnvironment.getApplication());

    mockRepo = mock(WorkDataRepository.class);
    // deleteById is the terminal step of the resilient chain. Default stub returns an immediate
    // success so the outer future completes cleanly; individual tests can override.
    when(mockRepo.deleteById(anyString())).thenReturn(Futures.immediateFuture(null));

    workDataRepositoryMock = mockStatic(WorkDataRepository.class);
    workDataRepositoryMock.when(() -> WorkDataRepository.getInstance(any())).thenReturn(mockRepo);

    notificationManagerMock = mockStatic(NotificationManager.class);
  }

  @After
  public void tearDown() {
    if (notificationManagerMock != null) {
      notificationManagerMock.close();
    }
    if (workDataRepositoryMock != null) {
      workDataRepositoryMock.close();
    }
  }

  // ─── Test 3.1: Exception in display → row deleted (happy-resilience path) ───

  @Test
  public void handleStaleNonRepeatingTrigger_displayFailsWithRuntimeException_rowIsDeleted()
      throws Exception {
    notificationManagerMock
        .when(() -> NotificationManager.displayNotification(any(), any()))
        .thenReturn(Futures.immediateFailedFuture(new RuntimeException("synthetic display fail")));

    NotificationModel model = buildStaleModel("test-runtime-exception");
    TimestampTriggerModel trigger = buildStaleWithinGraceTrigger();

    ListenableFuture<Void> result =
        NotifeeAlarmManager.handleStaleNonRepeatingTrigger(model, trigger, DIRECT_EXECUTOR);

    assertNotNull("helper must return a non-null future for a stale trigger", result);
    // Must complete without throwing — catchingAsync swallows the Exception and proceeds.
    result.get(5, TimeUnit.SECONDS);
    verify(mockRepo, times(1)).deleteById("test-runtime-exception");
  }

  // ─── Test 3.2: Error in display → row NOT deleted, Error propagates ──────────
  //     This is the HIGH #1 regression guard. Before the fix, Throwable.class
  //     would have caught the OOM and proceeded to deleteById. After the fix,
  //     Exception.class lets Errors propagate so the per-entity catch in
  //     rescheduleNotifications leaves the row in Room for a real retry.

  @Test
  public void handleStaleNonRepeatingTrigger_displayFailsWithError_rowIsNotDeleted_errorPropagates()
      throws Exception {
    OutOfMemoryError oom = new OutOfMemoryError("synthetic OOM");
    notificationManagerMock
        .when(() -> NotificationManager.displayNotification(any(), any()))
        .thenReturn(Futures.immediateFailedFuture(oom));

    NotificationModel model = buildStaleModel("test-oom");
    TimestampTriggerModel trigger = buildStaleWithinGraceTrigger();

    ListenableFuture<Void> result =
        NotifeeAlarmManager.handleStaleNonRepeatingTrigger(model, trigger, DIRECT_EXECUTOR);

    assertNotNull("helper must return a non-null future for a stale trigger", result);

    ExecutionException thrown = null;
    try {
      result.get(5, TimeUnit.SECONDS);
      fail("Error must propagate as ExecutionException — not be swallowed by catchingAsync");
    } catch (ExecutionException e) {
      thrown = e;
    }
    assertNotNull(thrown);
    assertSame(
        "underlying cause must be the original OutOfMemoryError, not a wrapped RuntimeException",
        oom,
        thrown.getCause());

    verify(mockRepo, never()).deleteById(anyString());
  }

  // ─── Test 3.3: Sync throw in display → row deleted via submitAsync wrap ─────
  //     This is the MEDIUM #1 regression guard. Before the fix, a sync throw
  //     upstream of the Callable would bypass catchingAsync because the primary
  //     future never existed. After the fix, Futures.submitAsync intercepts the
  //     sync throw and converts it into a failed future catchingAsync can catch.

  @Test
  public void handleStaleNonRepeatingTrigger_syncThrowInDisplay_rowIsDeleted_viaSubmitAsyncWrap()
      throws Exception {
    notificationManagerMock
        .when(() -> NotificationManager.displayNotification(any(), any()))
        .thenThrow(new IllegalStateException("synthetic sync throw before future creation"));

    NotificationModel model = buildStaleModel("test-sync-throw");
    TimestampTriggerModel trigger = buildStaleWithinGraceTrigger();

    ListenableFuture<Void> result =
        NotifeeAlarmManager.handleStaleNonRepeatingTrigger(model, trigger, DIRECT_EXECUTOR);

    assertNotNull("helper must return a non-null future for a stale trigger", result);
    // Must complete without throwing — submitAsync converts the sync throw into a failed
    // future, catchingAsync intercepts, and the chain proceeds to deleteById.
    result.get(5, TimeUnit.SECONDS);
    verify(mockRepo, times(1)).deleteById("test-sync-throw");
  }

  // ─── Builders ──────────────────────────────────────────────────────────────

  private static NotificationModel buildStaleModel(String id) {
    Bundle notificationBundle = new Bundle();
    notificationBundle.putString("id", id);
    notificationBundle.putString("title", "HandleStaleTest " + id);

    // A well-formed android sub-bundle is included so the path that the mock intercepts never
    // touches a malformed NotificationModel — the test is exclusively about the resilient chain
    // in handleStaleNonRepeatingTrigger, not about NotificationModel shape validation.
    Bundle androidBundle = new Bundle();
    androidBundle.putString("channelId", "handle-stale-test-channel");
    notificationBundle.putBundle("android", androidBundle);

    return NotificationModel.fromBundle(notificationBundle);
  }

  private static TimestampTriggerModel buildStaleWithinGraceTrigger() {
    long anchorMs = System.currentTimeMillis() - STALE_WITHIN_GRACE_OFFSET_MS;

    Bundle triggerBundle = new Bundle();
    triggerBundle.putInt("type", 0); // TIMESTAMP
    triggerBundle.putLong("timestamp", anchorMs);
    triggerBundle.putInt("repeatFrequency", -1); // non-repeating
    Bundle alarmManagerBundle = new Bundle();
    alarmManagerBundle.putInt("type", 3); // SET_EXACT_AND_ALLOW_WHILE_IDLE
    triggerBundle.putBundle("alarmManager", alarmManagerBundle);

    return TimestampTriggerModel.fromBundle(triggerBundle);
  }
}
