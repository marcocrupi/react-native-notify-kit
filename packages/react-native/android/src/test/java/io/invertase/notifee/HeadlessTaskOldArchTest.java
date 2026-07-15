package io.invertase.notifee;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import android.app.Application;
import android.os.Looper;
import androidx.annotation.Nullable;
import app.notifee.core.ContextHolder;
import com.facebook.react.ReactApplication;
import com.facebook.react.ReactHost;
import com.facebook.react.ReactInstanceEventListener;
import com.facebook.react.ReactInstanceManager;
import com.facebook.react.ReactNativeHost;
import com.facebook.react.bridge.JavaOnlyMap;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.common.LifecycleState;
import com.facebook.react.modules.appregistry.AppRegistry;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.ArgumentCaptor;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

/**
 * Regression coverage for the Old Architecture (bridge mode) fallback, where the application
 * exposes no bridgeless ReactHost (getReactHost() returns null) and the React context must be
 * resolved through ReactNativeHost/ReactInstanceManager.
 *
 * <p>Prior to the fix for marcocrupi/react-native-notify-kit#47, getReactContext() threw
 * "AssertionError: getReactHost() is null in New Architecture" in this configuration, which
 * silently dropped every bridge event (onForegroundEvent press/dismiss/delivery) and broke headless
 * task startup on the Old Architecture.
 */
@RunWith(RobolectricTestRunner.class)
@Config(application = HeadlessTaskOldArchTest.TestApplication.class, sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class HeadlessTaskOldArchTest {

  private TestApplication application;
  private ReactNativeHost reactNativeHost;
  private ReactInstanceManager reactInstanceManager;

  @Before
  public void setUp() {
    application = (TestApplication) RuntimeEnvironment.getApplication();
    reactNativeHost = mock(ReactNativeHost.class);
    reactInstanceManager = mock(ReactInstanceManager.class);
    when(reactNativeHost.getReactInstanceManager()).thenReturn(reactInstanceManager);
    application.reactNativeHost = reactNativeHost;
    ContextHolder.setApplicationContext(application);
    Shadows.shadowOf(Looper.getMainLooper()).idle();
  }

  @Test
  public void getReactContext_withoutReactHost_fallsBackToReactInstanceManager() {
    ReactContext reactContext = mock(ReactContext.class);
    when(reactInstanceManager.getCurrentReactContext()).thenReturn(reactContext);

    assertSame(reactContext, HeadlessTask.getReactContext(application));
  }

  @Test
  public void sendEvent_withoutReactHost_emitsToDeviceEventEmitter() {
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    ReactContext reactContext = mock(ReactContext.class);
    when(reactContext.hasActiveReactInstance()).thenReturn(true);
    when(reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);
    when(reactInstanceManager.getCurrentReactContext()).thenReturn(reactContext);

    JavaOnlyMap eventMap = new JavaOnlyMap();
    eventMap.putString("source", "old-arch-test");
    NotifeeReactUtils.INSTANCE.sendEvent("app.notifee.notification-event", eventMap);

    verify(emitter).emit("app.notifee.notification-event", eventMap);
  }

  @Test
  public void startTask_withoutReactHost_initializesViaReactInstanceManagerAndDrains() {
    JavaOnlyMap params = new JavaOnlyMap();
    params.putString("source", "old-arch-test");

    HeadlessTask headlessTask = new HeadlessTask();
    HeadlessTask.TaskConfig taskConfig =
        new HeadlessTask.TaskConfig("old-arch-headless-task", 60000L, params, null);
    AppRegistry appRegistry = mock(AppRegistry.class);
    ReactContext reactContext = createReactContext(appRegistry);

    WritableMap copiedParams = taskConfig.getTaskConfig().getData();

    headlessTask.startTask(application, taskConfig);

    ArgumentCaptor<ReactInstanceEventListener> listenerCaptor =
        ArgumentCaptor.forClass(ReactInstanceEventListener.class);
    verify(reactInstanceManager).addReactInstanceEventListener(listenerCaptor.capture());
    verify(reactInstanceManager).createReactContextInBackground();
    verify(appRegistry, never())
        .startHeadlessTask(anyInt(), any(String.class), any(WritableMap.class));

    when(reactInstanceManager.getCurrentReactContext()).thenReturn(reactContext);
    ReactInstanceEventListener listener = listenerCaptor.getValue();
    listener.onReactContextInitialized(reactContext);

    verify(reactInstanceManager).removeReactInstanceEventListener(listener);
    Shadows.shadowOf(Looper.getMainLooper())
        .idleFor(499, java.util.concurrent.TimeUnit.MILLISECONDS);
    verify(appRegistry, never())
        .startHeadlessTask(anyInt(), any(String.class), any(WritableMap.class));

    Shadows.shadowOf(Looper.getMainLooper()).idleFor(1, java.util.concurrent.TimeUnit.MILLISECONDS);

    ArgumentCaptor<Integer> taskIdCaptor = ArgumentCaptor.forClass(Integer.class);
    verify(appRegistry)
        .startHeadlessTask(
            taskIdCaptor.capture(), eq("old-arch-headless-task"), same(copiedParams));
    assertEquals(taskIdCaptor.getValue().intValue(), taskConfig.getReactTaskId());
    assertEquals(
        "copied params should receive the native task id",
        taskConfig.getTaskId(),
        copiedParams.getInt("taskId"));
  }

  private static ReactContext createReactContext(AppRegistry appRegistry) {
    ReactContext reactContext = mock(ReactContext.class);
    when(reactContext.getLifecycleState()).thenReturn(LifecycleState.BEFORE_RESUME);
    when(reactContext.hasActiveReactInstance()).thenReturn(true);
    when(reactContext.getJSModule(AppRegistry.class)).thenReturn(appRegistry);
    return reactContext;
  }

  public static class TestApplication extends Application implements ReactApplication {
    ReactNativeHost reactNativeHost;

    @Override
    public ReactNativeHost getReactNativeHost() {
      return reactNativeHost;
    }

    // Old Architecture applications expose no bridgeless ReactHost.
    @Override
    public @Nullable ReactHost getReactHost() {
      return null;
    }
  }
}
