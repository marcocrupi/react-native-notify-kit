package com.notifeeexample

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.core.PermissionListener

class MainActivity : ReactActivity() {
  private var r5Observer: Issue92TransitionObserver? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (BuildConfig.DEBUG) {
      r5Observer = Issue92TransitionObserver(window.decorView).also { it.start() }
    }
  }

  override fun requestPermissions(
      permissions: Array<String>, requestCode: Int, listener: PermissionListener?) {
    r5Observer?.permissionRequest(permissions, requestCode, listener?.javaClass?.name)
    super.requestPermissions(permissions, requestCode, listener)
  }

  override fun onDestroy() {
    r5Observer?.stop()
    super.onDestroy()
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "NotifeeExample"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
