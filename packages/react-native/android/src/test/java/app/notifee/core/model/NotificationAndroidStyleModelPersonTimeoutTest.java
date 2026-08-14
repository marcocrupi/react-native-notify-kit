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
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.os.Bundle;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import com.google.common.util.concurrent.ForwardingListeningExecutorService;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.ListeningExecutorService;
import com.google.common.util.concurrent.MoreExecutors;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

/**
 * Regression tests for the messaging style's person lookups.
 *
 * <p>{@code getMessagingStyleTask} awaits each person with a timed {@code get()}. That deadline is
 * unreachable through a slow network — {@code getPerson} bounds its own icon fetch and degrades to
 * an icon-less person — so it expires only when the process stopped being scheduled mid-fetch, e.g.
 * under Android's cached-app freezer. Letting the resulting TimeoutException escape the callable
 * fails the whole notification, so the user loses the message over an avatar.
 *
 * <p>{@link TimingOutPersonExecutor} simulates that by handing back a person future whose timed get
 * always times out.
 */
@RunWith(RobolectricTestRunner.class)
public class NotificationAndroidStyleModelPersonTimeoutTest {

  private static final int STYLE_TYPE_MESSAGING = 3;

  @Test
  public void messagingStyle_personTimesOut_stillBuildsTheStyle() throws Exception {
    NotificationAndroidStyleModel model =
        NotificationAndroidStyleModel.fromBundle(messagingStyleBundle());

    NotificationCompat.Style style = model.getStyleTask(new TimingOutPersonExecutor()).get();

    assertTrue(style instanceof NotificationCompat.MessagingStyle);
  }

  @Test
  public void messagingStyle_personTimesOut_keepsEverythingButTheIcon() throws Exception {
    NotificationAndroidStyleModel model =
        NotificationAndroidStyleModel.fromBundle(messagingStyleBundle());

    NotificationCompat.MessagingStyle style =
        (NotificationCompat.MessagingStyle) model.getStyleTask(new TimingOutPersonExecutor()).get();

    Person user = style.getUser();
    assertEquals("Me", user.getName());
    assertEquals("viewer-1", user.getKey());
    assertEquals("mailto:me@example.com", user.getUri());
    assertNull(user.getIcon());
  }

  /** A dropped sender name would cost message attribution, a worse loss than the avatar. */
  @Test
  public void messagingStyle_messagePersonTimesOut_keepsTheSenderName() throws Exception {
    NotificationAndroidStyleModel model =
        NotificationAndroidStyleModel.fromBundle(messagingStyleBundle());

    NotificationCompat.MessagingStyle style =
        (NotificationCompat.MessagingStyle) model.getStyleTask(new TimingOutPersonExecutor()).get();

    List<NotificationCompat.MessagingStyle.Message> messages = style.getMessages();
    assertEquals(1, messages.size());
    assertEquals("hello", messages.get(0).getText().toString());
    assertEquals("Alice", messages.get(0).getPerson().getName());
    assertNull(messages.get(0).getPerson().getIcon());
  }

  /** Guards the builder shared by the normal and timed-out paths. */
  @Test
  public void messagingStyle_personResolves_mapsEveryBundleField() throws Exception {
    NotificationAndroidStyleModel model =
        NotificationAndroidStyleModel.fromBundle(messagingStyleBundle());

    NotificationCompat.MessagingStyle style =
        (NotificationCompat.MessagingStyle)
            model.getStyleTask(MoreExecutors.newDirectExecutorService()).get();

    Person user = style.getUser();
    assertEquals("Me", user.getName());
    assertEquals("viewer-1", user.getKey());
    assertEquals("mailto:me@example.com", user.getUri());
    assertTrue(user.isImportant());
    assertEquals("Room", style.getConversationTitle().toString());
    assertEquals("Alice", style.getMessages().get(0).getPerson().getName());
  }

  private static Bundle messagingStyleBundle() {
    Bundle message = new Bundle();
    message.putString("text", "hello");
    message.putLong("timestamp", 1_700_000_000_000L);
    message.putBundle("person", personBundle("Alice", "alice-1"));

    ArrayList<Bundle> messages = new ArrayList<>();
    messages.add(message);

    Bundle styleBundle = new Bundle();
    styleBundle.putInt("type", STYLE_TYPE_MESSAGING);
    styleBundle.putString("title", "Room");
    styleBundle.putBoolean("group", true);
    styleBundle.putBundle("person", personBundle("Me", "viewer-1"));
    styleBundle.putParcelableArrayList("messages", messages);
    return styleBundle;
  }

  /** No "icon" key, so the resolving path does no image fetch either. */
  private static Bundle personBundle(String name, String id) {
    Bundle person = new Bundle();
    person.putString("name", name);
    person.putString("id", id);
    person.putBoolean("important", true);
    person.putString("uri", name.equals("Me") ? "mailto:me@example.com" : "mailto:a@example.com");
    return person;
  }

  /**
   * Runs the style task inline, but every person submitted from inside it comes back as a future
   * whose timed get times out — what the caller observes when the process was frozen mid-fetch.
   */
  private static final class TimingOutPersonExecutor extends ForwardingListeningExecutorService {
    private final ListeningExecutorService delegate = MoreExecutors.newDirectExecutorService();
    private boolean styleTaskSubmitted = false;

    @Override
    protected ListeningExecutorService delegate() {
      return delegate;
    }

    @Override
    public <T> ListenableFuture<T> submit(Callable<T> task) {
      if (styleTaskSubmitted) {
        return timesOut();
      }
      styleTaskSubmitted = true;
      return delegate.submit(task);
    }

    private static <T> ListenableFuture<T> timesOut() {
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
        public T get(long timeout, TimeUnit unit) throws TimeoutException {
          throw new TimeoutException("simulated frozen process");
        }
      };
    }
  }
}
