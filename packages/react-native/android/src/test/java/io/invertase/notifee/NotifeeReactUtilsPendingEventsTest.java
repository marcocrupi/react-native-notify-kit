package io.invertase.notifee;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import android.app.Application;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import app.notifee.core.ContextHolder;
import app.notifee.core.event.NotificationEvent;
import com.facebook.react.bridge.JavaOnlyMap;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import kotlin.Pair;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowLog;

@RunWith(RobolectricTestRunner.class)
@Config(application = NotifeeReactUtilsPendingEventsTest.TestApplication.class, sdk = 34)
public class NotifeeReactUtilsPendingEventsTest {

  private static final String DIAGNOSTICS_TAG = "NOTIFEE_PENDING_DIAG";
  private static final String NOTIFICATION_EVENT_NAME = "app.notifee.notification-event";
  private static final String DIAGNOSTIC_SCENARIO_ID_KEY =
      "__notifeePendingDiagScenarioId";
  private static final String DIAGNOSTIC_EVENT_ID_KEY = "__notifeePendingDiagEventId";

  private TestApplication application;

  @Before
  public void setUp() throws Exception {
    application = (TestApplication) RuntimeEnvironment.getApplication();
    application.reactHost.reset();
    ContextHolder.setApplicationContext(application);
    resetState();
    ShadowLog.clear();
  }

  @After
  public void tearDown() throws Exception {
    resetState();
    ShadowLog.clear();
  }

  @Test
  public void sendEvent_whenContextUnavailable_enqueuesInFifoOrder() throws Exception {
    WritableMap eventA = mock(WritableMap.class);
    WritableMap eventB = mock(WritableMap.class);
    WritableMap eventC = mock(WritableMap.class);

    setReactContexts(null, null, null);
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);
    NotifeeReactUtils.INSTANCE.sendEvent("B", eventB);
    NotifeeReactUtils.INSTANCE.sendEvent("C", eventC);

    List<?> queued = pendingEvents();
    assertEquals(Arrays.asList("A", "B", "C"), pendingEventNames(queued));
    assertSame(eventA, pendingEventBody(queued.get(0)));
    assertSame(eventB, pendingEventBody(queued.get(1)));
    assertSame(eventC, pendingEventBody(queued.get(2)));
    assertEquals(Pair.class, queued.get(0).getClass());
    assertNull(pendingDiagnosticsState());
  }

  @Test
  public void sendEvent_whenElevenEventsPending_dropsOldestAndKeepsTen() throws Exception {
    List<String> names =
        Arrays.asList("A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K");

    setReactContexts((ReactContext) null);
    for (String name : names) {
      NotifeeReactUtils.INSTANCE.sendEvent(name, mock(WritableMap.class));
    }

    List<?> queued = pendingEvents();
    assertEquals(10, queued.size());
    assertEquals(names.subList(1, names.size()), pendingEventNames(queued));
  }

  @Test
  public void snapshotAndClear_separatesBatchAndClearsCurrentQueue() throws Exception {
    WritableMap eventA = mock(WritableMap.class);
    WritableMap eventB = mock(WritableMap.class);
    WritableMap eventC = mock(WritableMap.class);
    ReactContext activeContext = mock(ReactContext.class);
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    when(activeContext.hasActiveReactInstance()).thenReturn(true);
    when(activeContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);

    setReactContexts(null, null, null, activeContext);
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);
    NotifeeReactUtils.INSTANCE.sendEvent("B", eventB);
    NotifeeReactUtils.INSTANCE.sendEvent("C", eventC);

    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertEquals(0, pendingEvents().size());
    org.mockito.InOrder emissionOrder = org.mockito.Mockito.inOrder(emitter);
    emissionOrder.verify(emitter).emit("A", eventA);
    emissionOrder.verify(emitter).emit("B", eventB);
    emissionOrder.verify(emitter).emit("C", eventC);
  }

  @Test
  public void sendEvent_afterSnapshot_staysInCurrentQueueAndOutsidePreviousBatch() throws Exception {
    WritableMap eventA = mock(WritableMap.class);
    WritableMap eventB = mock(WritableMap.class);
    ReactContext activeContext = mock(ReactContext.class);
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    when(activeContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);
    setReactContexts((ReactContext) null);
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);

    setReactContexts(activeContext, null);
    when(activeContext.hasActiveReactInstance())
        .thenAnswer(
            invocation -> {
              NotifeeReactUtils.INSTANCE.sendEvent("B", eventB);
              return true;
            });
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    verify(emitter).emit("A", eventA);
    assertEquals(Arrays.asList("B"), pendingEventNames(pendingEvents()));
    assertSame(eventB, pendingEventBody(pendingEvents().get(0)));
  }

  @Test
  public void flushPendingEvents_whenContextNull_requeuesEvent() throws Exception {
    WritableMap eventA = mock(WritableMap.class);
    setReactContexts(null, null);
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);
    assertEquals(1, pendingEvents().size());
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertEquals(Arrays.asList("A"), pendingEventNames(pendingEvents()));
    assertSame(eventA, pendingEventBody(pendingEvents().get(0)));
  }

  @Test
  public void flushPendingEvents_whenContextInactive_requeuesEvent() throws Exception {
    WritableMap eventA = mock(WritableMap.class);
    ReactContext inactiveContext = mock(ReactContext.class);
    when(inactiveContext.hasActiveReactInstance()).thenReturn(false);

    setReactContexts(null, inactiveContext);
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertEquals(Arrays.asList("A"), pendingEventNames(pendingEvents()));
    assertSame(eventA, pendingEventBody(pendingEvents().get(0)));
    verify(inactiveContext).hasActiveReactInstance();
    verify(inactiveContext, never()).getJSModule(any());
  }

  @Test
  public void flushPendingEvents_requeuedEventRecoversExactlyOnceOnNextFlush() throws Exception {
    WritableMap eventA = mock(WritableMap.class);
    ReactContext activeContext = mock(ReactContext.class);
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    when(activeContext.hasActiveReactInstance()).thenReturn(true);
    when(activeContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);

    setReactContexts(null, null);
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);
    NotifeeReactUtils.INSTANCE.flushPendingEvents();
    assertEquals(Arrays.asList("A"), pendingEventNames(pendingEvents()));

    setReactContexts(activeContext);
    NotifeeReactUtils.INSTANCE.flushPendingEvents();
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertTrue(pendingEvents().isEmpty());
    verify(emitter, times(1)).emit("A", eventA);
  }

  @Test
  public void flushPendingEvents_whenAllContextsUnavailable_preservesSnapshotFifo()
      throws Exception {
    WritableMap eventA = mock(WritableMap.class);
    WritableMap eventB = mock(WritableMap.class);
    WritableMap eventC = mock(WritableMap.class);

    setReactContexts(null, null, null);
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);
    NotifeeReactUtils.INSTANCE.sendEvent("B", eventB);
    NotifeeReactUtils.INSTANCE.sendEvent("C", eventC);
    setReactContexts((ReactContext) null);
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertEquals(Arrays.asList("A", "B", "C"), pendingEventNames(pendingEvents()));
    assertSame(eventA, pendingEventBody(pendingEvents().get(0)));
    assertSame(eventB, pendingEventBody(pendingEvents().get(1)));
    assertSame(eventC, pendingEventBody(pendingEvents().get(2)));
  }

  @Test
  public void flushPendingEvents_newArrivalDuringFlush_isMergedAfterRequeuedSnapshot()
      throws Exception {
    WritableMap eventA = mock(WritableMap.class);
    WritableMap eventB = mock(WritableMap.class);
    WritableMap eventC = mock(WritableMap.class);
    ReactContext inactiveContext = mock(ReactContext.class);

    setReactContexts(null, null);
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);
    NotifeeReactUtils.INSTANCE.sendEvent("B", eventB);
    setReactContexts(inactiveContext, null);
    when(inactiveContext.hasActiveReactInstance())
        .thenAnswer(
            invocation -> {
              NotifeeReactUtils.INSTANCE.sendEvent("C", eventC);
              return false;
            });

    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertEquals(Arrays.asList("A", "B", "C"), pendingEventNames(pendingEvents()));
    assertSame(eventA, pendingEventBody(pendingEvents().get(0)));
    assertSame(eventB, pendingEventBody(pendingEvents().get(1)));
    assertSame(eventC, pendingEventBody(pendingEvents().get(2)));
  }

  @Test
  public void flushPendingEvents_partialDelivery_requeuesOnlyUndeliveredEvents()
      throws Exception {
    WritableMap eventA = mock(WritableMap.class);
    WritableMap eventB = mock(WritableMap.class);
    WritableMap eventC = mock(WritableMap.class);
    ReactContext activeContext = mock(ReactContext.class);
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    when(activeContext.hasActiveReactInstance()).thenReturn(true);
    when(activeContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);

    setReactContexts(null, null, null);
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);
    NotifeeReactUtils.INSTANCE.sendEvent("B", eventB);
    NotifeeReactUtils.INSTANCE.sendEvent("C", eventC);
    setReactContexts(activeContext, null);
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    verify(emitter, times(1)).emit("A", eventA);
    verify(emitter, never()).emit("B", eventB);
    verify(emitter, never()).emit("C", eventC);
    assertEquals(Arrays.asList("B", "C"), pendingEventNames(pendingEvents()));
  }

  @Test
  public void flushPendingEvents_requeueMergeOverCapacity_dropsGlobalOldestAndKeepsFifo()
      throws Exception {
    List<String> snapshotNames = Arrays.asList("A", "B", "C");
    List<String> newNames = Arrays.asList("D", "E", "F", "G", "H", "I", "J", "K", "L");
    ReactContext inactiveContext = mock(ReactContext.class);

    setReactContexts((ReactContext) null);
    for (String name : snapshotNames) {
      NotifeeReactUtils.INSTANCE.sendEvent(name, mock(WritableMap.class));
    }
    setReactContexts(inactiveContext, null);
    when(inactiveContext.hasActiveReactInstance())
        .thenAnswer(
            invocation -> {
              for (String name : newNames) {
                NotifeeReactUtils.INSTANCE.sendEvent(name, mock(WritableMap.class));
              }
              return false;
            });

    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertEquals(10, pendingEvents().size());
    assertEquals(
        Arrays.asList("C", "D", "E", "F", "G", "H", "I", "J", "K", "L"),
        pendingEventNames(pendingEvents()));
  }

  @Test
  public void sendEvent_directDuringFlush_bypassesRequeueAndCanPrecedeRecoveredEvent()
      throws Exception {
    WritableMap eventA = mock(WritableMap.class);
    WritableMap eventB = mock(WritableMap.class);
    ReactContext inactiveContext = mock(ReactContext.class);
    ReactContext activeContext = mock(ReactContext.class);
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    when(activeContext.hasActiveReactInstance()).thenReturn(true);
    when(activeContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);

    setReactContexts((ReactContext) null);
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);
    setReactContexts(inactiveContext, activeContext);
    when(inactiveContext.hasActiveReactInstance())
        .thenAnswer(
            invocation -> {
              NotifeeReactUtils.INSTANCE.sendEvent("B", eventB);
              return false;
            });

    NotifeeReactUtils.INSTANCE.flushPendingEvents();
    assertEquals(Arrays.asList("A"), pendingEventNames(pendingEvents()));
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertTrue(pendingEvents().isEmpty());
    org.mockito.InOrder emissionOrder = org.mockito.Mockito.inOrder(emitter);
    emissionOrder.verify(emitter).emit("B", eventB);
    emissionOrder.verify(emitter).emit("A", eventA);
    verify(emitter, times(1)).emit("B", eventB);
    verify(emitter, times(1)).emit("A", eventA);
  }

  @Test
  public void flushPendingEvents_whenFirstEmitThrows_doesNotRequeueAndAttemptsNext()
      throws Exception {
    WritableMap eventA = mock(WritableMap.class);
    WritableMap eventB = mock(WritableMap.class);
    ReactContext activeContext = mock(ReactContext.class);
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    when(activeContext.hasActiveReactInstance()).thenReturn(true);
    when(activeContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);
    doThrow(new IllegalStateException("characterization emit failure"))
        .when(emitter)
        .emit(eq("A"), same(eventA));

    setReactContexts(null, null, activeContext, activeContext);
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);
    NotifeeReactUtils.INSTANCE.sendEvent("B", eventB);
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertEquals(0, pendingEvents().size());
    verify(emitter).emit("A", eventA);
    verify(emitter).emit("B", eventB);
  }

  @Test
  public void diagnostics_withoutMetadata_areDisabledWithZeroDelayAndNoMarkers() throws Exception {
    Object config = loadPendingDiagnosticsConfig(application);
    assertFalse((boolean) privateField(config, "enabled"));
    assertEquals(0L, ((Number) privateField(config, "delayAfterSnapshotMs")).longValue());

    WritableMap eventA = mock(WritableMap.class);
    setReactContexts(null, null);
    int packageManagerRequestsBeforeEvent = application.packageManagerRequests;
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);
    List<?> queued = pendingEvents();
    assertEquals(1, queued.size());
    assertEquals(Pair.class, queued.get(0).getClass());
    assertSame(eventA, pendingEventBody(queued.get(0)));
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertEquals(1, pendingEvents().size());
    assertSame(eventA, pendingEventBody(pendingEvents().get(0)));
    assertEquals(packageManagerRequestsBeforeEvent, application.packageManagerRequests);
    assertNull(pendingDiagnosticsState());
    assertTrue(ShadowLog.getLogsForTag(DIAGNOSTICS_TAG).isEmpty());
  }

  @Test
  public void diagnosticIdentity_validFixturePayload_extractsControlledIdentity() throws Exception {
    JavaOnlyMap eventMap = diagnosticEventMap("scenario-1", "pending-diag:scenario-1:A");

    Object identity = extractPendingDiagnosticIdentity(eventMap);

    assertNotNull(identity);
    assertEquals("scenario-1", privateField(identity, "scenarioId"));
    assertEquals("pending-diag:scenario-1:A", privateField(identity, "eventId"));
    assertEquals(NotificationEvent.TYPE_DELIVERED, privateField(identity, "eventType"));
  }

  @Test
  public void diagnosticIdentity_missingPayload_returnsUnavailableWithoutException() throws Exception {
    assertNull(extractPendingDiagnosticIdentity(new JavaOnlyMap()));

    JavaOnlyMap eventMap = JavaOnlyMap.of("detail", JavaOnlyMap.of("notification", null));
    assertNull(extractPendingDiagnosticIdentity(eventMap));
  }

  @Test
  public void diagnosticIdentity_wrongFieldType_returnsUnavailableWithoutException() throws Exception {
    JavaOnlyMap eventMap = diagnosticEventMap("scenario-1", 7);

    assertNull(extractPendingDiagnosticIdentity(eventMap));
  }

  @Test
  public void diagnosticIdentity_eventTypeMustBePresentNumericAndIntegerValued() throws Exception {
    JavaOnlyMap missingType =
        diagnosticEventMapWithoutType("scenario-1", "pending-diag:scenario-1:A");
    JavaOnlyMap wrongType =
        diagnosticEventMap("scenario-1", "pending-diag:scenario-1:A", "3");
    JavaOnlyMap fractionalType =
        diagnosticEventMap("scenario-1", "pending-diag:scenario-1:A", 3.5d);
    JavaOnlyMap outOfRangeType =
        diagnosticEventMap("scenario-1", "pending-diag:scenario-1:A", 2147483648d);
    JavaOnlyMap integerValuedNumber =
        diagnosticEventMap("scenario-1", "pending-diag:scenario-1:A", 3.0d);

    Object missingTypeIdentity = extractPendingDiagnosticIdentity(missingType);
    Object wrongTypeIdentity = extractPendingDiagnosticIdentity(wrongType);
    Object fractionalTypeIdentity = extractPendingDiagnosticIdentity(fractionalType);
    Object outOfRangeTypeIdentity = extractPendingDiagnosticIdentity(outOfRangeType);
    Object integerValuedIdentity = extractPendingDiagnosticIdentity(integerValuedNumber);
    assertNotNull(missingTypeIdentity);
    assertNotNull(wrongTypeIdentity);
    assertNotNull(fractionalTypeIdentity);
    assertNotNull(outOfRangeTypeIdentity);
    assertNotNull(integerValuedIdentity);
    assertNull(privateField(missingTypeIdentity, "eventType"));
    assertNull(privateField(wrongTypeIdentity, "eventType"));
    assertNull(privateField(fractionalTypeIdentity, "eventType"));
    assertNull(privateField(outOfRangeTypeIdentity, "eventType"));
    assertEquals(
        NotificationEvent.TYPE_DELIVERED,
        privateField(integerValuedIdentity, "eventType"));

    assertTrue(initializePendingDiagnostics(diagnosticsContext(true, true, 0).context));
    setReactContexts((ReactContext) null);
    NotifeeReactUtils.INSTANCE.sendEvent(NOTIFICATION_EVENT_NAME, missingType);
    NotifeeReactUtils.INSTANCE.sendEvent(NOTIFICATION_EVENT_NAME, wrongType);
    NotifeeReactUtils.INSTANCE.sendEvent(NOTIFICATION_EVENT_NAME, fractionalType);
    NotifeeReactUtils.INSTANCE.sendEvent(NOTIFICATION_EVENT_NAME, outOfRangeType);

    assertEquals(
        Arrays.asList("unavailable", "unavailable", "unavailable", "unavailable"),
        markerFieldValues("EVENT_RECEIVED", "eventType"));
    assertEquals(
        Arrays.asList(
            "pending-diag:scenario-1:A",
            "pending-diag:scenario-1:A",
            "pending-diag:scenario-1:A",
            "pending-diag:scenario-1:A"),
        markerFieldValues("EVENT_RECEIVED", "diagEventId"));
  }

  @Test
  public void diagnosticIdentity_nonConformingValue_isUnavailableAndNeverLogged() throws Exception {
    JavaOnlyMap missingPrefix = diagnosticEventMap("scenario-1", "consumer-value");
    JavaOnlyMap forbiddenCharacters =
        diagnosticEventMap("scenario-1", "pending-diag:scenario-1:A secret");
    JavaOnlyMap wrongScenario = diagnosticEventMap("scenario-1", "pending-diag:scenario-2:A");

    assertNull(extractPendingDiagnosticIdentity(missingPrefix));
    assertNull(extractPendingDiagnosticIdentity(forbiddenCharacters));
    assertNull(extractPendingDiagnosticIdentity(wrongScenario));

    assertTrue(initializePendingDiagnostics(diagnosticsContext(true, true, 0).context));
    setReactContexts((ReactContext) null);
    NotifeeReactUtils.INSTANCE.sendEvent("A", forbiddenCharacters);

    String received = markerMessage("EVENT_RECEIVED");
    assertTrue(received.contains("diagScenarioId=unavailable"));
    assertTrue(received.contains("diagEventId=unavailable"));
    assertTrue(received.contains("eventType=unavailable"));
    assertFalse(received.contains("A secret"));
  }

  @Test
  public void diagnostics_sameIdDifferentTypes_keepSeparateNativeReceipts() throws Exception {
    assertTrue(initializePendingDiagnostics(diagnosticsContext(true, true, 0).context));
    String eventId = "pending-diag:scenario-1:A";
    JavaOnlyMap triggerCreated =
        diagnosticEventMap(
            "scenario-1", eventId, NotificationEvent.TYPE_TRIGGER_NOTIFICATION_CREATED);
    JavaOnlyMap delivered =
        diagnosticEventMap("scenario-1", eventId, NotificationEvent.TYPE_DELIVERED);
    ReactContext activeContext = mock(ReactContext.class);
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    when(activeContext.hasActiveReactInstance()).thenReturn(true);
    when(activeContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);

    setReactContexts(activeContext, null);
    NotifeeReactUtils.INSTANCE.sendEvent(NOTIFICATION_EVENT_NAME, triggerCreated);
    NotifeeReactUtils.INSTANCE.sendEvent(NOTIFICATION_EVENT_NAME, delivered);

    verify(emitter).emit(NOTIFICATION_EVENT_NAME, triggerCreated);
    assertEquals(
        Arrays.asList(eventId, eventId), markerFieldValues("EVENT_RECEIVED", "diagEventId"));
    assertEquals(Arrays.asList("1", "2"), markerFieldValues("EVENT_RECEIVED", "eventSeq"));
    assertEquals(Arrays.asList("7", "3"), markerFieldValues("EVENT_RECEIVED", "eventType"));
    assertEquals(
        Arrays.asList("7"), markerFieldValues("EVENT_EMIT_DIRECT_BEGIN", "eventType"));
    assertEquals(Arrays.asList("3"), markerFieldValues("EVENT_ENQUEUED", "eventType"));
  }

  @Test
  public void diagnostics_sameIdAndType_keepDistinctReceiptSequences() throws Exception {
    assertTrue(initializePendingDiagnostics(diagnosticsContext(true, true, 0).context));
    String eventId = "pending-diag:scenario-1:A";
    JavaOnlyMap deliveredOne =
        diagnosticEventMap("scenario-1", eventId, NotificationEvent.TYPE_DELIVERED);
    JavaOnlyMap deliveredTwo =
        diagnosticEventMap("scenario-1", eventId, NotificationEvent.TYPE_DELIVERED);

    setReactContexts((ReactContext) null);
    NotifeeReactUtils.INSTANCE.sendEvent(NOTIFICATION_EVENT_NAME, deliveredOne);
    NotifeeReactUtils.INSTANCE.sendEvent(NOTIFICATION_EVENT_NAME, deliveredTwo);

    assertEquals(
        Arrays.asList(eventId, eventId), markerFieldValues("EVENT_RECEIVED", "diagEventId"));
    assertEquals(Arrays.asList("3", "3"), markerFieldValues("EVENT_RECEIVED", "eventType"));
    assertEquals(Arrays.asList("1", "2"), markerFieldValues("EVENT_RECEIVED", "eventSeq"));
    assertEquals(Arrays.asList("1", "2"), markerFieldValues("EVENT_ENQUEUED", "eventSeq"));
  }

  @Test
  public void diagnostics_enabled_emitMarkersAndDoNotModifyPublicPayload() throws Exception {
    DiagnosticsContext diagnostics = diagnosticsContext(true, true, 1);
    assertTrue(initializePendingDiagnostics(diagnostics.context));

    JavaOnlyMap eventA = diagnosticEventMap("scenario-1", "pending-diag:scenario-1:A");
    ReactContext activeContext = mock(ReactContext.class);
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    when(activeContext.hasActiveReactInstance()).thenReturn(true);
    when(activeContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);

    setReactContexts(null, activeContext);
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    verify(emitter).emit(eq("A"), same(eventA));
    ReadableMap detail = eventA.getMap("detail");
    assertNotNull(detail);
    ReadableMap notification = detail.getMap("notification");
    assertNotNull(notification);
    ReadableMap data = notification.getMap("data");
    assertNotNull(data);
    assertEquals("consumer-value", data.getString("consumerField"));
    assertEquals("scenario-1", data.getString(DIAGNOSTIC_SCENARIO_ID_KEY));
    assertEquals("pending-diag:scenario-1:A", data.getString(DIAGNOSTIC_EVENT_ID_KEY));
    assertEquals(NotificationEvent.TYPE_DELIVERED, eventA.getInt("type"));
    assertFalse(eventA.hasKey("eventSeq"));
    assertFalse(data.hasKey("eventSeq"));
    assertTrue(hasMarker("EVENT_RECEIVED"));
    assertTrue(hasMarker("EVENT_ENQUEUED"));
    assertTrue(hasMarker("FLUSH_REQUESTED"));
    assertTrue(hasMarker("FLUSH_SNAPSHOT"));
    assertTrue(hasMarker("FLUSH_SNAPSHOT_ITEM"));
    assertTrue(hasMarker("FLUSH_QUEUE_CLEARED"));
    assertTrue(hasMarker("FLUSH_DIAGNOSTIC_DELAY_BEGIN"));
    assertTrue(hasMarker("FLUSH_DIAGNOSTIC_DELAY_END"));
    assertTrue(hasMarker("FLUSH_EVENT_CONTEXT_CHECK"));
    assertTrue(hasMarker("FLUSH_EVENT_EMIT_BEGIN"));
    assertTrue(hasMarker("FLUSH_EVENT_EMIT_RETURN"));
    assertTrue(hasMarker("FLUSH_COMPLETED"));
    assertTrue(markerMessage("EVENT_RECEIVED").contains("eventSeq=1"));
    assertTrue(markerMessage("EVENT_RECEIVED").contains("diagScenarioId=scenario-1"));
    assertTrue(
        markerMessage("EVENT_RECEIVED").contains("diagEventId=pending-diag:scenario-1:A"));
    assertEquals(Arrays.asList("3"), markerFieldValues("EVENT_RECEIVED", "eventType"));
    assertEquals(Arrays.asList("3"), markerFieldValues("EVENT_ENQUEUED", "eventType"));
    assertEquals(Arrays.asList("3"), markerFieldValues("FLUSH_SNAPSHOT_ITEM", "eventType"));
    assertEquals(
        Arrays.asList("3"), markerFieldValues("FLUSH_EVENT_CONTEXT_CHECK", "eventType"));
    assertEquals(Arrays.asList("3"), markerFieldValues("FLUSH_EVENT_EMIT_RETURN", "eventType"));
    assertTrue(markerMessage("FLUSH_REQUESTED").contains("flushId=1"));

    Object state = pendingDiagnosticsState();
    assertNotNull(state);
    assertEquals(1L, atomicLongField(state, "eventSequence").get());
    assertEquals(1L, atomicLongField(state, "flushSequence").get());
    assertTrue(((java.util.Map<?, ?>) privateField(state, "queuedEventDiagnostics")).isEmpty());
    verify(diagnostics.packageManager, times(1))
        .getApplicationInfo("com.notifeeexample", PackageManager.GET_META_DATA);
  }

  @Test
  public void diagnostics_requeuedEvent_keepsIdentityAndRecoversExactlyOnce() throws Exception {
    assertTrue(initializePendingDiagnostics(diagnosticsContext(true, true, 0).context));
    JavaOnlyMap eventA = diagnosticEventMap("scenario-1", "pending-diag:scenario-1:A");
    ReactContext activeContext = mock(ReactContext.class);
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    when(activeContext.hasActiveReactInstance()).thenReturn(true);
    when(activeContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);

    setReactContexts(null, null);
    NotifeeReactUtils.INSTANCE.sendEvent(NOTIFICATION_EVENT_NAME, eventA);
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertEquals(Arrays.asList(NOTIFICATION_EVENT_NAME), pendingEventNames(pendingEvents()));
    assertSame(eventA, pendingEventBody(pendingEvents().get(0)));
    assertEquals(
        1,
        ((java.util.Map<?, ?>)
                privateField(pendingDiagnosticsState(), "queuedEventDiagnostics"))
            .size());
    assertEquals(Arrays.asList("1"), markerFieldValues("FLUSH_EVENT_REQUEUED", "eventSeq"));
    assertEquals(Arrays.asList("1"), markerFieldValues("FLUSH_EVENT_REQUEUED", "flushId"));
    assertEquals(Arrays.asList("3"), markerFieldValues("FLUSH_EVENT_REQUEUED", "eventType"));
    assertEquals(
        Arrays.asList("pending-diag:scenario-1:A"),
        markerFieldValues("FLUSH_EVENT_REQUEUED", "diagEventId"));
    assertEquals(
        Arrays.asList("context_null"), markerFieldValues("FLUSH_EVENT_REQUEUED", "reason"));
    assertEquals(Arrays.asList("1"), markerFieldValues("FLUSH_REQUEUE_MERGE", "requeuedCount"));
    assertEquals(
        Arrays.asList("0"), markerFieldValues("FLUSH_REQUEUE_MERGE", "newArrivalsCount"));
    assertEquals(Arrays.asList("0"), markerFieldValues("FLUSH_REQUEUE_MERGE", "droppedCount"));

    setReactContexts(activeContext);
    NotifeeReactUtils.INSTANCE.flushPendingEvents();
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    verify(emitter, times(1)).emit(NOTIFICATION_EVENT_NAME, eventA);
    assertTrue(pendingEvents().isEmpty());
    assertTrue(
        ((java.util.Map<?, ?>)
                privateField(pendingDiagnosticsState(), "queuedEventDiagnostics"))
            .isEmpty());
    assertEquals(Arrays.asList("1", "1"), markerFieldValues("FLUSH_SNAPSHOT_ITEM", "eventSeq"));
    assertEquals(Arrays.asList("1", "2"), markerFieldValues("FLUSH_SNAPSHOT_ITEM", "flushId"));
    assertEquals(Arrays.asList("1"), markerFieldValues("FLUSH_EVENT_EMIT_RETURN", "eventSeq"));
    assertEquals(Arrays.asList("2"), markerFieldValues("FLUSH_EVENT_EMIT_RETURN", "flushId"));
  }

  @Test
  public void diagnostics_emitException_isNotRequeuedAndNextEventIsAttempted() throws Exception {
    assertTrue(initializePendingDiagnostics(diagnosticsContext(true, true, 0).context));
    JavaOnlyMap eventA = diagnosticEventMap("scenario-1", "pending-diag:scenario-1:A");
    JavaOnlyMap eventB = diagnosticEventMap("scenario-1", "pending-diag:scenario-1:B");
    ReactContext activeContext = mock(ReactContext.class);
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    when(activeContext.hasActiveReactInstance()).thenReturn(true);
    when(activeContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);
    doThrow(new IllegalStateException("diagnostic emit failure"))
        .when(emitter)
        .emit(eq(NOTIFICATION_EVENT_NAME), same(eventA));

    setReactContexts(null, null, activeContext, activeContext);
    NotifeeReactUtils.INSTANCE.sendEvent(NOTIFICATION_EVENT_NAME, eventA);
    NotifeeReactUtils.INSTANCE.sendEvent(NOTIFICATION_EVENT_NAME, eventB);
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertTrue(pendingEvents().isEmpty());
    verify(emitter).emit(NOTIFICATION_EVENT_NAME, eventA);
    verify(emitter).emit(NOTIFICATION_EVENT_NAME, eventB);
    assertEquals(
        Arrays.asList("pending-diag:scenario-1:A"),
        markerFieldValues("FLUSH_EVENT_EMIT_EXCEPTION", "diagEventId"));
    assertFalse(hasMarker("FLUSH_EVENT_REQUEUED"));
  }

  @Test
  public void diagnostics_requeueMergeOverCapacity_preservesSideMapAndGlobalFifo()
      throws Exception {
    assertTrue(initializePendingDiagnostics(diagnosticsContext(true, true, 0).context));
    List<String> expectedEventIds = new ArrayList<>();
    for (int index = 1; index <= 11; index += 1) {
      expectedEventIds.add(String.format("pending-diag:scenario-1:overflow:%02d", index));
    }
    ReactContext inactiveContext = mock(ReactContext.class);
    ReactContext activeContext = mock(ReactContext.class);
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    when(activeContext.hasActiveReactInstance()).thenReturn(true);
    when(activeContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);

    setReactContexts((ReactContext) null);
    for (int index = 0; index < 2; index += 1) {
      NotifeeReactUtils.INSTANCE.sendEvent(
          "overflow", diagnosticEventMap("scenario-1", expectedEventIds.get(index)));
    }
    setReactContexts(inactiveContext, null);
    when(inactiveContext.hasActiveReactInstance())
        .thenAnswer(
            invocation -> {
              for (int index = 2; index < expectedEventIds.size(); index += 1) {
                NotifeeReactUtils.INSTANCE.sendEvent(
                    "overflow", diagnosticEventMap("scenario-1", expectedEventIds.get(index)));
              }
              return false;
            });

    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertEquals(10, pendingEvents().size());
    assertEquals(
        10,
        ((java.util.Map<?, ?>)
                privateField(pendingDiagnosticsState(), "queuedEventDiagnostics"))
            .size());
    assertEquals(
        Arrays.asList(expectedEventIds.get(0)),
        markerFieldValues("FLUSH_REQUEUE_DROP", "diagEventId"));
    assertEquals(Arrays.asList("2"), markerFieldValues("FLUSH_REQUEUE_MERGE", "requeuedCount"));
    assertEquals(
        Arrays.asList("9"), markerFieldValues("FLUSH_REQUEUE_MERGE", "newArrivalsCount"));
    assertEquals(Arrays.asList("1"), markerFieldValues("FLUSH_REQUEUE_MERGE", "droppedCount"));

    setReactContexts(activeContext);
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    List<String> allSnapshotIds = markerFieldValues("FLUSH_SNAPSHOT_ITEM", "diagEventId");
    assertEquals(expectedEventIds.subList(1, expectedEventIds.size()), allSnapshotIds.subList(2, 12));
    assertTrue(pendingEvents().isEmpty());
    assertTrue(
        ((java.util.Map<?, ?>)
                privateField(pendingDiagnosticsState(), "queuedEventDiagnostics"))
            .isEmpty());
    verify(emitter, times(10)).emit(eq("overflow"), any(WritableMap.class));
  }

  @Test
  public void diagnostics_similarEvents_keepDistinctControlledIdentities() throws Exception {
    assertTrue(initializePendingDiagnostics(diagnosticsContext(true, true, 0).context));
    JavaOnlyMap eventA = diagnosticEventMap("scenario-1", "pending-diag:scenario-1:A");
    JavaOnlyMap eventB = diagnosticEventMap("scenario-1", "pending-diag:scenario-1:B");
    ReactContext activeContext = mock(ReactContext.class);
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    when(activeContext.hasActiveReactInstance()).thenReturn(true);
    when(activeContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);

    setReactContexts(null, null, activeContext, activeContext);
    NotifeeReactUtils.INSTANCE.sendEvent("A", eventA);
    NotifeeReactUtils.INSTANCE.sendEvent("B", eventB);
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    verify(emitter).emit("A", eventA);
    verify(emitter).emit("B", eventB);
    assertEquals(
        Arrays.asList("pending-diag:scenario-1:A", "pending-diag:scenario-1:B"),
        markerFieldValues("EVENT_ENQUEUED", "diagEventId"));
    assertEquals(
        Arrays.asList("pending-diag:scenario-1:A", "pending-diag:scenario-1:B"),
        markerFieldValues("FLUSH_SNAPSHOT_ITEM", "diagEventId"));
    assertTrue(
        ((java.util.Map<?, ?>)
                privateField(pendingDiagnosticsState(), "queuedEventDiagnostics"))
            .isEmpty());
  }

  @Test
  public void diagnostics_overflow_logsDroppedIdentityAndCleansSideMap() throws Exception {
    assertTrue(initializePendingDiagnostics(diagnosticsContext(true, true, 0).context));
    setReactContexts((ReactContext) null);
    List<String> expectedEventIds = new ArrayList<>();

    for (int index = 1; index <= 11; index += 1) {
      String eventId = String.format("pending-diag:scenario-1:overflow:%02d", index);
      expectedEventIds.add(eventId);
      NotifeeReactUtils.INSTANCE.sendEvent(
          "overflow", diagnosticEventMap("scenario-1", eventId));
    }

    Object state = pendingDiagnosticsState();
    assertEquals(
        10,
        ((java.util.Map<?, ?>) privateField(state, "queuedEventDiagnostics")).size());
    assertTrue(
        markerMessage("EVENT_OVERFLOW_DROPPED")
            .contains("diagEventId=pending-diag:scenario-1:overflow:01"));

    ReactContext activeContext = mock(ReactContext.class);
    DeviceEventManagerModule.RCTDeviceEventEmitter emitter =
        mock(DeviceEventManagerModule.RCTDeviceEventEmitter.class);
    when(activeContext.hasActiveReactInstance()).thenReturn(true);
    when(activeContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class))
        .thenReturn(emitter);
    setReactContexts(activeContext);
    NotifeeReactUtils.INSTANCE.flushPendingEvents();

    assertEquals(
        expectedEventIds.subList(1, expectedEventIds.size()),
        markerFieldValues("FLUSH_SNAPSHOT_ITEM", "diagEventId"));
    assertEquals(
        expectedEventIds.subList(1, expectedEventIds.size()),
        markerFieldValues("FLUSH_EVENT_CONTEXT_CHECK", "diagEventId"));
    assertTrue(
        ((java.util.Map<?, ?>) privateField(state, "queuedEventDiagnostics")).isEmpty());
  }

  @Test
  public void diagnostics_configuration_isDebugGatedClampedAndInitializedOnce() throws Exception {
    DiagnosticsContext releaseContext = diagnosticsContext(false, true, 3000);
    assertFalse(initializePendingDiagnostics(releaseContext.context));
    assertNull(pendingDiagnosticsState());

    Object negativeDelayConfig = loadPendingDiagnosticsConfig(diagnosticsContext(true, true, -1).context);
    assertEquals(
        0L, ((Number) privateField(negativeDelayConfig, "delayAfterSnapshotMs")).longValue());

    DiagnosticsContext clampedContext = diagnosticsContext(true, true, 15000);
    assertTrue(initializePendingDiagnostics(clampedContext.context));
    assertEquals(10000L, ((Number) privateField(pendingDiagnosticsState(), "delayAfterSnapshotMs")).longValue());
    assertTrue(initializePendingDiagnostics(clampedContext.context));
    verify(clampedContext.packageManager, times(1))
        .getApplicationInfo("com.notifeeexample", PackageManager.GET_META_DATA);
  }

  private void setReactContexts(ReactContext... contexts) {
    if (contexts.length == 0) {
      throw new IllegalArgumentException("At least one context result is required");
    }
    application.reactHost.setResults(contexts);
  }

  @SuppressWarnings("unchecked")
  private static List<?> pendingEvents() throws Exception {
    Field field = NotifeeReactUtils.class.getDeclaredField("pendingEvents");
    field.setAccessible(true);
    return (List<?>) field.get(NotifeeReactUtils.INSTANCE);
  }

  private static Object loadPendingDiagnosticsConfig(Context context) throws Exception {
    Method method =
        NotifeeReactUtils.class.getDeclaredMethod("loadPendingDiagnosticsConfig", Context.class);
    method.setAccessible(true);
    return method.invoke(NotifeeReactUtils.INSTANCE, context);
  }

  private static boolean initializePendingDiagnostics(Context context) throws Exception {
    Method method =
        NotifeeReactUtils.class.getDeclaredMethod("initializePendingDiagnostics", Context.class);
    method.setAccessible(true);
    return (boolean) method.invoke(NotifeeReactUtils.INSTANCE, context);
  }

  private static Object extractPendingDiagnosticIdentity(WritableMap eventMap) throws Exception {
    Method method =
        NotifeeReactUtils.class.getDeclaredMethod(
            "extractPendingDiagnosticIdentity", WritableMap.class);
    method.setAccessible(true);
    return method.invoke(NotifeeReactUtils.INSTANCE, eventMap);
  }

  private static JavaOnlyMap diagnosticEventMap(String scenarioId, Object eventId) {
    return diagnosticEventMap(scenarioId, eventId, NotificationEvent.TYPE_DELIVERED);
  }

  private static JavaOnlyMap diagnosticEventMap(
      String scenarioId, Object eventId, Object eventType) {
    JavaOnlyMap data =
        JavaOnlyMap.of(
            DIAGNOSTIC_SCENARIO_ID_KEY,
            scenarioId,
            DIAGNOSTIC_EVENT_ID_KEY,
            eventId,
            "consumerField",
            "consumer-value");
    JavaOnlyMap notification = JavaOnlyMap.of("id", "controlled-fixture", "data", data);
    JavaOnlyMap detail = JavaOnlyMap.of("notification", notification);
    return JavaOnlyMap.of("type", eventType, "detail", detail, "headless", false);
  }

  private static JavaOnlyMap diagnosticEventMapWithoutType(String scenarioId, Object eventId) {
    JavaOnlyMap data =
        JavaOnlyMap.of(
            DIAGNOSTIC_SCENARIO_ID_KEY,
            scenarioId,
            DIAGNOSTIC_EVENT_ID_KEY,
            eventId,
            "consumerField",
            "consumer-value");
    JavaOnlyMap notification = JavaOnlyMap.of("id", "controlled-fixture", "data", data);
    JavaOnlyMap detail = JavaOnlyMap.of("notification", notification);
    return JavaOnlyMap.of("detail", detail, "headless", false);
  }

  private static List<String> pendingEventNames(List<?> pendingEvents) throws Exception {
    List<String> names = new ArrayList<>();
    for (Object pendingEvent : pendingEvents) {
      names.add((String) ((Pair<?, ?>) pendingEvent).getFirst());
    }
    return names;
  }

  private static WritableMap pendingEventBody(Object pendingEvent) throws Exception {
    return (WritableMap) ((Pair<?, ?>) pendingEvent).getSecond();
  }

  private static Object pendingDiagnosticsState() throws Exception {
    Field field = NotifeeReactUtils.class.getDeclaredField("pendingDiagnosticsState");
    field.setAccessible(true);
    return field.get(NotifeeReactUtils.INSTANCE);
  }

  private static AtomicLong atomicLongField(Object target, String name) throws Exception {
    return (AtomicLong) privateField(target, name);
  }

  private static boolean hasMarker(String marker) {
    return ShadowLog.getLogsForTag(DIAGNOSTICS_TAG).stream()
        .anyMatch(item -> item.msg.contains("marker=" + marker + " "));
  }

  private static String markerMessage(String marker) {
    return ShadowLog.getLogsForTag(DIAGNOSTICS_TAG).stream()
        .map(item -> item.msg)
        .filter(message -> message.contains("marker=" + marker + " "))
        .findFirst()
        .orElse("");
  }

  private static List<String> markerFieldValues(String marker, String field) {
    List<String> values = new ArrayList<>();
    String fieldPrefix = field + "=";
    for (ShadowLog.LogItem item : ShadowLog.getLogsForTag(DIAGNOSTICS_TAG)) {
      if (!item.msg.contains("marker=" + marker + " ")) continue;
      for (String token : item.msg.split(" ")) {
        if (token.startsWith(fieldPrefix)) {
          values.add(token.substring(fieldPrefix.length()));
          break;
        }
      }
    }
    return values;
  }

  private static DiagnosticsContext diagnosticsContext(
      boolean debuggable, boolean enabled, int delayMs) throws Exception {
    Context context = mock(Context.class);
    PackageManager packageManager = mock(PackageManager.class);
    ApplicationInfo applicationInfo = new ApplicationInfo();
    applicationInfo.flags = debuggable ? ApplicationInfo.FLAG_DEBUGGABLE : 0;
    applicationInfo.metaData = new Bundle();
    applicationInfo.metaData.putBoolean(
        "notifee_pending_events_diagnostics_enabled", enabled);
    applicationInfo.metaData.putInt(
        "notifee_pending_events_delay_after_snapshot_ms", delayMs);
    when(context.getPackageManager()).thenReturn(packageManager);
    when(context.getPackageName()).thenReturn("com.notifeeexample");
    when(packageManager.getApplicationInfo(
            "com.notifeeexample", PackageManager.GET_META_DATA))
        .thenReturn(applicationInfo);
    return new DiagnosticsContext(context, packageManager);
  }

  private static Object privateField(Object target, String name) throws Exception {
    Field field = target.getClass().getDeclaredField(name);
    field.setAccessible(true);
    return field.get(target);
  }

  private static void resetState() throws Exception {
    List<?> events = pendingEvents();
    synchronized (events) {
      events.clear();
    }
    Field stateField = NotifeeReactUtils.class.getDeclaredField("pendingDiagnosticsState");
    stateField.setAccessible(true);
    stateField.set(NotifeeReactUtils.INSTANCE, null);
  }

  public static class TestApplication extends Application {
    final TestReactHost reactHost = new TestReactHost();
    int packageManagerRequests;

    @Override
    public PackageManager getPackageManager() {
      packageManagerRequests += 1;
      return super.getPackageManager();
    }

    public TestReactHost getReactHost() {
      return reactHost;
    }
  }

  public static class TestReactHost {
    private final List<ReactContext> results = new ArrayList<>();
    private int invocation;

    public ReactContext getCurrentReactContext() {
      if (results.isEmpty()) return null;
      ReactContext result = results.get(Math.min(invocation, results.size() - 1));
      invocation += 1;
      return result;
    }

    void setResults(ReactContext... contexts) {
      results.clear();
      results.addAll(Arrays.asList(contexts));
      invocation = 0;
    }

    void reset() {
      results.clear();
      invocation = 0;
    }
  }

  private static final class DiagnosticsContext {
    final Context context;
    final PackageManager packageManager;

    DiagnosticsContext(Context context, PackageManager packageManager) {
      this.context = context;
      this.packageManager = packageManager;
    }
  }
}
