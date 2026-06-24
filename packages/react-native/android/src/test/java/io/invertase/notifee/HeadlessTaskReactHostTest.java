package io.invertase.notifee;

import static org.junit.Assert.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
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
    AppRegistry appRegistry = mock(AppRegistry.class);
    ReactContext reactContext = createReactContext(appRegistry);

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

    application.reactHost.currentReactContext = reactContext;
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
  public void
      startTask_whenInitializedContextDisappears_reinitializesReactHostAndDrainsQueuedTasks() {
    HeadlessTask headlessTask = new HeadlessTask();
    AppRegistry firstAppRegistry = mock(AppRegistry.class);
    AppRegistry secondAppRegistry = mock(AppRegistry.class);
    ReactContext firstReactContext = createReactContext(firstAppRegistry);
    ReactContext secondReactContext = createReactContext(secondAppRegistry);
    HeadlessTask.TaskConfig firstTaskConfig =
        new HeadlessTask.TaskConfig("first-headless-task", 60000L, params("first"), null);
    HeadlessTask.TaskConfig secondTaskConfig =
        new HeadlessTask.TaskConfig("second-headless-task", 60000L, params("second"), null);
    HeadlessTask.TaskConfig thirdTaskConfig =
        new HeadlessTask.TaskConfig("third-headless-task", 60000L, params("third"), null);
    WritableMap firstCopiedParams = firstTaskConfig.getTaskConfig().getData();
    WritableMap secondCopiedParams = secondTaskConfig.getTaskConfig().getData();
    WritableMap thirdCopiedParams = thirdTaskConfig.getTaskConfig().getData();

    headlessTask.startTask(application, firstTaskConfig);

    assertEquals(1, application.reactHost.startCalls);
    assertEquals(1, application.reactHost.listeners.size());

    application.reactHost.currentReactContext = firstReactContext;
    application.reactHost.listeners.get(0).onReactContextInitialized(firstReactContext);
    Shadows.shadowOf(Looper.getMainLooper())
        .idleFor(500, java.util.concurrent.TimeUnit.MILLISECONDS);

    verify(firstAppRegistry)
        .startHeadlessTask(anyInt(), eq("first-headless-task"), same(firstCopiedParams));

    application.reactHost.currentReactContext = null;

    headlessTask.startTask(application, secondTaskConfig);

    assertEquals(
        "ReactHost should be started again for stale ReactContext",
        2,
        application.reactHost.startCalls);
    assertEquals(1, application.reactHost.listeners.size());
    verify(secondAppRegistry, never())
        .startHeadlessTask(anyInt(), any(String.class), any(WritableMap.class));

    headlessTask.startTask(application, thirdTaskConfig);

    assertEquals(
        "ReactHost should not be started again while reinitialization is pending",
        2,
        application.reactHost.startCalls);
    verify(secondAppRegistry, never())
        .startHeadlessTask(anyInt(), any(String.class), any(WritableMap.class));

    application.reactHost.currentReactContext = secondReactContext;
    application.reactHost.listeners.get(0).onReactContextInitialized(secondReactContext);
    Shadows.shadowOf(Looper.getMainLooper())
        .idleFor(499, java.util.concurrent.TimeUnit.MILLISECONDS);
    verify(secondAppRegistry, never())
        .startHeadlessTask(anyInt(), any(String.class), any(WritableMap.class));

    Shadows.shadowOf(Looper.getMainLooper()).idleFor(1, java.util.concurrent.TimeUnit.MILLISECONDS);

    verify(firstAppRegistry, times(1))
        .startHeadlessTask(anyInt(), eq("first-headless-task"), same(firstCopiedParams));
    verify(secondAppRegistry)
        .startHeadlessTask(anyInt(), eq("second-headless-task"), same(secondCopiedParams));
    verify(secondAppRegistry)
        .startHeadlessTask(anyInt(), eq("third-headless-task"), same(thirdCopiedParams));
  }

  @Test
  public void startTask_whenContextDisappearsBeforeInitialDrain_waitsForRecoveredReactContext() {
    HeadlessTask headlessTask = new HeadlessTask();
    AppRegistry staleAppRegistry = mock(AppRegistry.class);
    AppRegistry recoveredAppRegistry = mock(AppRegistry.class);
    ReactContext staleReactContext = createReactContext(staleAppRegistry);
    ReactContext recoveredReactContext = createReactContext(recoveredAppRegistry);
    HeadlessTask.TaskConfig firstTaskConfig =
        new HeadlessTask.TaskConfig("pending-first-headless-task", 60000L, params("first"), null);
    HeadlessTask.TaskConfig secondTaskConfig =
        new HeadlessTask.TaskConfig("pending-second-headless-task", 60000L, params("second"), null);
    WritableMap firstCopiedParams = firstTaskConfig.getTaskConfig().getData();
    WritableMap secondCopiedParams = secondTaskConfig.getTaskConfig().getData();

    headlessTask.startTask(application, firstTaskConfig);
    application.reactHost.currentReactContext = staleReactContext;
    application.reactHost.listeners.get(0).onReactContextInitialized(staleReactContext);

    application.reactHost.currentReactContext = null;
    headlessTask.startTask(application, secondTaskConfig);

    assertEquals(
        "ReactHost should be restarted when the pending context disappears",
        2,
        application.reactHost.startCalls);
    assertEquals(1, application.reactHost.listeners.size());

    Shadows.shadowOf(Looper.getMainLooper())
        .idleFor(500, java.util.concurrent.TimeUnit.MILLISECONDS);
    verify(staleAppRegistry, never())
        .startHeadlessTask(anyInt(), any(String.class), any(WritableMap.class));
    verify(recoveredAppRegistry, never())
        .startHeadlessTask(anyInt(), any(String.class), any(WritableMap.class));

    application.reactHost.currentReactContext = recoveredReactContext;
    application.reactHost.listeners.get(0).onReactContextInitialized(recoveredReactContext);
    Shadows.shadowOf(Looper.getMainLooper())
        .idleFor(500, java.util.concurrent.TimeUnit.MILLISECONDS);

    verify(staleAppRegistry, never())
        .startHeadlessTask(anyInt(), any(String.class), any(WritableMap.class));
    verify(recoveredAppRegistry)
        .startHeadlessTask(anyInt(), eq("pending-first-headless-task"), same(firstCopiedParams));
    verify(recoveredAppRegistry)
        .startHeadlessTask(anyInt(), eq("pending-second-headless-task"), same(secondCopiedParams));
  }

  private static JavaOnlyMap params(String source) {
    JavaOnlyMap params = new JavaOnlyMap();
    params.putString("source", source);
    return params;
  }

  private static ReactContext createReactContext(AppRegistry appRegistry) {
    ReactContext reactContext = mock(ReactContext.class);
    when(reactContext.getLifecycleState()).thenReturn(LifecycleState.BEFORE_RESUME);
    when(reactContext.hasActiveReactInstance()).thenReturn(true);
    when(reactContext.getJSModule(AppRegistry.class)).thenReturn(appRegistry);
    return reactContext;
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
