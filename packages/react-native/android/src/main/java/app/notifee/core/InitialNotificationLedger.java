package app.notifee.core;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import androidx.annotation.Nullable;
import androidx.annotation.VisibleForTesting;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/**
 * Durable record of the interactions returned by {@link Notifee#getInitialNotification}, so each
 * one is returned at most once, also when its Activity is recreated in a new process (#88).
 *
 * <p>Taps of {@link NotificationPendingIntent} launch flows are numbered by {@link
 * NotificationReceiverHandler}. The number travels with the sticky {@code InitialNotificationEvent}
 * and is stored with the id of the tapped PendingIntent; like the sticky event, only the latest tap
 * is kept. The sticky event and the launch Intent of a tap claim the same number, so the tap is
 * returned by whichever is read first. A launch Intent can only claim the latest tap of its own
 * PendingIntent, which it gets once the sticky event has been lost with the process that received
 * it.
 *
 * <p>Full-screen Intents have no receiver: each display issues its own id, recorded as unclaimed
 * before the notification is posted. A claim removes the id, so an id already returned, or never
 * issued, is not returned, however many launches follow. Ids issued before the device last rebooted
 * are dropped when the next id is issued, as no Intent extras survive a reboot.
 *
 * <p>Claims are committed before the interaction is returned.
 */
final class InitialNotificationLedger {
  private static final String TAG = "InitialNotificationLedger";
  private static final String PREFERENCES_FILE = "app.notifee.core.initial_notification";
  private static final String LAST_TAP_SEQUENCE_KEY = "last_tap_sequence";
  private static final String LAST_TAP_PENDING_INTENT_ID_KEY = "last_tap_pending_intent_id";
  private static final String CLAIMED_TAP_SEQUENCE_KEY = "claimed_tap_sequence";
  private static final String UNCLAIMED_FULL_SCREEN_IDS_KEY = "unclaimed_full_screen_ids";
  private static final String FULL_SCREEN_ISSUE_UPTIME_KEY = "full_screen_issue_uptime";

  private static final Object lock = new Object();

  private InitialNotificationLedger() {}

  /**
   * Records a tap before its sticky event is posted.
   *
   * @return the tap's sequence number, or 0 if it was not recorded (the tap is then returned by its
   *     sticky event only).
   */
  static long recordTap(@Nullable String pendingIntentId) {
    synchronized (lock) {
      try {
        SharedPreferences preferences = getPreferences();
        long sequence = preferences.getLong(LAST_TAP_SEQUENCE_KEY, 0) + 1;
        // Main thread, so not committed: a record lost with the process only means the tap cannot
        // be recovered from its launch Intent; it is never returned twice.
        preferences
            .edit()
            .putLong(LAST_TAP_SEQUENCE_KEY, sequence)
            .putString(LAST_TAP_PENDING_INTENT_ID_KEY, pendingIntentId)
            .apply();
        return sequence;
      } catch (Exception e) {
        Logger.e(TAG, "Failed to record notification tap", e);
        return 0;
      }
    }
  }

  /**
   * Claims the tap of a sticky event.
   *
   * @return false if the tap was already returned through its launch Intent.
   */
  static boolean claimTap(long tapSequence) {
    if (tapSequence <= 0) {
      return true;
    }

    synchronized (lock) {
      try {
        SharedPreferences preferences = getPreferences();
        if (tapSequence <= preferences.getLong(CLAIMED_TAP_SEQUENCE_KEY, 0)) {
          return false;
        }
        commit(preferences.edit().putLong(CLAIMED_TAP_SEQUENCE_KEY, tapSequence));
      } catch (Exception e) {
        Logger.e(TAG, "Failed to claim notification tap", e);
      }
      return true;
    }
  }

  /** Claims the latest tap for a launch Intent of {@code pendingIntentId}, if not returned yet. */
  static boolean claimLatestTap(String pendingIntentId) {
    synchronized (lock) {
      try {
        SharedPreferences preferences = getPreferences();
        long latest = preferences.getLong(LAST_TAP_SEQUENCE_KEY, 0);
        if (latest <= preferences.getLong(CLAIMED_TAP_SEQUENCE_KEY, 0)
            || !pendingIntentId.equals(
                preferences.getString(LAST_TAP_PENDING_INTENT_ID_KEY, null))) {
          return false;
        }
        commit(preferences.edit().putLong(CLAIMED_TAP_SEQUENCE_KEY, latest));
        return true;
      } catch (Exception e) {
        Logger.e(TAG, "Failed to claim notification tap", e);
        return false;
      }
    }
  }

  /**
   * Issues the id of a full-screen launch Intent and records it as unclaimed, before the
   * notification is posted.
   *
   * @return the id; one that could not be recorded is never claimed.
   */
  static String issueFullScreenLaunchId() {
    String id = UUID.randomUUID().toString();
    synchronized (lock) {
      try {
        SharedPreferences preferences = getPreferences();
        long uptime = SystemClock.elapsedRealtime();
        Set<String> unclaimed = new HashSet<>();
        // Uptime restarts at boot: below the uptime of the last issue, every id issued so far
        // predates a reboot.
        if (uptime >= preferences.getLong(FULL_SCREEN_ISSUE_UPTIME_KEY, 0)) {
          unclaimed.addAll(
              preferences.getStringSet(UNCLAIMED_FULL_SCREEN_IDS_KEY, Collections.emptySet()));
        }
        unclaimed.add(id);
        if (!preferences
            .edit()
            .putStringSet(UNCLAIMED_FULL_SCREEN_IDS_KEY, unclaimed)
            .putLong(FULL_SCREEN_ISSUE_UPTIME_KEY, uptime)
            .commit()) {
          // The id is claimable in this process only.
          Logger.w(TAG, "Failed to persist full-screen launch");
        }
      } catch (Exception e) {
        Logger.e(TAG, "Failed to record full-screen launch", e);
      }
    }
    return id;
  }

  /** Claims a full-screen launch, if its id was issued and not returned yet. */
  static boolean claimFullScreenLaunch(String pendingIntentId) {
    synchronized (lock) {
      try {
        SharedPreferences preferences = getPreferences();
        Set<String> unclaimed =
            preferences.getStringSet(UNCLAIMED_FULL_SCREEN_IDS_KEY, Collections.emptySet());
        if (!unclaimed.contains(pendingIntentId)) {
          return false;
        }

        Set<String> remaining = new HashSet<>(unclaimed);
        remaining.remove(pendingIntentId);
        if (preferences.edit().putStringSet(UNCLAIMED_FULL_SCREEN_IDS_KEY, remaining).commit()) {
          return true;
        }
        // A claim missing from disk could be returned again by a later process. The failed edit
        // still removed the id in memory: put it back so that a later call can claim it.
        preferences
            .edit()
            .putStringSet(UNCLAIMED_FULL_SCREEN_IDS_KEY, new HashSet<>(unclaimed))
            .apply();
        Logger.w(TAG, "Failed to persist full-screen launch claim");
        return false;
      } catch (Exception e) {
        Logger.e(TAG, "Failed to claim full-screen launch", e);
        return false;
      }
    }
  }

  @VisibleForTesting
  static int unclaimedFullScreenLaunchCountForTesting() {
    synchronized (lock) {
      return getPreferences()
          .getStringSet(UNCLAIMED_FULL_SCREEN_IDS_KEY, Collections.emptySet())
          .size();
    }
  }

  @VisibleForTesting
  static void clearForTesting() {
    synchronized (lock) {
      commit(getPreferences().edit().clear());
    }
  }

  private static void commit(SharedPreferences.Editor editor) {
    // The claim already holds in memory; only a later process could return it again.
    if (!editor.commit()) {
      Logger.w(TAG, "Failed to persist initial notification claim");
    }
  }

  private static SharedPreferences getPreferences() {
    return ContextHolder.getApplicationContext()
        .getSharedPreferences(PREFERENCES_FILE, Context.MODE_PRIVATE);
  }
}
