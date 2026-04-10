package com.notifeeexample.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@LargeTest
class BaselineProfileGenerator {

    @get:Rule
    val rule = BaselineProfileRule()

    private val targetPackage = "com.notifeeexample"

    @Before
    fun grantNotificationPermission() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.grantRuntimePermission(
            targetPackage,
            "android.permission.POST_NOTIFICATIONS",
        )
    }

    @Test
    fun generateForegroundServiceNotificationProfile() {
        rule.collect(
            packageName = targetPackage,
            includeInStartupProfile = true,
            maxIterations = 5,
            stableIterations = 3,
        ) {
            // Cold start the smoke app
            pressHome()
            startActivityAndWait()
            device.waitForIdle()

            // Find and tap the FGS trigger button.
            // This selector matches the button's visible text label rather than its testID.
            // React Native's Fabric renderer on RN 0.84 with the New Architecture has
            // inconsistent serialization of testID to Android accessibility attributes —
            // it may end up on resource-id, content-description, or neither depending on
            // view flattening and component configuration. Matching on the visible text
            // is more robust because the <Text> child of the <Pressable> always produces
            // a text-bearing accessibility node.
            //
            // Tradeoff: if the button label is ever renamed in App.tsx, update the string
            // literal here to match. This is acceptable for a developer-run baseline
            // profile generator that is not part of continuous CI.
            val triggerButton = device.wait(
                Until.findObject(By.text("Start Foreground Service")),
                5_000L,
            )
            requireNotNull(triggerButton) { "Could not find FGS trigger button in smoke app" }
            triggerButton.click()

            // Wait for the foreground service notification to be posted
            device.waitForIdle()

            // Open the notification shade and verify the notification appeared
            device.openNotification()
            device.wait(
                Until.hasObject(By.textContains("Foreground Service")),
                10_000L,
            )
            device.pressBack()
        }
    }
}
