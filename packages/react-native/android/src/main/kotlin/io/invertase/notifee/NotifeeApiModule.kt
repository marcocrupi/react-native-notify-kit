/*
 * Copyright (c) 2016-present Invertase Limited
 */

package io.invertase.notifee

import android.Manifest
import android.os.Build
import android.os.Bundle
import app.notifee.core.Logger
import app.notifee.core.Notifee
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

class NotifeeApiModule(reactContext: ReactApplicationContext) :
    NativeNotifeeModuleSpec(reactContext), PermissionListener {

    companion object {
        const val NAME = "NotifeeApiModule"
        private const val NOTIFICATION_TYPE_ALL = 0
        private const val NOTIFICATION_TYPE_DISPLAYED = 1
        private const val NOTIFICATION_TYPE_TRIGGER = 2

        @JvmStatic
        fun getMainComponent(defaultComponent: String): String {
            return Notifee.getInstance().getMainComponent(defaultComponent)
        }
    }

    override fun invalidate() {
        NotifeeReactUtils.headlessTaskManager.stopAllTasks()
        super.invalidate()
    }

    override fun cancelAllNotifications(promise: Promise) {
        Notifee.getInstance()
            .cancelAllNotifications(NOTIFICATION_TYPE_ALL) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun cancelDisplayedNotifications(promise: Promise) {
        Notifee.getInstance()
            .cancelAllNotifications(NOTIFICATION_TYPE_DISPLAYED) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun cancelTriggerNotifications(promise: Promise) {
        Notifee.getInstance()
            .cancelAllNotifications(NOTIFICATION_TYPE_TRIGGER) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun cancelAllNotificationsWithIds(
        idsArray: ReadableArray,
        notificationType: Double,
        tag: String?,
        promise: Promise,
    ) {
        val ids = ArrayList<String>(idsArray.size())
        for (i in 0 until idsArray.size()) {
            ids.add(idsArray.getString(i)!!)
        }

        Notifee.getInstance()
            .cancelAllNotificationsWithIds(notificationType.toInt(), ids, tag) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun getDisplayedNotifications(promise: Promise) {
        Notifee.getInstance()
            .getDisplayedNotifications { e, bundleList ->
                NotifeeReactUtils.promiseResolver(promise, e, bundleList)
            }
    }

    override fun getTriggerNotifications(promise: Promise) {
        Notifee.getInstance()
            .getTriggerNotifications { e, bundleList ->
                NotifeeReactUtils.promiseResolver(promise, e, bundleList)
            }
    }

    override fun getTriggerNotificationIds(promise: Promise) {
        Notifee.getInstance()
            .getTriggerNotificationIds { e, stringList ->
                NotifeeReactUtils.promiseStringListResolver(promise, e, stringList)
            }
    }

    override fun createChannel(channelMap: ReadableMap, promise: Promise) {
        Notifee.getInstance()
            .createChannel(Arguments.toBundle(channelMap)) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun createChannels(channelsArray: ReadableArray, promise: Promise) {
        val channels = ArrayList<Bundle>(channelsArray.size())
        for (i in 0 until channelsArray.size()) {
            channels.add(Arguments.toBundle(channelsArray.getMap(i))!!)
        }

        Notifee.getInstance()
            .createChannels(channels) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun createChannelGroup(channelGroupMap: ReadableMap, promise: Promise) {
        Notifee.getInstance()
            .createChannelGroup(Arguments.toBundle(channelGroupMap)) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun createChannelGroups(channelGroupsArray: ReadableArray, promise: Promise) {
        val channelGroups = ArrayList<Bundle>(channelGroupsArray.size())
        for (i in 0 until channelGroupsArray.size()) {
            channelGroups.add(Arguments.toBundle(channelGroupsArray.getMap(i))!!)
        }

        Notifee.getInstance()
            .createChannelGroups(channelGroups) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun deleteChannel(channelId: String, promise: Promise) {
        Notifee.getInstance()
            .deleteChannel(channelId) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun deleteChannelGroup(channelGroupId: String, promise: Promise) {
        Notifee.getInstance()
            .deleteChannelGroup(channelGroupId) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun displayNotification(notification: ReadableMap, promise: Promise) {
        Notifee.getInstance()
            .displayNotification(Arguments.toBundle(notification)) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun openAlarmPermissionSettings(promise: Promise) {
        Notifee.getInstance()
            .openAlarmPermissionSettings(getReactApplicationContext().getCurrentActivity()) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun createTriggerNotification(
        notificationMap: ReadableMap,
        triggerMap: ReadableMap,
        promise: Promise,
    ) {
        Notifee.getInstance()
            .createTriggerNotification(
                Arguments.toBundle(notificationMap),
                Arguments.toBundle(triggerMap),
            ) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun getChannels(promise: Promise) {
        Notifee.getInstance()
            .getChannels { e, bundleList ->
                NotifeeReactUtils.promiseResolver(promise, e, bundleList)
            }
    }

    override fun getChannel(channelId: String, promise: Promise) {
        Notifee.getInstance()
            .getChannel(channelId) { e, bundle ->
                NotifeeReactUtils.promiseResolver(promise, e, bundle)
            }
    }

    override fun getChannelGroups(promise: Promise) {
        Notifee.getInstance()
            .getChannelGroups { e, bundleList ->
                NotifeeReactUtils.promiseResolver(promise, e, bundleList)
            }
    }

    override fun getChannelGroup(channelGroupId: String, promise: Promise) {
        Notifee.getInstance()
            .getChannel(channelGroupId) { e, bundle ->
                NotifeeReactUtils.promiseResolver(promise, e, bundle)
            }
    }

    override fun isChannelCreated(channelId: String, promise: Promise) {
        Notifee.getInstance()
            .isChannelCreated(channelId) { e, result ->
                NotifeeReactUtils.promiseBooleanResolver(promise, e, result)
            }
    }

    override fun isChannelBlocked(channelId: String, promise: Promise) {
        Notifee.getInstance()
            .isChannelBlocked(channelId) { e, result ->
                NotifeeReactUtils.promiseBooleanResolver(promise, e, result)
            }
    }

    override fun getInitialNotification(promise: Promise) {
        Notifee.getInstance()
            .getInitialNotification(getReactApplicationContext().getCurrentActivity()) { e, bundle ->
                NotifeeReactUtils.promiseResolver(promise, e, bundle)
            }
    }

    override fun getNotificationSettings(promise: Promise) {
        Notifee.getInstance()
            .getNotificationSettings { e, bundle ->
                NotifeeReactUtils.promiseResolver(promise, e, bundle)
            }
    }

    override fun requestPermission(permissions: ReadableMap, promise: Promise) {
        // permissions parameter is ignored on Android — only used by iOS
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            Notifee.getInstance()
                .getNotificationSettings { e, bundle ->
                    NotifeeReactUtils.promiseResolver(promise, e, bundle)
                }
            return
        }

        val activity = getReactApplicationContext().getCurrentActivity() as? PermissionAwareActivity
        if (activity == null) {
            Logger.d(
                "requestPermission",
                "Unable to get permissionAwareActivity for ${Build.VERSION.SDK_INT}",
            )
            Notifee.getInstance()
                .getNotificationSettings { e, bundle ->
                    NotifeeReactUtils.promiseResolver(promise, e, bundle)
                }
            return
        }

        Notifee.getInstance()
            .setRequestPermissionCallback { e, bundle ->
                NotifeeReactUtils.promiseResolver(promise, e, bundle)
            }

        try {
            activity.requestPermissions(
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                Notifee.REQUEST_CODE_NOTIFICATION_PERMISSION,
                this,
            )
        } catch (e: Exception) {
            Logger.d(
                "requestPermission",
                "Failed to request POST_NOTIFICATIONS permission: ${e.message}",
            )
            NotifeeReactUtils.promiseResolver(promise, e)
        }
    }

    override fun openNotificationSettings(channelId: String?, promise: Promise) {
        Notifee.getInstance()
            .openNotificationSettings(channelId, getReactApplicationContext().getCurrentActivity()) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun openBatteryOptimizationSettings(promise: Promise) {
        Notifee.getInstance()
            .openBatteryOptimizationSettings(getReactApplicationContext().getCurrentActivity()) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun isBatteryOptimizationEnabled(promise: Promise) {
        Notifee.getInstance()
            .isBatteryOptimizationEnabled { e, result ->
                NotifeeReactUtils.promiseBooleanResolver(promise, e, result)
            }
    }

    override fun getPowerManagerInfo(promise: Promise) {
        Notifee.getInstance()
            .getPowerManagerInfo { e, bundle ->
                NotifeeReactUtils.promiseResolver(promise, e, bundle)
            }
    }

    override fun openPowerManagerSettings(promise: Promise) {
        Notifee.getInstance()
            .openPowerManagerSettings(getReactApplicationContext().getCurrentActivity()) { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun stopForegroundService(promise: Promise) {
        Notifee.getInstance()
            .stopForegroundService { e, _ ->
                NotifeeReactUtils.promiseResolver(promise, e)
            }
    }

    override fun prewarmForegroundService(promise: Promise) {
        val context = reactApplicationContext.applicationContext ?: run {
            promise.reject("ERR_CONTEXT", "ReactApplicationContext is null")
            return
        }
        val executor = java.util.concurrent.Executors.newSingleThreadExecutor { r ->
            Thread(r, "notifee-prewarm").apply {
                isDaemon = true
                priority = Thread.MIN_PRIORITY
            }
        }
        executor.submit {
            android.os.Trace.beginSection("notifee:prewarm")
            try {
                app.notifee.core.WarmupHelper.runWarmup(context)
                promise.resolve(null)
            } catch (t: Throwable) {
                // Best-effort semantics: warmup failures don't reject the promise.
                // WarmupHelper logs and swallows internal errors; if something
                // unexpectedly escapes, log it and still resolve so the JS-side
                // await does not hang.
                Logger.e("NotifeeApiModule", "prewarmForegroundService unexpectedly threw", t)
                promise.resolve(null)
            } finally {
                android.os.Trace.endSection()
            }
        }
        executor.shutdown()
    }

    override fun hideNotificationDrawer() {
        NotifeeReactUtils.hideNotificationDrawer()
    }

    override fun addListener(eventName: String) {
        // Keep: Required for RN built in Event Emitter Calls.
        NotifeeReactUtils.flushPendingEvents()
    }

    override fun removeListeners(count: Double) {
        // Keep: Required for RN built in Event Emitter Calls.
    }

    override fun getName(): String = "NotifeeApiModule"

    override fun getTypedExportedConstants(): MutableMap<String, Any> {
        return mutableMapOf("ANDROID_API_LEVEL" to Build.VERSION.SDK_INT)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray,
    ): Boolean {
        return Notifee.getInstance()
            .onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    // ─── iOS-only stubs (required by NativeNotifeeModuleSpec) ───────────────

    override fun cancelNotification(notificationId: String, promise: Promise) {
        promise.resolve(null)
    }

    override fun cancelDisplayedNotification(notificationId: String, promise: Promise) {
        promise.resolve(null)
    }

    override fun cancelTriggerNotification(notificationId: String, promise: Promise) {
        promise.resolve(null)
    }

    override fun cancelDisplayedNotificationsWithIds(ids: ReadableArray, promise: Promise) {
        promise.resolve(null)
    }

    override fun cancelTriggerNotificationsWithIds(ids: ReadableArray, promise: Promise) {
        promise.resolve(null)
    }

    override fun getNotificationCategories(promise: Promise) {
        promise.resolve(Arguments.createArray())
    }

    override fun setNotificationCategories(categories: ReadableArray, promise: Promise) {
        promise.resolve(null)
    }

    override fun setBadgeCount(count: Double, promise: Promise) {
        promise.resolve(null)
    }

    override fun getBadgeCount(promise: Promise) {
        promise.resolve(0.0)
    }

    override fun incrementBadgeCount(incrementBy: Double, promise: Promise) {
        promise.resolve(null)
    }

    override fun decrementBadgeCount(decrementBy: Double, promise: Promise) {
        promise.resolve(null)
    }

    override fun setNotificationConfig(config: ReadableMap, promise: Promise) {
        promise.resolve(null)
    }
}
