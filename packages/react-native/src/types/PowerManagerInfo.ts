/*
 * Copyright (c) 2016-present Invertase Limited.
 */

/**
 * The interface that represents the information returned from `getPowerManagerInfo()`.
 *
 * View the [Background Restrictions](/react-native/android/background-restrictions) documentation to learn more.
 *
 * @platform android
 */
export interface PowerManagerInfo {
  /**
   * The device manufacturer.
   *
   * For example, Samsung.
   */
  manufacturer?: string;

  /**
   * The device model.
   *
   * For example, Galaxy S8
   */
  model?: string;

  /**
   * The Android version
   *
   * For example, Android 10
   */
  version?: string;

  /**
   * The known vendor-settings activity candidate for this device manufacturer.
   *
   * This value is based on Notify Kit's manufacturer mapping. It is not prevalidated
   * with `PackageManager`, and it is not a guarantee that the activity is installed
   * or accessible on the current device firmware.
   *
   * Use this as a best-effort indicator of what steps the user may have to perform,
   * in-order to prevent your app from being killed. `openPowerManagerSettings()`
   * handles unavailable or rejected candidates safely.
   *
   * If no known activity candidate exists, value will be null.
   */
  activity?: string | null;
}
