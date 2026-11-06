package io.invertase.notifee;

import static org.junit.Assert.assertSame;
import static org.mockito.AdditionalMatchers.aryEq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.withSettings;

import android.Manifest;
import android.app.Activity;
import android.os.Looper;
import app.notifee.core.Notifee;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.modules.core.PermissionAwareActivity;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

/** TurboModule promise methods run on the native modules thread, not on the main thread. */
@RunWith(RobolectricTestRunner.class)
@Config(
    manifest = Config.NONE,
    sdk = {33, 36})
@LooperMode(LooperMode.Mode.PAUSED)
public class RequestPermissionThreadTest {
  private static final String[] POST_NOTIFICATIONS = {Manifest.permission.POST_NOTIFICATIONS};

  private PermissionAwareActivity activity;
  private NotifeeApiModule module;
  private ReadableMap permissions;
  private Promise promise;

  @Before
  public void setUp() {
    ReactApplicationContext context = mock(ReactApplicationContext.class);
    Activity currentActivity =
        mock(Activity.class, withSettings().extraInterfaces(PermissionAwareActivity.class));
    activity = (PermissionAwareActivity) currentActivity;
    when(context.getCurrentActivity()).thenReturn(currentActivity);
    module = new NotifeeApiModule(context);
    permissions = mock(ReadableMap.class);
    promise = mock(Promise.class);
  }

  private void requestFromModulesThread() throws InterruptedException {
    Thread modulesThread = new Thread(() -> module.requestPermission(permissions, promise));
    modulesThread.start();
    modulesThread.join();
  }

  @Test
  public void startsThePermissionActivityOnTheMainThread() throws Exception {
    AtomicReference<Thread> requestThread = new AtomicReference<>();
    doAnswer(
            invocation -> {
              requestThread.set(Thread.currentThread());
              return null;
            })
        .when(activity)
        .requestPermissions(any(), anyInt(), any());

    requestFromModulesThread();
    verify(activity, never()).requestPermissions(any(), anyInt(), any());

    Shadows.shadowOf(Looper.getMainLooper()).idle();
    verify(activity)
        .requestPermissions(
            aryEq(POST_NOTIFICATIONS),
            eq(Notifee.REQUEST_CODE_NOTIFICATION_PERMISSION),
            same(module));
    assertSame(Looper.getMainLooper().getThread(), requestThread.get());
    verifyNoMoreInteractions(promise);
  }

  @Test
  public void aRequestThatThrowsOnTheMainThreadStillRejects() throws Exception {
    IllegalStateException failure = new IllegalStateException("activity is finishing");
    doThrow(failure).when(activity).requestPermissions(any(), anyInt(), any());

    requestFromModulesThread();
    Shadows.shadowOf(Looper.getMainLooper()).idle();

    verify(promise).reject(failure);
    verifyNoMoreInteractions(promise);
  }
}
