plugins {
    id("com.android.test")
    id("org.jetbrains.kotlin.android")
    id("androidx.baselineprofile")
}

android {
    namespace = "com.notifeeexample.baselineprofile"
    compileSdk = 36

    defaultConfig {
        minSdk = 28 // macrobenchmark requires API 28+
        targetSdk = 36
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    targetProjectPath = ":app"

    buildTypes {
        // Required: benchmark build type that falls back to release
        create("benchmark") {
            isDebuggable = false
            matchingFallbacks += listOf("release")
        }
    }
}

baselineProfile {
    useConnectedDevices = true
}

dependencies {
    implementation("androidx.test.ext:junit:1.2.1")
    implementation("androidx.test:runner:1.6.2")
    implementation("androidx.benchmark:benchmark-macro-junit4:1.4.1")
    implementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
