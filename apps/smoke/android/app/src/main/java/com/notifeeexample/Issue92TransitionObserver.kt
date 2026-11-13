package com.notifeeexample

import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import org.json.JSONObject

/**
 * Debug smoke witness only: reads the actual Android tree on the UI thread.
 * Pre-draw observes applied mounts/transforms, not physical display presentation.
 * Native movement starts in (last stationary frame, first moving frame]; this
 * interval, not the JS listener timestamp, bounds request timing. No JS clock join.
 */
class Issue92TransitionObserver(private val decor: View) : ViewTreeObserver.OnPreDrawListener {
  private var marker: View? = null
  private var id: String? = null
  private var stationaryAt: Long? = null
  private var firstMovingAt: Long? = null
  private var sawDetails = false
  private var sawReplacement = false
  private var sawSourceRemoval = false

  fun start() { decor.viewTreeObserver.addOnPreDrawListener(this) }
  fun stop() { decor.viewTreeObserver.removeOnPreDrawListener(this) }

  private fun tree(): Map<String, View> {
    val found = mutableMapOf<String, View>()
    fun visit(view: View) {
      val tag = view.getTag(com.facebook.react.R.id.react_test_id) as? String
      if (tag != null && tag.startsWith("r5-")) found[tag] = view
      if (view is ViewGroup) for (index in 0 until view.childCount) {
        view.getChildAt(index)?.let { visit(it) }
      }
    }
    visit(decor)
    return found
  }

  private fun emit(type: String, fields: Map<String, Any?> = emptyMap()) {
    val payload = JSONObject()
    payload.put("type", type)
    payload.put("id", id ?: JSONObject.NULL)
    payload.put("clock", "SystemClock.uptimeMillis")
    payload.put("uptimeMs", SystemClock.uptimeMillis())
    payload.put("mainThread", Looper.myLooper() == Looper.getMainLooper())
    fields.forEach { (key, value) -> payload.put(key, value ?: JSONObject.NULL) }
    Log.i("R5Native", payload.toString())
  }

  private fun observe(views: Map<String, View>) {
    val run = views.entries.firstOrNull { it.key.startsWith("r5-run:") }
    if (run == null) { marker = null; id = null; return }
    if (marker !== run.value) {
      marker = run.value
      id = run.key.removePrefix("r5-run:")
      stationaryAt = null
      firstMovingAt = null
      sawDetails = false
      sawReplacement = false
      sawSourceRemoval = false
      emit("RUN_TREE_OBSERVED")
    }
    val now = SystemClock.uptimeMillis()
    val source = views["r5-source-page"]
    val destination = views["r5-destination-page"]
    if (source != null && destination != null && firstMovingAt == null) {
      if (source.translationX == 0f) stationaryAt = now
      else if (source.translationX < 0f) {
        firstMovingAt = now
        emit("FIRST_MOVING_FRAME", mapOf(
          "lastStationaryUptimeMs" to stationaryAt,
          "firstMovingUptimeMs" to now,
          "sourceTranslationX" to source.translationX,
          "destinationTranslationX" to destination.translationX,
        ))
      }
    }
    if (views.containsKey("r5-source-details")) sawDetails = true
    if (sawDetails && !sawReplacement && !views.containsKey("r5-source-details") &&
        views["r5-departure"]?.isAttachedToWindow == true) {
      sawReplacement = true
      emit("NATIVE_REPLACEMENT_OBSERVED", mapOf("observedUptimeMs" to now))
    }
    if (sawReplacement && !sawSourceRemoval && source == null) {
      sawSourceRemoval = true
      emit("SOURCE_PAGE_REMOVED", mapOf("observedUptimeMs" to now))
    }
  }

  override fun onPreDraw(): Boolean {
    observe(tree())
    return true
  }

  fun permissionRequest(permissions: Array<String>, code: Int, caller: String?) {
    val entry = SystemClock.uptimeMillis()
    if (Looper.myLooper() != Looper.getMainLooper()) {
      emit("PERMISSION_ACTIVITY_ENTRY_OFF_MAIN", mapOf("entryUptimeMs" to entry))
      return
    }
    val views = tree()
    // Do not promote this synchronous snapshot to a first moving pre-draw frame.
    if (id == null || views.none { it.key == "r5-run:$id" }) return
    val source = views["r5-source-page"]
    emit("PERMISSION_ACTIVITY_ENTRY", mapOf(
      "entryUptimeMs" to entry,
      "snapshotUptimeMs" to SystemClock.uptimeMillis(),
      "permissions" to permissions.joinToString(","),
      "requestCode" to code,
      "caller" to caller,
      "lastStationaryUptimeMs" to stationaryAt,
      "firstMovingUptimeMs" to firstMovingAt,
      "delayFromFirstMovingMs" to firstMovingAt?.let { entry - it },
      "delayFromLastStationaryMs" to stationaryAt?.let { entry - it },
      "sourceAttached" to (source?.isAttachedToWindow == true),
      "destinationAttached" to (views["r5-destination-page"]?.isAttachedToWindow == true),
      "detailsPresent" to views.containsKey("r5-source-details"),
      "departureAttached" to (views["r5-departure"]?.isAttachedToWindow == true),
      "sourceTranslationX" to source?.translationX,
      "destinationTranslationX" to views["r5-destination-page"]?.translationX,
      "sourceWidthPx" to source?.width,
      "replacementPreviouslyObserved" to sawReplacement,
    ))
  }
}
