/*
 * Copyright (c) 2016-present Invertase Limited
 */

package io.invertase.notifee

import android.annotation.SuppressLint
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import app.notifee.core.EventSubscriber
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableArray
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.reflect.Method

object NotifeeReactUtils {

    val headlessTaskManager = HeadlessTask()

    private const val MAX_PENDING_EVENTS = 10
    private val pendingEvents = mutableListOf<Pair<String, com.facebook.react.bridge.WritableMap>>()

    fun flushPendingEvents() {
        val eventsToSend: List<Pair<String, com.facebook.react.bridge.WritableMap>>
        synchronized(pendingEvents) {
            eventsToSend = pendingEvents.toList()
            pendingEvents.clear()
        }
        for ((name, map) in eventsToSend) {
            try {
                val reactContext = HeadlessTask.getReactContext(EventSubscriber.getContext())
                if (reactContext != null && reactContext.hasActiveReactInstance()) {
                    reactContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit(name, map)
                }
            } catch (e: Exception) {
                Log.e("SEND_EVENT", "flush failed", e)
            }
        }
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
            val methodName = if (Build.VERSION.SDK_INT >= 17) "collapsePanels" else "collapse"
            val collapse: Method = statusbarManager.getMethod(methodName)
            collapse.isAccessible = true
            collapse.invoke(service)
        } catch (e: Exception) {
            Log.e("HIDE_NOTIF_DRAWER", "", e)
        }
    }
}
