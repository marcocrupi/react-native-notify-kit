package app.notifee.core.model;

/*
 * Copyright (c) 2016-present Invertase Limited & Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this library except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.mockStatic;

import android.graphics.Bitmap;
import android.os.Bundle;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;
import app.notifee.core.utility.ResourceUtils;
import com.google.common.util.concurrent.ForwardingListeningExecutorService;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.ListeningExecutorService;
import com.google.common.util.concurrent.MoreExecutors;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.robolectric.RobolectricTestRunner;

/**
 * Regression tests for the messaging style's person lookups.
 *
 * <p>The person task has a shorter icon timeout, but scheduling delays, process suspension, or
 * other stalls can still exhaust the outer timed wait. {@link PersonFutureFailureExecutor} models
 * outer-wait outcomes deterministically; it does not reproduce or identify their runtime cause.
 */
@RunWith(RobolectricTestRunner.class)
public class NotificationAndroidStyleModelPersonFailureTest {

  private static final int STYLE_TYPE_MESSAGING = 3;
  private static final int USER_PERSON_INDEX = 0;
  private static final int MESSAGE_PERSON_INDEX = 1;
  private static final String USER_ICON_URL = "https://example.invalid/user.png";

  @Test
  public void messagingStyle_userPersonTimesOut_keepsEverythingButTheIcon() throws Exception {
    NotificationAndroidStyleModel model =
        NotificationAndroidStyleModel.fromBundle(messagingStyleBundle(USER_ICON_URL, null));

    NotificationCompat.Style resolvedStyle =
        model.getStyleTask(timesOutAt(USER_PERSON_INDEX)).get();

    assertTrue(resolvedStyle instanceof NotificationCompat.MessagingStyle);
    NotificationCompat.MessagingStyle style = (NotificationCompat.MessagingStyle) resolvedStyle;
    Person user = style.getUser();
    assertPersonFields(user, "Me", "viewer-1", "mailto:me@example.com");
    assertNull(user.getIcon());
  }

  @Test
  public void messagingStyle_messagePersonTimesOut_keepsEveryFieldButTheIcon() throws Exception {
    NotificationAndroidStyleModel model =
        NotificationAndroidStyleModel.fromBundle(messagingStyleBundle(null, USER_ICON_URL));

    NotificationCompat.Style resolvedStyle =
        model.getStyleTask(timesOutAt(MESSAGE_PERSON_INDEX)).get();

    assertTrue(resolvedStyle instanceof NotificationCompat.MessagingStyle);
    NotificationCompat.MessagingStyle style = (NotificationCompat.MessagingStyle) resolvedStyle;
    List<NotificationCompat.MessagingStyle.Message> messages = style.getMessages();
    assertEquals(1, messages.size());
    assertEquals("hello", messages.get(0).getText().toString());
    Person messagePerson = messages.get(0).getPerson();
    assertPersonFields(messagePerson, "Alice", "alice-1", "mailto:a@example.com");
    assertNull(messagePerson.getIcon());
  }

  @Test
  public void messagingStyle_iconFutureFails_keepsEverythingButTheIcon() throws Exception {
    IllegalStateException iconFailure = new IllegalStateException("simulated icon load failure");
    NotificationAndroidStyleModel model =
        NotificationAndroidStyleModel.fromBundle(messagingStyleBundle(USER_ICON_URL, null));

    try (MockedStatic<ResourceUtils> resourceUtils = mockStatic(ResourceUtils.class)) {
      resourceUtils
          .when(() -> ResourceUtils.getImageBitmapFromUrl(USER_ICON_URL))
          .thenReturn(Futures.immediateFailedFuture(iconFailure));

      NotificationCompat.MessagingStyle style =
          (NotificationCompat.MessagingStyle)
              model.getStyleTask(MoreExecutors.newDirectExecutorService()).get();

      Person user = style.getUser();
      assertPersonFields(user, "Me", "viewer-1", "mailto:me@example.com");
      assertNull(user.getIcon());
    }
  }

  @Test
  public void messagingStyle_unexpectedPersonFailure_propagates() {
    IllegalStateException unexpectedFailure =
        new IllegalStateException("simulated unexpected person task failure");
    NotificationAndroidStyleModel model =
        NotificationAndroidStyleModel.fromBundle(messagingStyleBundle());

    ExecutionException failure =
        assertThrows(
            ExecutionException.class,
            () ->
                model
                    .getStyleTask(failsUnexpectedlyAt(USER_PERSON_INDEX, unexpectedFailure))
                    .get());

    assertTrue(failure.getCause() instanceof ExecutionException);
    assertSame(unexpectedFailure, failure.getCause().getCause());
  }

  @Test
  public void messagingStyle_outerPersonWaitIsInterrupted_propagates() {
    InterruptedException interruption = new InterruptedException("simulated outer interruption");
    NotificationAndroidStyleModel model =
        NotificationAndroidStyleModel.fromBundle(messagingStyleBundle());

    ExecutionException failure =
        assertThrows(
            ExecutionException.class,
            () -> model.getStyleTask(interruptedAt(USER_PERSON_INDEX, interruption)).get());

    assertSame(interruption, failure.getCause());
  }

  @Test
  public void messagingStyle_personIconResolves_mapsEveryBundleField() throws Exception {
    Bitmap iconBitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888);
    NotificationAndroidStyleModel model =
        NotificationAndroidStyleModel.fromBundle(messagingStyleBundle(USER_ICON_URL, null));

    try (MockedStatic<ResourceUtils> resourceUtils = mockStatic(ResourceUtils.class)) {
      resourceUtils
          .when(() -> ResourceUtils.getImageBitmapFromUrl(USER_ICON_URL))
          .thenReturn(Futures.immediateFuture(iconBitmap));

      NotificationCompat.MessagingStyle style =
          (NotificationCompat.MessagingStyle)
              model.getStyleTask(MoreExecutors.newDirectExecutorService()).get();

      Person user = style.getUser();
      assertPersonFields(user, "Me", "viewer-1", "mailto:me@example.com");
      assertNotNull(user.getIcon());
      assertEquals(IconCompat.TYPE_ADAPTIVE_BITMAP, user.getIcon().getType());
      assertEquals("Room", style.getConversationTitle().toString());
      assertTrue(style.isGroupConversation());
      assertEquals("Alice", style.getMessages().get(0).getPerson().getName());
    } finally {
      iconBitmap.recycle();
    }
  }

  private static Bundle messagingStyleBundle() {
    return messagingStyleBundle(null, null);
  }

  private static Bundle messagingStyleBundle(String userIcon, String messageIcon) {
    Bundle messagePerson = personBundle("Alice", "alice-1");
    if (messageIcon != null) {
      messagePerson.putString("icon", messageIcon);
    }

    Bundle message = new Bundle();
    message.putString("text", "hello");
    message.putLong("timestamp", 1_700_000_000_000L);
    message.putBundle("person", messagePerson);

    ArrayList<Bundle> messages = new ArrayList<>();
    messages.add(message);

    Bundle user = personBundle("Me", "viewer-1");
    if (userIcon != null) {
      user.putString("icon", userIcon);
    }

    Bundle styleBundle = new Bundle();
    styleBundle.putInt("type", STYLE_TYPE_MESSAGING);
    styleBundle.putString("title", "Room");
    styleBundle.putBoolean("group", true);
    styleBundle.putBundle("person", user);
    styleBundle.putParcelableArrayList("messages", messages);
    return styleBundle;
  }

  private static Bundle personBundle(String name, String id) {
    Bundle person = new Bundle();
    person.putString("name", name);
    person.putString("id", id);
    person.putBoolean("important", true);
    person.putBoolean("bot", true);
    person.putString("uri", name.equals("Me") ? "mailto:me@example.com" : "mailto:a@example.com");
    return person;
  }

  private static void assertPersonFields(Person person, String name, String key, String uri) {
    assertEquals(name, person.getName());
    assertEquals(key, person.getKey());
    assertEquals(uri, person.getUri());
    assertTrue(person.isImportant());
    assertTrue(person.isBot());
  }

  private interface PersonFailure {
    void raise() throws InterruptedException, ExecutionException, TimeoutException;
  }

  private static PersonFutureFailureExecutor timesOutAt(int personIndex) {
    return new PersonFutureFailureExecutor(
        personIndex,
        () -> {
          throw new TimeoutException("simulated person task stall");
        });
  }

  private static PersonFutureFailureExecutor interruptedAt(
      int personIndex, InterruptedException interruption) {
    return new PersonFutureFailureExecutor(
        personIndex,
        () -> {
          throw interruption;
        });
  }

  private static PersonFutureFailureExecutor failsUnexpectedlyAt(
      int personIndex, RuntimeException failure) {
    return new PersonFutureFailureExecutor(
        personIndex,
        () -> {
          throw new ExecutionException(failure);
        });
  }

  /**
   * Runs the style task and non-target person tasks inline, but makes one indexed person future
   * fail when its outer timed wait is invoked.
   */
  private static final class PersonFutureFailureExecutor
      extends ForwardingListeningExecutorService {
    private final ListeningExecutorService delegate = MoreExecutors.newDirectExecutorService();
    private final int failingPersonIndex;
    private final PersonFailure failure;
    private boolean styleTaskSubmitted = false;
    private int personTaskCount = 0;

    PersonFutureFailureExecutor(int failingPersonIndex, PersonFailure failure) {
      this.failingPersonIndex = failingPersonIndex;
      this.failure = failure;
    }

    @Override
    protected ListeningExecutorService delegate() {
      return delegate;
    }

    @Override
    public <T> ListenableFuture<T> submit(Callable<T> task) {
      if (!styleTaskSubmitted) {
        styleTaskSubmitted = true;
        return runImmediately(task);
      }

      if (personTaskCount++ == failingPersonIndex) {
        return failingFuture();
      }

      return runImmediately(task);
    }

    private static <T> ListenableFuture<T> runImmediately(Callable<T> task) {
      try {
        return Futures.immediateFuture(task.call());
      } catch (Exception e) {
        return Futures.immediateFailedFuture(e);
      }
    }

    private <T> ListenableFuture<T> failingFuture() {
      return new ListenableFuture<T>() {
        @Override
        public void addListener(Runnable listener, Executor executor) {}

        @Override
        public boolean cancel(boolean mayInterruptIfRunning) {
          return false;
        }

        @Override
        public boolean isCancelled() {
          return false;
        }

        @Override
        public boolean isDone() {
          return false;
        }

        @Override
        public T get() {
          throw new UnsupportedOperationException("the style awaits persons with a timeout");
        }

        @Override
        public T get(long timeout, TimeUnit unit)
            throws InterruptedException, ExecutionException, TimeoutException {
          failure.raise();
          throw new AssertionError("unreachable");
        }
      };
    }
  }
}
