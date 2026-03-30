/*
 * Copyright (c) 2016-present Invertase Limited
 */

package io.invertase.notifee

import androidx.annotation.Keep
import app.notifee.core.event.BlockStateEvent
import app.notifee.core.event.ForegroundServiceEvent
import app.notifee.core.event.LogEvent
import app.notifee.core.event.NotificationEvent
import app.notifee.core.interfaces.EventListener
import com.facebook.react.bridge.Arguments

@Keep
class NotifeeEventSubscriber : EventListener {

    companion object {
        const val NOTIFICATION_EVENT_KEY = "app.notifee.notification-event"
        const val FOREGROUND_NOTIFICATION_TASK_KEY = "app.notifee.foreground-service-headless-task"

        private const val KEY_TYPE = "type"
        private const val KEY_DETAIL = "detail"
        private const val KEY_BLOCKED = "blocked"
        private const val KEY_HEADLESS = "headless"
        private const val KEY_NOTIFICATION = "notification"
        private const val KEY_DETAIL_PRESS_ACTION = "pressAction"
        private const val KEY_DETAIL_INPUT = "input"
    }

    override fun onNotificationEvent(notificationEvent: NotificationEvent) {
        val eventMap = Arguments.createMap()
        val eventDetailMap = Arguments.createMap()
        eventMap.putInt(KEY_TYPE, notificationEvent.type)

        eventDetailMap.putMap(
            KEY_NOTIFICATION,
            Arguments.fromBundle(notificationEvent.notification.toBundle()),
        )

        notificationEvent.extras?.let { extras ->
            extras.getBundle(KEY_DETAIL_PRESS_ACTION)?.let { pressAction ->
                eventDetailMap.putMap(KEY_DETAIL_PRESS_ACTION, Arguments.fromBundle(pressAction))
            }
            extras.getString(KEY_DETAIL_INPUT)?.let { input ->
                eventDetailMap.putString(KEY_DETAIL_INPUT, input)
            }
        }

        eventMap.putMap(KEY_DETAIL, eventDetailMap)

        if (NotifeeReactUtils.isAppInForeground()) {
            eventMap.putBoolean(KEY_HEADLESS, false)
            NotifeeReactUtils.sendEvent(NOTIFICATION_EVENT_KEY, eventMap)
        } else {
            eventMap.putBoolean(KEY_HEADLESS, true)
            NotifeeReactUtils.startHeadlessTask(NOTIFICATION_EVENT_KEY, eventMap, 60000, null)
        }
    }

    override fun onLogEvent(logEvent: LogEvent) {
        // LogEvent callbacks are emitted by NotifeeCore logging, but the React Native layer
        // does not currently forward them to JS or headless tasks, so this subscriber
        // intentionally ignores them.
    }

    override fun onBlockStateEvent(blockStateEvent: BlockStateEvent) {
        val eventMap = Arguments.createMap()
        val eventDetailMap = Arguments.createMap()

        val type = blockStateEvent.type
        eventMap.putInt(KEY_TYPE, type)

        if (type == BlockStateEvent.TYPE_CHANNEL_BLOCKED ||
            type == BlockStateEvent.TYPE_CHANNEL_GROUP_BLOCKED
        ) {
            val mapKey =
                if (type == BlockStateEvent.TYPE_CHANNEL_BLOCKED) "channel" else "channelGroup"
            blockStateEvent.channelOrGroupBundle?.let { bundle ->
                eventDetailMap.putMap(mapKey, Arguments.fromBundle(bundle))
            }
        }

        if (type == BlockStateEvent.TYPE_APP_BLOCKED) {
            eventDetailMap.putBoolean(KEY_BLOCKED, blockStateEvent.isBlocked)
        }

        eventMap.putMap(KEY_DETAIL, eventDetailMap)

        if (NotifeeReactUtils.isAppInForeground()) {
            eventMap.putBoolean(KEY_HEADLESS, false)
            NotifeeReactUtils.sendEvent(NOTIFICATION_EVENT_KEY, eventMap)
        } else {
            eventMap.putBoolean(KEY_HEADLESS, true)
            NotifeeReactUtils.startHeadlessTask(
                NOTIFICATION_EVENT_KEY,
                eventMap,
                0,
                blockStateEvent::setCompletionResult,
            )
        }
    }

    override fun onForegroundServiceEvent(foregroundServiceEvent: ForegroundServiceEvent) {
        val notificationBundle = foregroundServiceEvent.notification

        val eventMap = Arguments.createMap()
        eventMap.putMap(KEY_NOTIFICATION, Arguments.fromBundle(notificationBundle.toBundle()))

        NotifeeReactUtils.startHeadlessTask(
            FOREGROUND_NOTIFICATION_TASK_KEY,
            eventMap,
            0,
            foregroundServiceEvent::setCompletionResult,
        )
    }
}
