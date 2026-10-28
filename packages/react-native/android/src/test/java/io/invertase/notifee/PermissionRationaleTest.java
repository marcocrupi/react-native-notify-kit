package io.invertase.notifee;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import android.Manifest;
import android.app.Activity;
import android.os.Build;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/** Bridge behavior only: mocked platform recommendations are not Android dialog evidence. */
@RunWith(RobolectricTestRunner.class)
@Config(
    manifest = Config.NONE,
    sdk = {24, 32, 33, 36})
public class PermissionRationaleTest {
  private ReactApplicationContext context;
  private Activity activity;
  private NotifeeApiModule module;
  private Promise promise;

  @Before
  public void setUp() {
    context = mock(ReactApplicationContext.class);
    activity = mock(Activity.class);
    when(context.getCurrentActivity()).thenReturn(activity);
    module = new NotifeeApiModule(context);
    promise = mock(Promise.class);
  }

  private void query(Promise target) throws Exception {
    module.shouldShowRequestPermissionRationale(target);
  }

  @Test
  public void returnsCurrentPlatformRecommendationWithoutOtherActivityCalls() throws Exception {
    when(activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))
        .thenReturn(true, false, true);
    for (boolean platformValue : new boolean[] {true, false, true}) {
      Promise result = mock(Promise.class);
      query(result);
      verify(result).resolve(Build.VERSION.SDK_INT < 33 ? false : platformValue);
      verifyNoMoreInteractions(result);
    }
    if (Build.VERSION.SDK_INT >= 33) {
      verify(activity, times(3))
          .shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS);
    }
    verifyNoMoreInteractions(activity);
  }

  @Test
  public void missingActivityIsUnavailableOn33AndNotApplicableBefore33() throws Exception {
    when(context.getCurrentActivity()).thenReturn(null);
    query(promise);
    if (Build.VERSION.SDK_INT >= 33) {
      verify(promise)
          .reject(
              "ERR_NO_ACTIVITY",
              "A current Activity is required to query notification permission rationale.");
    } else {
      verify(promise).resolve(false);
    }
    verifyNoMoreInteractions(promise);
    verifyNoInteractions(activity);
  }

  @Test
  public void nativeFailureRejectsRatherThanInventingANegativeRecommendation() throws Exception {
    RuntimeException failure = new SecurityException("platform query failed");
    when(activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))
        .thenThrow(failure);
    query(promise);
    if (Build.VERSION.SDK_INT >= 33) {
      verify(promise).reject(failure);
    } else {
      verify(promise).resolve(false);
    }
    verifyNoMoreInteractions(promise);
  }

  @Test
  public void activityLookupFailureRejectsAndALaterQueryCanRecover() throws Exception {
    SecurityException failure = new SecurityException("Activity lookup failed");
    when(context.getCurrentActivity()).thenThrow(failure).thenReturn(activity);
    query(promise);
    if (Build.VERSION.SDK_INT >= 33) {
      verify(promise).reject(failure);
    } else {
      verify(promise).resolve(false);
    }
    Promise recovered = mock(Promise.class);
    query(recovered);
    verify(recovered).resolve(false);
    verifyNoMoreInteractions(promise, recovered);
  }

  @Test
  public void doesNotConsultOrMutateCorePermissionHistory() throws Exception {
    try (org.mockito.MockedStatic<app.notifee.core.Notifee> core =
        mockStatic(app.notifee.core.Notifee.class)) {
      query(promise);
      core.verifyNoInteractions();
    }
  }

  @Test
  public void currentActivityIsLookedUpAgainAfterLifecycleChange() throws Exception {
    when(activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))
        .thenReturn(true);
    query(promise);
    when(context.getCurrentActivity()).thenReturn(null);
    Promise unavailable = mock(Promise.class);
    query(unavailable);
    Activity replacement = mock(Activity.class);
    when(context.getCurrentActivity()).thenReturn(replacement);
    Promise refreshed = mock(Promise.class);
    query(refreshed);
    verify(refreshed).resolve(false);
    if (Build.VERSION.SDK_INT >= 33) {
      verify(promise).resolve(true);
      verify(unavailable)
          .reject(
              "ERR_NO_ACTIVITY",
              "A current Activity is required to query notification permission rationale.");
      verify(replacement)
          .shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS);
    } else {
      verify(promise).resolve(false);
      verify(unavailable).resolve(false);
    }
  }
}
