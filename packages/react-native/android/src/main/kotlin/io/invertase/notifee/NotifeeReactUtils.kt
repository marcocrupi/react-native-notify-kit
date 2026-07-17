/*
 * Copyright (c) 2016-present Invertase Limited
 */

package io.invertase.notifee

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import app.notifee.core.EventSubscriber
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.reflect.Method
import java.util.IdentityHashMap
import java.util.concurrent.atomic.AtomicLong

object NotifeeReactUtils {

    val headlessTaskManager = HeadlessTask()

    private const val MAX_PENDING_EVENTS = 10
    private const val PENDING_DIAGNOSTICS_TAG = "NOTIFEE_PENDING_DIAG"
    private const val PENDING_DIAGNOSTICS_ENABLED_METADATA =
        "notifee_pending_events_diagnostics_enabled"
    private const val PENDING_DIAGNOSTICS_DELAY_METADATA =
        "notifee_pending_events_delay_after_snapshot_ms"
    private const val MAX_PENDING_DIAGNOSTIC_DELAY_MS = 10_000
    private const val PENDING_DIAGNOSTIC_SCENARIO_ID_KEY = "__notifeePendingDiagScenarioId"
    private const val PENDING_DIAGNOSTIC_EVENT_ID_KEY = "__notifeePendingDiagEventId"
    private const val MAX_PENDING_DIAGNOSTIC_SCENARIO_ID_LENGTH = 48
    private const val MAX_PENDING_DIAGNOSTIC_EVENT_ID_LENGTH = 80

    @Volatile
    private var pendingDiagnosticsState: PendingDiagnosticsState? = null

    private val pendingEvents = mutableListOf<Pair<String, WritableMap>>()

    private data class PendingDiagnosticIdentity(
        val scenarioId: String,
        val eventId: String,
        val eventType: Int?,
    )

    private data class QueuedPendingEventDiagnostic(
        val eventSeq: Long,
        val identity: PendingDiagnosticIdentity?,
    )

    private data class PendingDiagnosticEvent(
        val eventSeq: Long,
        val pendingEvent: Pair<String, WritableMap>,
        val identity: PendingDiagnosticIdentity?,
    ) {
        val eventName: String
            get() = pendingEvent.first

        val eventBody: WritableMap
            get() = pendingEvent.second
    }

    private data class PendingEventToRequeue(
        val pendingEvent: Pair<String, WritableMap>,
        val diagnostic: QueuedPendingEventDiagnostic? = null,
        val reason: String? = null,
    )

    private data class PendingEventMergeResult(
        val queueSizeBefore: Int,
        val requeuedCount: Int,
        val newArrivalsCount: Int,
        val queueSizeAfter: Int,
        val droppedEvents: List<PendingEventToRequeue>,
        val survivingRequeuedEvents: List<PendingEventToRequeue>,
    )

    private data class PendingDiagnosticsConfig(
        val enabled: Boolean,
        val delayAfterSnapshotMs: Long,
    )

    private class PendingDiagnosticsState(val delayAfterSnapshotMs: Long) {
        val eventSequence = AtomicLong(0)
        val flushSequence = AtomicLong(0)
        val queuedEventDiagnostics =
            IdentityHashMap<Pair<String, WritableMap>, QueuedPendingEventDiagnostic>()
    }

    fun flushPendingEvents() {
        val diagnosticsState = pendingDiagnosticsState
        if (diagnosticsState != null) {
            flushPendingEventsDiagnostics(diagnosticsState)
            return
        }

        val eventsToSend: List<Pair<String, WritableMap>>
        synchronized(pendingEvents) {
            eventsToSend = pendingEvents.toList()
            pendingEvents.clear()
        }
        val eventsToRequeue = mutableListOf<PendingEventToRequeue>()
        for (pendingEvent in eventsToSend) {
            val (name, map) = pendingEvent
            try {
                val reactContext = HeadlessTask.getReactContext(EventSubscriber.getContext())
                val hasActiveReactInstance = reactContext?.hasActiveReactInstance()
                if (reactContext == null || hasActiveReactInstance != true) {
                    eventsToRequeue.add(
                        PendingEventToRequeue(
                            pendingEvent = pendingEvent,
                            reason = if (reactContext == null) "context_null" else "context_inactive",
                        ),
                    )
                    continue
                }
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(name, map)
            } catch (e: Exception) {
                Log.e("SEND_EVENT", "flush failed", e)
            }
        }
        mergeUndeliveredPendingEvents(eventsToRequeue, null)
    }

    private fun flushPendingEventsDiagnostics(diagnosticsState: PendingDiagnosticsState) {
        val flushId = diagnosticsState.flushSequence.incrementAndGet()
        val queueSizeAtRequest = currentPendingEventCount()
        logPendingDiagnostic(
            marker = "FLUSH_REQUESTED",
            flushId = flushId,
            queueSizeBefore = queueSizeAtRequest,
            queueSizeAfter = queueSizeAtRequest,
            result = "requested",
        )

        val eventsToSend = snapshotAndClearPendingEventsDiagnostics(diagnosticsState)
        logPendingDiagnostic(
            marker = "FLUSH_SNAPSHOT",
            flushId = flushId,
            queueSizeBefore = eventsToSend.size,
            queueSizeAfter = eventsToSend.size,
            result = "snapshot_captured",
        )
        eventsToSend.forEach { event ->
            logPendingDiagnostic(
                marker = "FLUSH_SNAPSHOT_ITEM",
                eventSeq = event.eventSeq,
                flushId = flushId,
                eventName = event.eventName,
                queueSizeBefore = eventsToSend.size,
                queueSizeAfter = 0,
                diagnosticIdentity = event.identity,
                result = "snapshot_item",
            )
        }
        logPendingDiagnostic(
            marker = "FLUSH_QUEUE_CLEARED",
            flushId = flushId,
            queueSizeBefore = eventsToSend.size,
            queueSizeAfter = 0,
            result = "queue_cleared",
        )

        if (
            eventsToSend.isNotEmpty() &&
            diagnosticsState.delayAfterSnapshotMs > 0
        ) {
            val queueSizeBeforeDelay = currentPendingEventCount()
            logPendingDiagnostic(
                marker = "FLUSH_DIAGNOSTIC_DELAY_BEGIN",
                flushId = flushId,
                queueSizeBefore = queueSizeBeforeDelay,
                queueSizeAfter = queueSizeBeforeDelay,
                result = "sleep_${diagnosticsState.delayAfterSnapshotMs}_ms",
            )
            SystemClock.sleep(diagnosticsState.delayAfterSnapshotMs)
            val queueSizeAfterDelay = currentPendingEventCount()
            logPendingDiagnostic(
                marker = "FLUSH_DIAGNOSTIC_DELAY_END",
                flushId = flushId,
                queueSizeBefore = queueSizeBeforeDelay,
                queueSizeAfter = queueSizeAfterDelay,
                result = "delay_complete",
            )
        }

        var nativeReturns = 0
        var skippedNoContext = 0
        var exceptions = 0
        val eventsToRequeue = mutableListOf<PendingEventToRequeue>()
        for (event in eventsToSend) {
            var reactContext: ReactContext? = null
            var hasActiveReactInstance: Boolean? = null
            try {
                reactContext = HeadlessTask.getReactContext(EventSubscriber.getContext())
                hasActiveReactInstance = reactContext?.hasActiveReactInstance()
                logPendingDiagnostic(
                    marker = "FLUSH_EVENT_CONTEXT_CHECK",
                    eventSeq = event.eventSeq,
                    flushId = flushId,
                    eventName = event.eventName,
                    diagnosticIdentity = event.identity,
                    reactContext = reactContext,
                    hasActiveReactInstance = hasActiveReactInstance,
                    result = when {
                        reactContext == null -> "context_null"
                        hasActiveReactInstance != true -> "context_inactive"
                        else -> "context_active"
                    },
                )

                val activeReactContext = reactContext
                if (activeReactContext == null || hasActiveReactInstance != true) {
                    skippedNoContext += 1
                    val requeueReason =
                        if (activeReactContext == null) "context_null" else "context_inactive"
                    logPendingDiagnostic(
                        marker = "FLUSH_EVENT_SKIPPED_NO_CONTEXT",
                        eventSeq = event.eventSeq,
                        flushId = flushId,
                        eventName = event.eventName,
                        diagnosticIdentity = event.identity,
                        reactContext = reactContext,
                        hasActiveReactInstance = hasActiveReactInstance,
                        result = if (activeReactContext == null) {
                            "skipped_context_null"
                        } else {
                            "skipped_context_inactive"
                        },
                    )
                    eventsToRequeue.add(
                        PendingEventToRequeue(
                            pendingEvent = event.pendingEvent,
                            diagnostic =
                                QueuedPendingEventDiagnostic(event.eventSeq, event.identity),
                            reason = requeueReason,
                        ),
                    )
                    continue
                }

                logPendingDiagnostic(
                    marker = "FLUSH_EVENT_EMIT_BEGIN",
                    eventSeq = event.eventSeq,
                    flushId = flushId,
                    eventName = event.eventName,
                    diagnosticIdentity = event.identity,
                    reactContext = activeReactContext,
                    hasActiveReactInstance = hasActiveReactInstance,
                    result = "native_call_begin",
                )
                activeReactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(event.eventName, event.eventBody)
                nativeReturns += 1
                logPendingDiagnostic(
                    marker = "FLUSH_EVENT_EMIT_RETURN",
                    eventSeq = event.eventSeq,
                    flushId = flushId,
                    eventName = event.eventName,
                    diagnosticIdentity = event.identity,
                    reactContext = activeReactContext,
                    hasActiveReactInstance = hasActiveReactInstance,
                    result = "native_call_returned_no_js_ack",
                )
            } catch (e: Exception) {
                exceptions += 1
                logPendingDiagnostic(
                    marker = "FLUSH_EVENT_EMIT_EXCEPTION",
                    eventSeq = event.eventSeq,
                    flushId = flushId,
                    eventName = event.eventName,
                    diagnosticIdentity = event.identity,
                    reactContext = reactContext,
                    hasActiveReactInstance = hasActiveReactInstance,
                    result = "exception_${e.javaClass.simpleName}",
                    exception = e,
                )
                Log.e("SEND_EVENT", "flush failed", e)
            }
        }

        val mergeResult =
            mergeUndeliveredPendingEvents(eventsToRequeue, diagnosticsState)
        mergeResult.survivingRequeuedEvents.forEach { event ->
            logPendingDiagnostic(
                marker = "FLUSH_EVENT_REQUEUED",
                eventSeq = event.diagnostic?.eventSeq ?: -1,
                flushId = flushId,
                eventName = event.pendingEvent.first,
                diagnosticIdentity = event.diagnostic?.identity,
                queueSizeBefore = mergeResult.queueSizeBefore,
                queueSizeAfter = mergeResult.queueSizeAfter,
                reason = event.reason ?: "context_unavailable",
                requeuedCount = mergeResult.requeuedCount,
                newArrivalsCount = mergeResult.newArrivalsCount,
                droppedCount = mergeResult.droppedEvents.size,
                result = "requeued_${event.reason ?: "context_unavailable"}",
            )
        }
        mergeResult.droppedEvents.forEach { event ->
            logPendingDiagnostic(
                marker = "FLUSH_REQUEUE_DROP",
                eventSeq = event.diagnostic?.eventSeq ?: -1,
                flushId = flushId,
                eventName = event.pendingEvent.first,
                diagnosticIdentity = event.diagnostic?.identity,
                queueSizeBefore = mergeResult.queueSizeBefore,
                queueSizeAfter = mergeResult.queueSizeAfter,
                reason = event.reason ?: "new_arrival",
                requeuedCount = mergeResult.requeuedCount,
                newArrivalsCount = mergeResult.newArrivalsCount,
                droppedCount = mergeResult.droppedEvents.size,
                result = "drop_oldest_after_requeue_merge",
            )
        }
        if (eventsToRequeue.isNotEmpty()) {
            logPendingDiagnostic(
                marker = "FLUSH_REQUEUE_MERGE",
                flushId = flushId,
                queueSizeBefore = mergeResult.queueSizeBefore,
                queueSizeAfter = mergeResult.queueSizeAfter,
                reason = "context_unavailable",
                requeuedCount = mergeResult.requeuedCount,
                newArrivalsCount = mergeResult.newArrivalsCount,
                droppedCount = mergeResult.droppedEvents.size,
                result = "requeued_before_new_arrivals_cap_applied",
            )
        }

        val queueSizeAtCompletion = currentPendingEventCount()
        logPendingDiagnostic(
            marker = "FLUSH_COMPLETED",
            flushId = flushId,
            queueSizeBefore = eventsToSend.size,
            queueSizeAfter = queueSizeAtCompletion,
            result =
                "native_returns_${nativeReturns}_skipped_${skippedNoContext}_exceptions_$exceptions",
        )
    }

    fun promiseResolver(promise: Promise, e: Exception?, bundle: Bundle?) {
        if (e != null) {
            promise.reject(e)
        } else if (bundle != null) {
            promise.resolve(Arguments.fromBundle(bundle))
        } else {
            promise.resolve(null)
        }
    }

    fun promiseResolver(promise: Promise, e: Exception?, bundleList: List<Bundle>?) {
        if (e != null) {
            promise.reject(e)
        } else {
            val writableArray: WritableArray = Arguments.createArray()
            bundleList?.forEach { bundle ->
                writableArray.pushMap(Arguments.fromBundle(bundle))
            }
            promise.resolve(writableArray)
        }
    }

    fun promiseBooleanResolver(promise: Promise, e: Exception?, value: Boolean?) {
        if (e != null) {
            promise.reject(e)
        } else {
            promise.resolve(value)
        }
    }

    fun promiseStringListResolver(promise: Promise, e: Exception?, stringList: List<String>?) {
        if (e != null) {
            promise.reject(e)
        } else {
            val writableArray: WritableArray = Arguments.createArray()
            stringList?.forEach { str ->
                writableArray.pushString(str)
            }
            promise.resolve(writableArray)
        }
    }

    fun promiseResolver(promise: Promise, e: Exception?) {
        if (e != null) {
            promise.reject(e)
        } else {
            promise.resolve(null)
        }
    }

    fun startHeadlessTask(
        taskName: String,
        taskData: com.facebook.react.bridge.WritableMap,
        taskTimeout: Long,
        taskCompletionCallback: HeadlessTask.GenericCallback?,
    ) {
        val config = HeadlessTask.TaskConfig(taskName, taskTimeout, taskData, taskCompletionCallback)
        headlessTaskManager.startTask(EventSubscriber.getContext(), config)
    }

    fun sendEvent(eventName: String, eventMap: com.facebook.react.bridge.WritableMap) {
        val diagnosticsState = pendingDiagnosticsState
        if (diagnosticsState != null) {
            sendEventDiagnostics(diagnosticsState, eventName, eventMap)
            return
        }

        try {
            val reactContext = HeadlessTask.getReactContext(EventSubscriber.getContext())
            if (reactContext == null || !reactContext.hasActiveReactInstance()) {
                synchronized(pendingEvents) {
                    if (pendingEvents.size >= MAX_PENDING_EVENTS) {
                        pendingEvents.removeAt(0)
                    }
                    pendingEvents.add(Pair(eventName, eventMap))
                }
                return
            }

            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, eventMap)
        } catch (e: Exception) {
            Log.e("SEND_EVENT", "", e)
        }
    }

    private fun sendEventDiagnostics(
        diagnosticsState: PendingDiagnosticsState,
        eventName: String,
        eventMap: WritableMap,
    ) {
        val eventSeq = diagnosticsState.eventSequence.incrementAndGet()
        val diagnosticIdentity = extractPendingDiagnosticIdentity(eventMap)
        val queueSizeAtReceipt = currentPendingEventCount()
        logPendingDiagnostic(
            marker = "EVENT_RECEIVED",
            eventSeq = eventSeq,
            eventName = eventName,
            diagnosticIdentity = diagnosticIdentity,
            queueSizeBefore = queueSizeAtReceipt,
            queueSizeAfter = queueSizeAtReceipt,
            result = "received",
        )

        var reactContext: ReactContext? = null
        var hasActiveReactInstance: Boolean? = null
        try {
            reactContext = HeadlessTask.getReactContext(EventSubscriber.getContext())
            hasActiveReactInstance = reactContext?.hasActiveReactInstance()
            val activeReactContext = reactContext
            if (activeReactContext == null || hasActiveReactInstance != true) {
                val pendingEvent = Pair(eventName, eventMap)
                val queueSizeBefore: Int
                val queueSizeAfterDrop: Int
                val queueSizeAfter: Int
                var droppedEvent: Pair<String, WritableMap>? = null
                var droppedEventDiagnostic: QueuedPendingEventDiagnostic? = null
                synchronized(pendingEvents) {
                    queueSizeBefore = pendingEvents.size
                    if (pendingEvents.size >= MAX_PENDING_EVENTS) {
                        droppedEvent = pendingEvents.removeAt(0)
                        droppedEventDiagnostic =
                            diagnosticsState.queuedEventDiagnostics.remove(droppedEvent)
                    }
                    queueSizeAfterDrop = pendingEvents.size
                    pendingEvents.add(pendingEvent)
                    diagnosticsState.queuedEventDiagnostics[pendingEvent] =
                        QueuedPendingEventDiagnostic(eventSeq, diagnosticIdentity)
                    queueSizeAfter = pendingEvents.size
                }

                droppedEvent?.let { dropped ->
                    logPendingDiagnostic(
                        marker = "EVENT_OVERFLOW_DROPPED",
                        eventSeq = droppedEventDiagnostic?.eventSeq ?: -1,
                        eventName = dropped.first,
                        diagnosticIdentity = droppedEventDiagnostic?.identity,
                        queueSizeBefore = queueSizeBefore,
                        queueSizeAfter = queueSizeAfterDrop,
                        reactContext = reactContext,
                        hasActiveReactInstance = hasActiveReactInstance,
                        result = "drop_oldest",
                    )
                }
                logPendingDiagnostic(
                    marker = "EVENT_ENQUEUED",
                    eventSeq = eventSeq,
                    eventName = eventName,
                    diagnosticIdentity = diagnosticIdentity,
                    queueSizeBefore = queueSizeAfterDrop,
                    queueSizeAfter = queueSizeAfter,
                    reactContext = reactContext,
                    hasActiveReactInstance = hasActiveReactInstance,
                    result = if (activeReactContext == null) {
                        "enqueued_context_null"
                    } else {
                        "enqueued_context_inactive"
                    },
                )
                return
            }

            val directQueueSize = currentPendingEventCount()
            logPendingDiagnostic(
                marker = "EVENT_EMIT_DIRECT_BEGIN",
                eventSeq = eventSeq,
                eventName = eventName,
                diagnosticIdentity = diagnosticIdentity,
                queueSizeBefore = directQueueSize,
                queueSizeAfter = directQueueSize,
                reactContext = activeReactContext,
                hasActiveReactInstance = hasActiveReactInstance,
                result = "native_call_begin",
            )
            activeReactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, eventMap)
            logPendingDiagnostic(
                marker = "EVENT_EMIT_DIRECT_RETURN",
                eventSeq = eventSeq,
                eventName = eventName,
                diagnosticIdentity = diagnosticIdentity,
                reactContext = activeReactContext,
                hasActiveReactInstance = hasActiveReactInstance,
                result = "native_call_returned_no_js_ack",
            )
        } catch (e: Exception) {
            logPendingDiagnostic(
                marker = "EVENT_EMIT_DIRECT_EXCEPTION",
                eventSeq = eventSeq,
                eventName = eventName,
                diagnosticIdentity = diagnosticIdentity,
                reactContext = reactContext,
                hasActiveReactInstance = hasActiveReactInstance,
                result = "exception_${e.javaClass.simpleName}",
                exception = e,
            )
            Log.e("SEND_EVENT", "", e)
        }
    }

    private fun snapshotAndClearPendingEventsDiagnostics(
        diagnosticsState: PendingDiagnosticsState,
    ): List<PendingDiagnosticEvent> {
        synchronized(pendingEvents) {
            val eventsToSend =
                pendingEvents.map { event ->
                    val eventDiagnostic =
                        diagnosticsState.queuedEventDiagnostics.remove(event)
                    PendingDiagnosticEvent(
                        eventDiagnostic?.eventSeq ?: -1,
                        event,
                        eventDiagnostic?.identity,
                    )
                }
            pendingEvents.clear()
            return eventsToSend
        }
    }

    private fun mergeUndeliveredPendingEvents(
        eventsToRequeue: List<PendingEventToRequeue>,
        diagnosticsState: PendingDiagnosticsState?,
    ): PendingEventMergeResult {
        synchronized(pendingEvents) {
            val newArrivals =
                pendingEvents.map { pendingEvent ->
                    PendingEventToRequeue(
                        pendingEvent = pendingEvent,
                        diagnostic = diagnosticsState?.queuedEventDiagnostics?.get(pendingEvent),
                    )
                }
            val mergedEvents = eventsToRequeue + newArrivals
            val droppedCount = (mergedEvents.size - MAX_PENDING_EVENTS).coerceAtLeast(0)
            val droppedEvents = mergedEvents.take(droppedCount)
            val survivingEvents = mergedEvents.drop(droppedCount)
            val droppedRequeuedCount = droppedCount.coerceAtMost(eventsToRequeue.size)
            val survivingRequeuedEvents = eventsToRequeue.drop(droppedRequeuedCount)

            pendingEvents.clear()
            pendingEvents.addAll(survivingEvents.map { it.pendingEvent })
            diagnosticsState?.queuedEventDiagnostics?.apply {
                clear()
                survivingEvents.forEach { event ->
                    event.diagnostic?.let { diagnostic -> put(event.pendingEvent, diagnostic) }
                }
            }

            return PendingEventMergeResult(
                queueSizeBefore = mergedEvents.size,
                requeuedCount = eventsToRequeue.size,
                newArrivalsCount = newArrivals.size,
                queueSizeAfter = survivingEvents.size,
                droppedEvents = droppedEvents,
                survivingRequeuedEvents = survivingRequeuedEvents,
            )
        }
    }

    private fun currentPendingEventCount(): Int = synchronized(pendingEvents) { pendingEvents.size }

    private fun extractPendingDiagnosticIdentity(
        eventMap: WritableMap,
    ): PendingDiagnosticIdentity? {
        return try {
            val detail = readPendingDiagnosticMap(eventMap, "detail") ?: return null
            val notification = readPendingDiagnosticMap(detail, "notification") ?: return null
            val data = readPendingDiagnosticMap(notification, "data") ?: return null
            val scenarioId =
                readPendingDiagnosticString(data, PENDING_DIAGNOSTIC_SCENARIO_ID_KEY)
                    ?: return null
            val eventId =
                readPendingDiagnosticString(data, PENDING_DIAGNOSTIC_EVENT_ID_KEY) ?: return null

            if (
                !isValidPendingDiagnosticScenarioId(scenarioId) ||
                !isValidPendingDiagnosticEventId(scenarioId, eventId)
            ) {
                null
            } else {
                PendingDiagnosticIdentity(
                    scenarioId,
                    eventId,
                    readPendingDiagnosticInt(eventMap, "type"),
                )
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun readPendingDiagnosticMap(map: ReadableMap, key: String): ReadableMap? {
        if (!map.hasKey(key) || map.isNull(key) || map.getType(key) != ReadableType.Map) {
            return null
        }
        return map.getMap(key)
    }

    private fun readPendingDiagnosticString(map: ReadableMap, key: String): String? {
        if (!map.hasKey(key) || map.isNull(key) || map.getType(key) != ReadableType.String) {
            return null
        }
        return map.getString(key)
    }

    private fun readPendingDiagnosticInt(map: ReadableMap, key: String): Int? {
        if (!map.hasKey(key) || map.isNull(key) || map.getType(key) != ReadableType.Number) {
            return null
        }

        val numericValue =
            try {
                map.getDouble(key)
            } catch (_: Exception) {
                return try {
                    map.getInt(key)
                } catch (_: Exception) {
                    null
                }
            }
        val integerValue = numericValue.toInt()
        return integerValue.takeIf { it.toDouble() == numericValue }
    }

    private fun isValidPendingDiagnosticScenarioId(value: String): Boolean =
        value.length in 1..MAX_PENDING_DIAGNOSTIC_SCENARIO_ID_LENGTH &&
            value.all { character ->
                character in 'A'..'Z' ||
                    character in 'a'..'z' ||
                    character in '0'..'9' ||
                    character == '.' ||
                    character == '_' ||
                    character == '-'
            }

    private fun isValidPendingDiagnosticEventId(
        scenarioId: String,
        eventId: String,
    ): Boolean {
        if (eventId.length !in 1..MAX_PENDING_DIAGNOSTIC_EVENT_ID_LENGTH) return false

        val prefix = "pending-diag:$scenarioId:"
        if (!eventId.startsWith(prefix)) return false

        val suffix = eventId.substring(prefix.length)
        if (suffix == "A" || suffix == "B") return true
        if (!suffix.startsWith("overflow:")) return false

        val overflowIndex = suffix.substring("overflow:".length)
        if (overflowIndex.length != 2 || overflowIndex.any { it !in '0'..'9' }) return false
        return overflowIndex.toIntOrNull()?.let { it in 1..11 } == true
    }

    // Invoked reflectively only by the smoke app's debug-only reload receiver. Keeping this method
    // private avoids adding a library API while ensuring metadata work never runs in an event path.
    @Synchronized
    private fun initializePendingDiagnostics(context: Context): Boolean {
        if (pendingDiagnosticsState != null) return true

        val config = loadPendingDiagnosticsConfig(context)
        if (!config.enabled) return false

        pendingDiagnosticsState = PendingDiagnosticsState(config.delayAfterSnapshotMs)
        return true
    }

    @Suppress("DEPRECATION")
    private fun loadPendingDiagnosticsConfig(context: Context): PendingDiagnosticsConfig {
        return try {
            val applicationInfo =
                context.packageManager.getApplicationInfo(
                    context.packageName,
                    PackageManager.GET_META_DATA,
                )
            val metadata = applicationInfo.metaData
            val enabled =
                metadata?.getBoolean(PENDING_DIAGNOSTICS_ENABLED_METADATA, false) == true &&
                    applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
            val delayAfterSnapshotMs =
                if (enabled) {
                    metadata
                        .getInt(PENDING_DIAGNOSTICS_DELAY_METADATA, 0)
                        .coerceIn(0, MAX_PENDING_DIAGNOSTIC_DELAY_MS)
                        .toLong()
                } else {
                    0
                }
            PendingDiagnosticsConfig(enabled, delayAfterSnapshotMs)
        } catch (_: Exception) {
            PendingDiagnosticsConfig(false, 0)
        }
    }

    private fun logPendingDiagnostic(
        marker: String,
        eventSeq: Long = -1,
        flushId: Long = -1,
        eventName: String? = null,
        diagnosticIdentity: PendingDiagnosticIdentity? = null,
        queueSizeBefore: Int = -1,
        queueSizeAfter: Int = -1,
        reason: String = "not_applicable",
        requeuedCount: Int = -1,
        newArrivalsCount: Int = -1,
        droppedCount: Int = -1,
        reactContext: ReactContext? = null,
        hasActiveReactInstance: Boolean? = null,
        result: String,
        exception: Exception? = null,
    ) {
        val contextIdentity =
            reactContext?.let { "0x${Integer.toHexString(System.identityHashCode(it))}" } ?: "null"
        val message =
            "$PENDING_DIAGNOSTICS_TAG marker=$marker " +
                "eventSeq=$eventSeq flushId=$flushId " +
                "eventName=${sanitizePendingDiagnosticValue(eventName)} " +
                "diagScenarioId=${diagnosticIdentity?.scenarioId ?: "unavailable"} " +
                "diagEventId=${diagnosticIdentity?.eventId ?: "unavailable"} " +
                "eventType=${diagnosticIdentity?.eventType ?: "unavailable"} " +
                "thread=${sanitizePendingDiagnosticValue(Thread.currentThread().name)} " +
                "elapsedRealtime=${SystemClock.elapsedRealtime()} " +
                "queueSizeBefore=$queueSizeBefore queueSizeAfter=$queueSizeAfter " +
                "reason=${sanitizePendingDiagnosticValue(reason)} " +
                "requeuedCount=$requeuedCount newArrivalsCount=$newArrivalsCount " +
                "droppedCount=$droppedCount " +
                "contextIdentity=$contextIdentity reactHostIdentity=unavailable " +
                "hasActiveReactInstance=${hasActiveReactInstance ?: "not_checked"} " +
                "result=${sanitizePendingDiagnosticValue(result)}"
        if (exception == null) {
            Log.i(PENDING_DIAGNOSTICS_TAG, message)
        } else {
            Log.e(PENDING_DIAGNOSTICS_TAG, message, exception)
        }
    }

    private fun sanitizePendingDiagnosticValue(value: String?): String =
        value
            ?.replace(' ', '_')
            ?.replace('\t', '_')
            ?.replace('\r', '_')
            ?.replace('\n', '_')
            ?.take(120)
            ?: "null"

    fun isAppInForeground(): Boolean {
        return ProcessLifecycleOwner.get()
            .lifecycle
            .currentState
            .isAtLeast(Lifecycle.State.RESUMED)
    }

    @SuppressLint("WrongConstant")
    fun hideNotificationDrawer() {
        val context = EventSubscriber.getContext()
        try {
            val service = context.getSystemService("statusbar")
            val statusbarManager = Class.forName("android.app.StatusBarManager")
            val methodName = "collapsePanels"
            val collapse: Method = statusbarManager.getMethod(methodName)
            collapse.isAccessible = true
            collapse.invoke(service)
        } catch (e: Exception) {
            Log.e("HIDE_NOTIF_DRAWER", "", e)
        }
    }
}
