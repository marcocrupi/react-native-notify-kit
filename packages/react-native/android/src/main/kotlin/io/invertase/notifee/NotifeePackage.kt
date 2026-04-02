/*
 * Copyright (c) 2016-present Invertase Limited
 */

package io.invertase.notifee

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class NotifeePackage : BaseReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return if (name == NotifeeApiModule.NAME) {
            NotifeeApiModule(reactContext)
        } else {
            null
        }
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                NotifeeApiModule.NAME to ReactModuleInfo(
                    NotifeeApiModule.NAME,
                    NotifeeApiModule.NAME,
                    false, // canOverrideExistingModule
                    false, // needsEagerInit
                    false, // isCxxModule
                    true,  // isTurboModule
                ),
            )
        }
    }
}
