/*
 * Copyright (c) 2016-present Invertase Limited
 */

package io.invertase.notifee

import app.notifee.core.InitProvider
import app.notifee.core.Notifee
import com.facebook.react.modules.systeminfo.ReactNativeVersion

class NotifeeInitProvider : InitProvider() {

    override fun onCreate(): Boolean {
        val result = super.onCreate()
        Notifee.initialize(NotifeeEventSubscriber())
        return result
    }

    private fun getApplicationVersionString(): String {
        val context = this.context ?: return "unknown"
        return try {
            val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            pInfo.versionName ?: "unknown"
        } catch (e: Exception) {
            "unknown"
        }
    }

    private fun getReactNativeVersionString(): String {
        val versionMap = ReactNativeVersion.VERSION
        val major = versionMap["major"] as Int
        val minor = versionMap["minor"] as Int
        val patch = versionMap["patch"] as Int
        val prerelease = versionMap["prerelease"] as? String

        return buildString {
            append("$major.$minor.$patch")
            if (prerelease != null) {
                append(".$prerelease")
            }
        }
    }
}
