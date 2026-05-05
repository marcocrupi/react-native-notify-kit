package io.invertase.notifee;

import static org.junit.Assert.assertEquals;
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
import app.notifee.core.ContextHolder;
import com.facebook.react.ReactInstanceEventListener;
import com.facebook.react.bridge.JavaOnlyMap;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.common.LifecycleState;
import com.facebook.react.modules.appregistry.AppRegistry;
import java.util.ArrayList;
import java.util.List;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.ArgumentCaptor;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

@RunWith(RobolectricTestRunner.class)
@Config(application = HeadlessTaskReactHostTest.TestApplication.class, sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class HeadlessTaskReactHostTest {

  private TestApplication application;

  @Before
  public void setUp() {
    application = (TestApplication) RuntimeEnvironment.getApplication();
    application.reactHost.reset();
    ContextHolder.setApplicationContext(application);
    Shadows.shadowOf(Looper.getMainLooper()).idle();
  }

  @Test
  public void startTask_whenReactContextInitializes_drainsQueuedTaskAfterCurrentDelay() {
    JavaOnlyMap params = new JavaOnlyMap();
    params.putString("source", "react-host-test");

    HeadlessTask headlessTask = new HeadlessTask();
    HeadlessTask.TaskConfig taskConfig =
        new HeadlessTask.TaskConfig("test-headless-task", 60000L, params, null);
    ReactContext reactContext = mock(ReactContext.class);
    AppRegistry appRegistry = mock(AppRegistry.class);
    when(reactContext.getLifecycleState()).thenReturn(LifecycleState.BEFORE_RESUME);
    when(reactContext.hasActiveReactInstance()).thenReturn(true);
    when(reactContext.getJSModule(AppRegistry.class)).thenReturn(appRegistry);

    WritableMap copiedParams = taskConfig.getTaskConfig().getData();

    headlessTask.startTask(application, taskConfig);

    assertEquals(
        "ReactHost should be started through reflection", 1, application.reactHost.startCalls);
    assertEquals(
        "ReactContext listener should be registered through reflection",
        1,
        application.reactHost.listeners.size());
    verify(appRegistry, never())
        .startHeadlessTask(anyInt(), any(String.class), any(WritableMap.class));

    ReactInstanceEventListener listener = application.reactHost.listeners.get(0);
    listener.onReactContextInitialized(reactContext);

    assertEquals(
        "ReactContext listener should be removed after initialization",
        0,
        application.reactHost.listeners.size());
    Shadows.shadowOf(Looper.getMainLooper()).idleFor(499, java.util.concurrent.TimeUnit.MILLISECONDS);
    verify(appRegistry, never()).startHeadlessTask(anyInt(), any(String.class), any(WritableMap.class));

    Shadows.shadowOf(Looper.getMainLooper()).idleFor(1, java.util.concurrent.TimeUnit.MILLISECONDS);

    ArgumentCaptor<Integer> taskIdCaptor = ArgumentCaptor.forClass(Integer.class);
    verify(appRegistry)
        .startHeadlessTask(
            taskIdCaptor.capture(), eq("test-headless-task"), same(copiedParams));
    assertEquals(taskIdCaptor.getValue().intValue(), taskConfig.getReactTaskId());
    assertEquals(
        "source payload should be copied into the queued task",
        "react-host-test",
        copiedParams.getString("source"));
    assertEquals(
        "copied params should receive the native task id",
        taskConfig.getTaskId(),
        copiedParams.getInt("taskId"));
  }

  public static class TestApplication extends Application {
    final TestReactHost reactHost = new TestReactHost();

    public TestReactHost getReactHost() {
      return reactHost;
    }
  }

  public static class TestReactHost {
    int startCalls;
    final List<ReactInstanceEventListener> listeners = new ArrayList<>();

    public ReactContext getCurrentReactContext() {
      return null;
    }

    public void addReactInstanceEventListener(ReactInstanceEventListener listener) {
      listeners.add(listener);
    }

    public void removeReactInstanceEventListener(ReactInstanceEventListener listener) {
      listeners.remove(listener);
    }

    public void start() {
      startCalls++;
    }

    void reset() {
      startCalls = 0;
      listeners.clear();
    }
  }
}
