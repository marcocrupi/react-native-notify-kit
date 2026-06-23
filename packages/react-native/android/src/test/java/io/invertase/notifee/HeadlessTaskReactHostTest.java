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
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
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
    Shadows.shadowOf(Looper.getMainLooper())
        .idleFor(499, java.util.concurrent.TimeUnit.MILLISECONDS);
    verify(appRegistry, never())
        .startHeadlessTask(anyInt(), any(String.class), any(WritableMap.class));

    Shadows.shadowOf(Looper.getMainLooper()).idleFor(1, java.util.concurrent.TimeUnit.MILLISECONDS);

    ArgumentCaptor<Integer> taskIdCaptor = ArgumentCaptor.forClass(Integer.class);
    verify(appRegistry)
        .startHeadlessTask(taskIdCaptor.capture(), eq("test-headless-task"), same(copiedParams));
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

  @Test
  public void startTask_whenInitializedContextDisappears_reinitializesReactHost() {
    JavaOnlyMap firstParams = new JavaOnlyMap();
    firstParams.putString("source", "first-task");
    JavaOnlyMap secondParams = new JavaOnlyMap();
    secondParams.putString("source", "second-task");

    HeadlessTask headlessTask = new HeadlessTask();
    HeadlessTask.TaskConfig firstTask =
        new HeadlessTask.TaskConfig("test-headless-task", 60000L, firstParams, null);
    HeadlessTask.TaskConfig secondTask =
        new HeadlessTask.TaskConfig("test-headless-task", 60000L, secondParams, null);
    ReactContext firstReactContext = mock(ReactContext.class);
    ReactContext secondReactContext = mock(ReactContext.class);
    AppRegistry firstAppRegistry = mock(AppRegistry.class);
    AppRegistry secondAppRegistry = mock(AppRegistry.class);

    when(firstReactContext.getLifecycleState()).thenReturn(LifecycleState.BEFORE_RESUME);
    when(firstReactContext.hasActiveReactInstance()).thenReturn(true);
    when(firstReactContext.getJSModule(AppRegistry.class)).thenReturn(firstAppRegistry);
    when(secondReactContext.getLifecycleState()).thenReturn(LifecycleState.BEFORE_RESUME);
    when(secondReactContext.hasActiveReactInstance()).thenReturn(true);
    when(secondReactContext.getJSModule(AppRegistry.class)).thenReturn(secondAppRegistry);

    headlessTask.startTask(application, firstTask);
    application.reactHost.currentReactContext = firstReactContext;
    application.reactHost.listeners.get(0).onReactContextInitialized(firstReactContext);
    Shadows.shadowOf(Looper.getMainLooper())
        .idleFor(500, java.util.concurrent.TimeUnit.MILLISECONDS);
    verify(firstAppRegistry)
        .startHeadlessTask(
            anyInt(), eq("test-headless-task"), same(firstTask.getTaskConfig().getData()));

    application.reactHost.currentReactContext = null;
    headlessTask.startTask(application, secondTask);

    assertEquals(
        "ReactHost should be started again after the cached ReactContext disappears",
        2,
        application.reactHost.startCalls);
    assertEquals(
        "A fresh ReactContext listener should be registered for the second headless task",
        1,
        application.reactHost.listeners.size());
    verify(secondAppRegistry, never())
        .startHeadlessTask(anyInt(), any(String.class), any(WritableMap.class));

    application.reactHost.currentReactContext = secondReactContext;
    application.reactHost.listeners.get(0).onReactContextInitialized(secondReactContext);
    Shadows.shadowOf(Looper.getMainLooper())
        .idleFor(500, java.util.concurrent.TimeUnit.MILLISECONDS);

    verify(secondAppRegistry)
        .startHeadlessTask(
            anyInt(), eq("test-headless-task"), same(secondTask.getTaskConfig().getData()));
  }

  public static class TestApplication extends Application {
    final TestReactHost reactHost = new TestReactHost();

    public TestReactHost getReactHost() {
      return reactHost;
    }
  }

  public static class TestReactHost {
    int startCalls;
    ReactContext currentReactContext;
    final List<ReactInstanceEventListener> listeners = new ArrayList<>();

    public ReactContext getCurrentReactContext() {
      return currentReactContext;
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
      currentReactContext = null;
      listeners.clear();
    }
  }
}
