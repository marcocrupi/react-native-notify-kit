package io.invertase.notifee;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import android.app.Application;
import android.os.Bundle;
import android.os.Looper;
import androidx.lifecycle.ProcessLifecycleOwner;
import app.notifee.core.ContextHolder;
import app.notifee.core.event.NotificationEvent;
import app.notifee.core.model.NotificationModel;
import com.facebook.react.ReactInstanceEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(application = NotifeeEventSubscriberRoutingTest.TestApplication.class, sdk = 34)
public class NotifeeEventSubscriberRoutingTest {

  private TestApplication application;
  private HeadlessTask headlessTask;

  @Before
  public void setUp() throws Exception {
    application = (TestApplication) RuntimeEnvironment.getApplication();
    application.reactHost.reset();
    ContextHolder.setApplicationContext(application);
    headlessTask = NotifeeReactUtils.INSTANCE.getHeadlessTaskManager();
    resetHeadlessTask(headlessTask);
    moveProcessToBackground();
    Shadows.shadowOf(Looper.getMainLooper()).idle();
  }

  @After
  public void tearDown() throws Exception {
    moveProcessToBackground();
    resetHeadlessTask(headlessTask);
    application.reactHost.reset();
  }

  @Test
  public void onNotificationEvent_typePressWhenResumed_routesToForegroundEvent() throws Exception {
    moveProcessToForeground();
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    ReactContext reactContext = mock(ReactContext.class);
    when(reactContext.hasActiveReactInstance()).thenReturn(true);
    when(reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);
    application.reactHost.currentReactContext = reactContext;

    WritableMap eventMap = mock(WritableMap.class);
    WritableMap detailMap = mock(WritableMap.class);
    WritableMap notificationMap = mock(WritableMap.class);
    WritableMap pressActionMap = mock(WritableMap.class);

    try (MockedStatic<Arguments> arguments = mockArguments(
        eventMap, detailMap, notificationMap, pressActionMap)) {
      new NotifeeEventSubscriber().onNotificationEvent(buildPressEvent("routing-foreground"));
    }

    verify(eventMap).putInt("type", NotificationEvent.TYPE_PRESS);
    verify(detailMap).putMap("notification", notificationMap);
    verify(detailMap).putMap("pressAction", pressActionMap);
    verify(detailMap).putString("input", "typed reply");
    verify(eventMap).putMap("detail", detailMap);
    verify(eventMap).putBoolean("headless", false);
    verify(emitter).emit(NotifeeEventSubscriber.NOTIFICATION_EVENT_KEY, eventMap);
    verify(eventMap, never()).copy();
    assertEquals("foreground routing must not queue a headless task", 0, taskQueueSize());
    assertEquals("foreground routing must not start ReactHost", 0, application.reactHost.startCalls);
  }

  @Test
  public void onNotificationEvent_typePressWhenNotResumed_routesToHeadlessTask() throws Exception {
    moveProcessToBackground();
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    ReactContext reactContext = mock(ReactContext.class);
    when(reactContext.hasActiveReactInstance()).thenReturn(true);
    when(reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);
    application.reactHost.currentReactContext = null;

    WritableMap eventMap = mock(WritableMap.class);
    WritableMap queuedEventMap = mock(WritableMap.class);
    WritableMap detailMap = mock(WritableMap.class);
    WritableMap notificationMap = mock(WritableMap.class);
    WritableMap pressActionMap = mock(WritableMap.class);
    when(eventMap.copy()).thenReturn(queuedEventMap);

    try (MockedStatic<Arguments> arguments = mockArguments(
        eventMap, detailMap, notificationMap, pressActionMap)) {
      new NotifeeEventSubscriber().onNotificationEvent(buildPressEvent("routing-background"));
    }

    verify(eventMap).putInt("type", NotificationEvent.TYPE_PRESS);
    verify(detailMap).putMap("notification", notificationMap);
    verify(detailMap).putMap("pressAction", pressActionMap);
    verify(detailMap).putString("input", "typed reply");
    verify(eventMap).putMap("detail", detailMap);
    verify(eventMap).putBoolean("headless", true);
    verify(eventMap).copy();
    verify(queuedEventMap).putInt("taskId", headlessTaskQueue().get(0).getTaskId());
    verify(emitter, never()).emit(any(String.class), any(WritableMap.class));

    assertEquals("background routing should queue exactly one headless task", 1, taskQueueSize());
    HeadlessTask.TaskConfig queuedTask = headlessTaskQueue().get(0);
    assertEquals(NotifeeEventSubscriber.NOTIFICATION_EVENT_KEY, queuedTask.getTaskConfig().getTaskKey());
    assertEquals(60000L, queuedTask.getTaskConfig().getTimeout());
    assertSame(queuedEventMap, queuedTask.getTaskConfig().getData());
    assertEquals("background routing should initialize ReactHost via reflection", 1, application.reactHost.startCalls);
    assertEquals("background routing should register one ReactContext listener", 1, application.reactHost.listeners.size());
  }

  private static MockedStatic<Arguments> mockArguments(
      WritableMap eventMap,
      WritableMap detailMap,
      WritableMap notificationMap,
      WritableMap pressActionMap) {
    MockedStatic<Arguments> arguments = mockStatic(Arguments.class);
    arguments.when(Arguments::createMap).thenReturn(eventMap, detailMap);
    arguments.when(() -> Arguments.fromBundle(any(Bundle.class)))
        .thenReturn(notificationMap, pressActionMap);
    return arguments;
  }

  private static NotificationEvent buildPressEvent(String notificationId) {
    Bundle notificationBundle = new Bundle();
    notificationBundle.putString("id", notificationId);
    notificationBundle.putString("title", "Routing test " + notificationId);
    Bundle androidBundle = new Bundle();
    androidBundle.putString("channelId", "routing-test-channel");
    notificationBundle.putBundle("android", androidBundle);

    Bundle pressActionBundle = new Bundle();
    pressActionBundle.putString("id", "default");
    pressActionBundle.putString("launchActivity", "default");

    Bundle extras = new Bundle();
    extras.putBundle("pressAction", pressActionBundle);
    extras.putString("input", "typed reply");

    return new NotificationEvent(
        NotificationEvent.TYPE_PRESS, NotificationModel.fromBundle(notificationBundle), extras);
  }

  private static void moveProcessToForeground() {
    ProcessLifecycleOwner owner = (ProcessLifecycleOwner) ProcessLifecycleOwner.get();
    owner.activityStarted$lifecycle_process_release();
    owner.activityResumed$lifecycle_process_release();
  }

  private static void moveProcessToBackground() throws Exception {
    ProcessLifecycleOwner.init$lifecycle_process_release(RuntimeEnvironment.getApplication());
    ProcessLifecycleOwner owner = (ProcessLifecycleOwner) ProcessLifecycleOwner.get();
    int resumedCounter = getIntField(owner, "resumedCounter");
    for (int i = 0; i < resumedCounter; i++) {
      owner.activityPaused$lifecycle_process_release();
    }
    owner.dispatchPauseIfNeeded$lifecycle_process_release();

    int startedCounter = getIntField(owner, "startedCounter");
    for (int i = 0; i < startedCounter; i++) {
      owner.activityStopped$lifecycle_process_release();
    }
    owner.dispatchStopIfNeeded$lifecycle_process_release();
  }

  private static int getIntField(Object target, String name) throws Exception {
    Field field = target.getClass().getDeclaredField(name);
    field.setAccessible(true);
    return field.getInt(target);
  }

  private int taskQueueSize() throws Exception {
    return headlessTaskQueue().size();
  }

  @SuppressWarnings("unchecked")
  private List<HeadlessTask.TaskConfig> headlessTaskQueue() throws Exception {
    Field queueField = HeadlessTask.class.getDeclaredField("mTaskQueue");
    queueField.setAccessible(true);
    return (List<HeadlessTask.TaskConfig>) queueField.get(headlessTask);
  }

  private static void resetHeadlessTask(HeadlessTask task) throws Exception {
    Field queueField = HeadlessTask.class.getDeclaredField("mTaskQueue");
    queueField.setAccessible(true);
    ((List<?>) queueField.get(task)).clear();

    setAtomicBoolean(task, "mIsReactContextInitialized", false);
    setAtomicBoolean(task, "mWillDrainTaskQueue", false);
    setAtomicBoolean(task, "mIsInitializingReactContext", false);
    setAtomicBoolean(task, "mIsHeadlessJsTaskListenerRegistered", false);
  }

  private static void setAtomicBoolean(HeadlessTask task, String name, boolean value)
      throws Exception {
    Field field = HeadlessTask.class.getDeclaredField(name);
    field.setAccessible(true);
    ((AtomicBoolean) field.get(task)).set(value);
  }

  public static class TestApplication extends Application {
    final TestReactHost reactHost = new TestReactHost();

    public TestReactHost getReactHost() {
      return reactHost;
    }
  }

  public static class TestReactHost {
    ReactContext currentReactContext;
    int startCalls;
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
      currentReactContext = null;
      startCalls = 0;
      listeners.clear();
    }
  }
}
