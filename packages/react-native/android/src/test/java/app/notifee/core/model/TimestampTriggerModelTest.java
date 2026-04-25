package app.notifee.core.model;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.os.Bundle;
import java.util.Calendar;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public class TimestampTriggerModelTest {
  private static final long ONE_MINUTE_MS = 60L * 1000L;
  private static final long ONE_HOUR_MS = 60L * 60L * 1000L;
  private static final long ONE_DAY_MS = 24L * ONE_HOUR_MS;

  private static final int REPEAT_FREQUENCY_HOURLY = 0;
  private static final int REPEAT_FREQUENCY_DAILY = 1;
  private static final int REPEAT_FREQUENCY_WEEKLY = 2;
  private static final int REPEAT_FREQUENCY_MONTHLY = 3;

  private TimestampTriggerModel mTimestampTriggerModel = null;
  private TimeZone mOriginalTimeZone;
  private long mNow;

  @Before
  public void before() {
    mOriginalTimeZone = TimeZone.getDefault();
    mNow = System.currentTimeMillis();

    Bundle trigger = new Bundle();
    Bundle triggerComponents = new Bundle();
    triggerComponents.putInt("minute", 1);
    triggerComponents.putInt("hour", 1);
    triggerComponents.putInt("day", 1);
    triggerComponents.putInt("month", 12);
    triggerComponents.putInt("weekday", 3);
    triggerComponents.putInt("weekdayOrdinal", 2);
    triggerComponents.putInt("weekOfYear", 24);
    triggerComponents.putInt("weekOfMonth", 2);

    trigger.putBundle("components", triggerComponents);
    mTimestampTriggerModel = TimestampTriggerModel.fromBundle(trigger);
  }

  @After
  public void after() {
    TimeZone.setDefault(mOriginalTimeZone);
  }

  @Test
  public void testBundleValues() {
    assertEquals(
        "with no 'repeatFrequency', interval should be -1",
        -1,
        mTimestampTriggerModel.getInterval());
    assertNull(
        "with no 'repeatFrequency', TimeUnit should be null", mTimestampTriggerModel.getTimeUnit());
    assertEquals(
        "with no 'repeatFrequency', delay should be 0", 0, mTimestampTriggerModel.getDelay());
  }

  // Regression tests for the DAILY/WEEKLY/HOURLY rescheduling cycle. Guard the fix for
  // upstream invertase/notifee#839 (DAILY trigger fails to re-fire from day 2 onwards on
  // Android) and #875 (DST-safe Calendar.add for repeat frequency) against future refactors
  // of TimestampTriggerModel.setNextTimestamp().

  private TimestampTriggerModel buildRepeatingTrigger(long timestamp, int repeatFrequency) {
    Bundle trigger = new Bundle();
    trigger.putLong("timestamp", timestamp);
    trigger.putInt("repeatFrequency", repeatFrequency);
    return TimestampTriggerModel.fromBundle(trigger);
  }

  private TimestampTriggerModel buildRepeatingTrigger(
      long timestamp, int repeatFrequency, int repeatInterval) {
    Bundle trigger = new Bundle();
    trigger.putLong("timestamp", timestamp);
    trigger.putInt("repeatFrequency", repeatFrequency);
    trigger.putInt("repeatInterval", repeatInterval);
    return TimestampTriggerModel.fromBundle(trigger);
  }

  private long expectedNextTimestamp(long timestamp, int field, int repeatInterval) {
    Calendar cal = Calendar.getInstance();
    cal.setTimeInMillis(timestamp);
    while (cal.getTimeInMillis() < System.currentTimeMillis()) {
      cal.add(field, repeatInterval);
    }
    return cal.getTimeInMillis();
  }

  @Test
  public void repeatingTrigger_withoutRepeatInterval_defaultsToOne() {
    TimestampTriggerModel trigger =
        buildRepeatingTrigger(mNow + ONE_DAY_MS, REPEAT_FREQUENCY_DAILY);

    assertEquals("daily repeat interval should default to 1 day", 1, trigger.getInterval());
    assertEquals("daily repeat time unit should be days", TimeUnit.DAYS, trigger.getTimeUnit());
  }

  @Test
  public void repeatingTrigger_invalidNativeRepeatInterval_fallsBackToOne() {
    TimestampTriggerModel trigger =
        buildRepeatingTrigger(mNow + ONE_DAY_MS, REPEAT_FREQUENCY_DAILY, 0);

    assertEquals("invalid native repeatInterval should fall back to 1", 1, trigger.getInterval());
    assertEquals(TimeUnit.DAYS, trigger.getTimeUnit());
  }

  @Test
  public void setNextTimestamp_daily_advancesToTomorrowSameWallClock() {
    long original = mNow - ONE_MINUTE_MS;
    TimestampTriggerModel trigger = buildRepeatingTrigger(original, REPEAT_FREQUENCY_DAILY);

    Calendar originalCal = Calendar.getInstance();
    originalCal.setTimeInMillis(original);
    int originalHour = originalCal.get(Calendar.HOUR_OF_DAY);
    int originalMinute = originalCal.get(Calendar.MINUTE);
    int originalSecond = originalCal.get(Calendar.SECOND);

    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    assertTrue("next timestamp must be in the future", next > mNow);
    assertTrue("next timestamp must be within 25h", next < mNow + 25L * ONE_HOUR_MS);

    Calendar nextCal = Calendar.getInstance();
    nextCal.setTimeInMillis(next);
    assertEquals("wall-clock hour preserved", originalHour, nextCal.get(Calendar.HOUR_OF_DAY));
    assertEquals("wall-clock minute preserved", originalMinute, nextCal.get(Calendar.MINUTE));
    assertEquals("wall-clock second preserved", originalSecond, nextCal.get(Calendar.SECOND));
  }

  @Test
  public void setNextTimestamp_dailyEveryTwoDays_advancesByRepeatInterval() {
    long original = mNow - ONE_MINUTE_MS;
    TimestampTriggerModel trigger =
        buildRepeatingTrigger(original, REPEAT_FREQUENCY_DAILY, 2);

    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    assertEquals(
        "daily repeatInterval=2 should use Calendar.add(DAY_OF_MONTH, 2)",
        expectedNextTimestamp(original, Calendar.DAY_OF_MONTH, 2),
        next);
    assertEquals("WorkManager interval should be 2 days", 2, trigger.getInterval());
    assertEquals("WorkManager time unit should be days", TimeUnit.DAYS, trigger.getTimeUnit());
  }

  @Test
  public void setNextTimestamp_daily_multipleMissedFires_skipsToFuture() {
    // Offset by 1 minute so the original does not land exactly on a multiple of 24h from mNow.
    // Otherwise, with a deterministic clock (e.g. Robolectric), the while-loop's `<` comparison
    // exits precisely at `cal == now` and next equals mNow, which is not strictly in the future.
    long original = mNow - 3L * ONE_DAY_MS - ONE_MINUTE_MS;
    TimestampTriggerModel trigger = buildRepeatingTrigger(original, REPEAT_FREQUENCY_DAILY);

    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    assertTrue("next timestamp must be in the future after 3 missed fires", next > mNow);
    assertTrue("next timestamp must not be more than 25h ahead", next < mNow + 25L * ONE_HOUR_MS);
  }

  @Test
  public void setNextTimestamp_weeklyEveryTwoWeeks_advancesByRepeatInterval() {
    long original = mNow - ONE_MINUTE_MS;
    TimestampTriggerModel trigger =
        buildRepeatingTrigger(original, REPEAT_FREQUENCY_WEEKLY, 2);

    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    assertEquals(
        "weekly repeatInterval=2 should use Calendar.add(WEEK_OF_YEAR, 2)",
        expectedNextTimestamp(original, Calendar.WEEK_OF_YEAR, 2),
        next);
    assertEquals("WorkManager interval should be 14 days", 14, trigger.getInterval());
    assertEquals("WorkManager time unit should be days", TimeUnit.DAYS, trigger.getTimeUnit());
  }

  @Test
  public void setNextTimestamp_weekly_advancesOneWeek() {
    long original = mNow - ONE_MINUTE_MS;
    TimestampTriggerModel trigger = buildRepeatingTrigger(original, REPEAT_FREQUENCY_WEEKLY);

    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    long lower = mNow + 6L * ONE_DAY_MS + 23L * ONE_HOUR_MS;
    long upper = mNow + 7L * ONE_DAY_MS + ONE_HOUR_MS;
    assertTrue("weekly next timestamp must be >= now + 6d23h", next >= lower);
    assertTrue("weekly next timestamp must be <= now + 7d1h", next <= upper);
  }

  @Test
  public void setNextTimestamp_monthlyEveryThreeMonths_advancesByRepeatInterval() {
    long original = mNow - ONE_MINUTE_MS;
    TimestampTriggerModel trigger =
        buildRepeatingTrigger(original, REPEAT_FREQUENCY_MONTHLY, 3);

    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    assertEquals(
        "monthly repeatInterval=3 should use Calendar.add(MONTH, 3)",
        expectedNextTimestamp(original, Calendar.MONTH, 3),
        next);
    assertEquals(TimestampTriggerModel.MONTHLY, trigger.getRepeatFrequency());
  }

  @Test
  public void setNextTimestamp_monthlyEndOfMonth_usesCalendarClampSemantics() {
    TimeZone utc = TimeZone.getTimeZone("UTC");
    TimeZone.setDefault(utc);

    Calendar start = Calendar.getInstance(utc);
    start.clear();
    start.set(2020, Calendar.JANUARY, 31, 12, 45, 0);
    long original = start.getTimeInMillis();

    TimestampTriggerModel trigger =
        buildRepeatingTrigger(original, REPEAT_FREQUENCY_MONTHLY, 1);

    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    assertEquals(
        "monthly end-of-month should match native Calendar.add clamp behavior",
        expectedNextTimestamp(original, Calendar.MONTH, 1),
        next);

    Calendar nextCal = Calendar.getInstance(utc);
    nextCal.setTimeInMillis(next);
    assertTrue(
        "Calendar.add should clamp the Jan 31 anchor before future monthly repeats",
        nextCal.get(Calendar.DAY_OF_MONTH) < 31);
  }

  @Test
  public void setNextTimestamp_hourly_advancesOneHour() {
    long original = mNow - ONE_MINUTE_MS;
    TimestampTriggerModel trigger = buildRepeatingTrigger(original, REPEAT_FREQUENCY_HOURLY);

    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    long lower = mNow + 59L * ONE_MINUTE_MS;
    long upper = mNow + 61L * ONE_MINUTE_MS;
    assertTrue("hourly next timestamp must be >= now + 59m", next >= lower);
    assertTrue("hourly next timestamp must be <= now + 61m", next <= upper);
  }

  @Test
  public void setNextTimestamp_dailyEveryTwoDaysAcrossDstSpringForward() {
    TimeZone rome = TimeZone.getTimeZone("Europe/Rome");
    TimeZone.setDefault(rome);

    Calendar start = Calendar.getInstance(rome);
    start.clear();
    start.set(2026, Calendar.MARCH, 28, 4, 30, 0);
    long originalTimestamp = start.getTimeInMillis();

    Calendar windowStart = Calendar.getInstance(rome);
    windowStart.clear();
    windowStart.set(2026, Calendar.MARCH, 31, 0, 0, 0);
    Calendar windowEnd = Calendar.getInstance(rome);
    windowEnd.clear();
    windowEnd.set(2026, Calendar.OCTOBER, 24, 23, 59, 59);
    long now = System.currentTimeMillis();
    Assume.assumeTrue(
        "spring-forward repeatInterval discrimination requires current time in"
            + " [2026-03-31, 2026-10-24] Europe/Rome",
        now >= windowStart.getTimeInMillis() && now <= windowEnd.getTimeInMillis());

    TimestampTriggerModel trigger =
        buildRepeatingTrigger(originalTimestamp, REPEAT_FREQUENCY_DAILY, 2);
    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    Calendar nextCal = Calendar.getInstance(rome);
    nextCal.setTimeInMillis(next);
    assertTrue("next timestamp must be >= now", next >= now);
    assertEquals(
        "wall-clock hour must remain 4 with repeatInterval=2",
        4,
        nextCal.get(Calendar.HOUR_OF_DAY));
    assertEquals("wall-clock minute must remain 30", 30, nextCal.get(Calendar.MINUTE));
    assertEquals("wall-clock second must remain 0", 0, nextCal.get(Calendar.SECOND));
  }

  @Test
  public void setNextTimestamp_dailyAcrossDstSpringForward() {
    // Europe/Rome spring-forward 2026: 2026-03-29 02:00 local jumps to 03:00 local. The 29
    // March 2026 calendar day is 23 hours long in Europe/Rome. Using 04:30 (NOT 01:30) as
    // the wall-clock: 04:30 on 2026-03-28 is CET (UTC+1), while 04:30 on 2026-03-29 is CEST
    // (UTC+2). Calendar.add(DAY_OF_MONTH, 1) preserves the local 04:30 wall-clock across the
    // boundary; a hypothetical refactor to +86_400_000 ms fixed arithmetic would drift the
    // wall-clock to 05:30 CEST on the day after the crossing. Using 01:30 would NOT
    // discriminate because 01:30 sits in the same UTC offset on both sides of the transition.
    TimeZone rome = TimeZone.getTimeZone("Europe/Rome");
    TimeZone.setDefault(rome);

    Calendar start = Calendar.getInstance(rome);
    start.clear();
    start.set(2026, Calendar.MARCH, 28, 4, 30, 0);
    long originalTimestamp = start.getTimeInMillis();

    // Assume the current wall-clock is in the post-spring-forward / pre-fall-back window for
    // 2026. Outside this window the while-loop inside setNextTimestamp either does not run
    // (future-dated start) or crosses an even number of DST boundaries whose effects cancel
    // for fixed-ms arithmetic, making the assertion non-discriminative.
    Calendar windowStart = Calendar.getInstance(rome);
    windowStart.clear();
    windowStart.set(2026, Calendar.MARCH, 30, 0, 0, 0);
    Calendar windowEnd = Calendar.getInstance(rome);
    windowEnd.clear();
    windowEnd.set(2026, Calendar.OCTOBER, 24, 23, 59, 59);
    long now = System.currentTimeMillis();
    Assume.assumeTrue(
        "spring-forward discrimination requires current time in [2026-03-30, 2026-10-24]"
            + " Europe/Rome",
        now >= windowStart.getTimeInMillis() && now <= windowEnd.getTimeInMillis());

    TimestampTriggerModel trigger =
        buildRepeatingTrigger(originalTimestamp, REPEAT_FREQUENCY_DAILY);
    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    Calendar nextCal = Calendar.getInstance(rome);
    nextCal.setTimeInMillis(next);
    assertTrue("next timestamp must be >= now", next >= now);
    assertEquals(
        "wall-clock hour must remain 4 after crossing spring-forward",
        4,
        nextCal.get(Calendar.HOUR_OF_DAY));
    assertEquals("wall-clock minute must remain 30", 30, nextCal.get(Calendar.MINUTE));
    assertEquals("wall-clock second must remain 0", 0, nextCal.get(Calendar.SECOND));
  }

  @Test
  public void setNextTimestamp_dailyAcrossDstFallBack() {
    // Europe/Rome fall-back 2025: 2025-10-26 03:00 local reverts to 02:00 local. The 26
    // October 2025 calendar day is 25 hours long. Starting at 2025-10-25 04:30 CEST (UTC+2)
    // — the day before the fall-back — the local 04:30 wall-clock on 2025-10-26 is CET
    // (UTC+1). Calendar.add preserves the 04:30 local wall-clock; +86_400_000 ms would drift
    // it to 03:30 CET after the crossing.
    TimeZone rome = TimeZone.getTimeZone("Europe/Rome");
    TimeZone.setDefault(rome);

    Calendar start = Calendar.getInstance(rome);
    start.clear();
    start.set(2025, Calendar.OCTOBER, 25, 4, 30, 0);
    long originalTimestamp = start.getTimeInMillis();

    // Assume the current wall-clock is in the post-fall-back-2025 / pre-spring-forward-2026
    // window, so the setNextTimestamp loop crosses exactly one DST boundary (the fall-back)
    // and the test remains discriminative against fixed-ms arithmetic.
    Calendar windowStart = Calendar.getInstance(rome);
    windowStart.clear();
    windowStart.set(2025, Calendar.OCTOBER, 27, 0, 0, 0);
    Calendar windowEnd = Calendar.getInstance(rome);
    windowEnd.clear();
    windowEnd.set(2026, Calendar.MARCH, 28, 23, 59, 59);
    long now = System.currentTimeMillis();
    Assume.assumeTrue(
        "fall-back discrimination requires current time in [2025-10-27, 2026-03-28] Europe/Rome",
        now >= windowStart.getTimeInMillis() && now <= windowEnd.getTimeInMillis());

    TimestampTriggerModel trigger =
        buildRepeatingTrigger(originalTimestamp, REPEAT_FREQUENCY_DAILY);
    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    Calendar nextCal = Calendar.getInstance(rome);
    nextCal.setTimeInMillis(next);
    assertTrue("next timestamp must be >= now", next >= now);
    assertEquals(
        "wall-clock hour must remain 4 after crossing fall-back",
        4,
        nextCal.get(Calendar.HOUR_OF_DAY));
    assertEquals("wall-clock minute must remain 30", 30, nextCal.get(Calendar.MINUTE));
    assertEquals("wall-clock second must remain 0", 0, nextCal.get(Calendar.SECOND));
  }
}
