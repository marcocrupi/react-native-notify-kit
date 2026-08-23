package app.notifee.core.model;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.os.Bundle;
import android.os.SystemClock;
import java.util.Calendar;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

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
  public void repeatFrequency_missingLeavesNonRepeatingDefaults() {
    assertEquals(
        "with no 'repeatFrequency', interval should be -1",
        -1,
        mTimestampTriggerModel.getInterval());
    assertNull(
        "with no 'repeatFrequency', TimeUnit should be null", mTimestampTriggerModel.getTimeUnit());
    assertNull(
        "with no 'repeatFrequency', repeat frequency should be null",
        mTimestampTriggerModel.getRepeatFrequency());
    assertEquals(
        "with no 'repeatFrequency', delay should be 0", 0, mTimestampTriggerModel.getDelay());
    assertThrows(
        "with no 'repeatFrequency', timestamp remains null",
        NullPointerException.class,
        () -> mTimestampTriggerModel.getTimestamp());
  }

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

  private Bundle buildRepeatingTriggerBundle() {
    Bundle trigger = new Bundle();
    trigger.putLong("timestamp", mNow + ONE_DAY_MS);
    trigger.putInt("repeatFrequency", REPEAT_FREQUENCY_DAILY);
    return trigger;
  }

  private TimestampTriggerModel buildTriggerWithRepeatFrequencyValue(Object repeatFrequency) {
    Bundle trigger = new Bundle();
    trigger.putLong("timestamp", mNow + ONE_DAY_MS);
    putBundleValue(trigger, "repeatFrequency", repeatFrequency);
    return TimestampTriggerModel.fromBundle(trigger);
  }

  private TimestampTriggerModel buildTriggerWithRepeatIntervalValue(Object repeatInterval) {
    Bundle trigger = buildRepeatingTriggerBundle();
    putBundleValue(trigger, "repeatInterval", repeatInterval);
    return TimestampTriggerModel.fromBundle(trigger);
  }

  private TimestampTriggerModel buildTriggerWithTimestampValue(Object timestamp) {
    Bundle trigger = new Bundle();
    trigger.putInt("repeatFrequency", REPEAT_FREQUENCY_DAILY);
    putBundleValue(trigger, "timestamp", timestamp);
    return TimestampTriggerModel.fromBundle(trigger);
  }

  private TimestampTriggerModel buildTriggerWithAlarmManagerTypeValue(Object type) {
    Bundle alarmManager = new Bundle();
    putBundleValue(alarmManager, "type", type);

    Bundle trigger = new Bundle();
    trigger.putBundle("alarmManager", alarmManager);
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

  private static void putBundleValue(Bundle bundle, String key, Object value) {
    if (value == null) {
      bundle.putString(key, null);
    } else if (value instanceof Integer) {
      bundle.putInt(key, (Integer) value);
    } else if (value instanceof Long) {
      bundle.putLong(key, (Long) value);
    } else if (value instanceof Float) {
      bundle.putFloat(key, (Float) value);
    } else if (value instanceof Double) {
      bundle.putDouble(key, (Double) value);
    } else if (value instanceof String) {
      bundle.putString(key, (String) value);
    } else if (value instanceof Boolean) {
      bundle.putBoolean(key, (Boolean) value);
    } else {
      throw new IllegalArgumentException("Unsupported bundle test value: " + value.getClass());
    }
  }

  @Test
  public void repeatFrequency_explicitNullUsesHourlyWhenTimestampIsValid() {
    long timestamp = mNow + ONE_DAY_MS;
    Bundle trigger = new Bundle();
    trigger.putLong("timestamp", timestamp);
    trigger.putString("repeatFrequency", null);

    TimestampTriggerModel model = TimestampTriggerModel.fromBundle(trigger);

    assertEquals(TimestampTriggerModel.HOURLY, model.getRepeatFrequency());
    assertEquals(1, model.getInterval());
    assertEquals(TimeUnit.HOURS, model.getTimeUnit());
    assertEquals(timestamp, model.getTimestamp());
  }

  @Test
  public void repeatFrequency_integerValuesMapToCurrentRepeatModes() {
    TimestampTriggerModel oneTime = buildTriggerWithRepeatFrequencyValue(-1);
    assertNull(oneTime.getRepeatFrequency());
    assertEquals(-1, oneTime.getInterval());
    assertNull(oneTime.getTimeUnit());

    TimestampTriggerModel hourly = buildTriggerWithRepeatFrequencyValue(REPEAT_FREQUENCY_HOURLY);
    assertEquals(TimestampTriggerModel.HOURLY, hourly.getRepeatFrequency());
    assertEquals(1, hourly.getInterval());
    assertEquals(TimeUnit.HOURS, hourly.getTimeUnit());

    TimestampTriggerModel daily = buildTriggerWithRepeatFrequencyValue(REPEAT_FREQUENCY_DAILY);
    assertEquals(TimestampTriggerModel.DAILY, daily.getRepeatFrequency());
    assertEquals(1, daily.getInterval());
    assertEquals(TimeUnit.DAYS, daily.getTimeUnit());

    TimestampTriggerModel weekly = buildTriggerWithRepeatFrequencyValue(REPEAT_FREQUENCY_WEEKLY);
    assertEquals(TimestampTriggerModel.WEEKLY, weekly.getRepeatFrequency());
    assertEquals(7, weekly.getInterval());
    assertEquals(TimeUnit.DAYS, weekly.getTimeUnit());

    TimestampTriggerModel monthly = buildTriggerWithRepeatFrequencyValue(REPEAT_FREQUENCY_MONTHLY);
    assertEquals(TimestampTriggerModel.MONTHLY, monthly.getRepeatFrequency());
    assertEquals(-1, monthly.getInterval());
    assertNull(monthly.getTimeUnit());
  }

  @Test
  public void repeatFrequency_truncatesDoubleValue() {
    TimestampTriggerModel model = buildTriggerWithRepeatFrequencyValue(2.9d);

    assertEquals(TimestampTriggerModel.WEEKLY, model.getRepeatFrequency());
    assertEquals(7, model.getInterval());
    assertEquals(TimeUnit.DAYS, model.getTimeUnit());
  }

  @Test
  public void repeatFrequency_preservesClassCastForUnsupportedTypes() {
    assertThrows(
        ClassCastException.class, () -> buildTriggerWithRepeatFrequencyValue(Long.valueOf(0L)));
    assertThrows(
        ClassCastException.class, () -> buildTriggerWithRepeatFrequencyValue(Float.valueOf(0.0f)));
    assertThrows(ClassCastException.class, () -> buildTriggerWithRepeatFrequencyValue("0"));
  }

  @Test
  public void repeatInterval_missingNullAndNonNumberDefaultToOne() {
    assertEquals(1, TimestampTriggerModel.fromBundle(buildRepeatingTriggerBundle()).getInterval());
    assertEquals(1, buildTriggerWithRepeatIntervalValue(null).getInterval());
    assertEquals(1, buildTriggerWithRepeatIntervalValue("2").getInterval());
  }

  @Test
  public void repeatInterval_acceptsPositiveIntegralNumbers() {
    assertEquals(2, buildTriggerWithRepeatIntervalValue(2).getInterval());
    assertEquals(3, buildTriggerWithRepeatIntervalValue(Long.valueOf(3L)).getInterval());
    assertEquals(4, buildTriggerWithRepeatIntervalValue(Float.valueOf(4.0f)).getInterval());
    assertEquals(5, buildTriggerWithRepeatIntervalValue(Double.valueOf(5.0d)).getInterval());
  }

  @Test
  public void repeatInterval_rejectsZeroNegativeFractionalNaNInfinityAndOverflow() {
    assertEquals(1, buildTriggerWithRepeatIntervalValue(0).getInterval());
    assertEquals(1, buildTriggerWithRepeatIntervalValue(-1).getInterval());
    assertEquals(1, buildTriggerWithRepeatIntervalValue(1.5d).getInterval());
    assertEquals(1, buildTriggerWithRepeatIntervalValue(Double.NaN).getInterval());
    assertEquals(1, buildTriggerWithRepeatIntervalValue(Double.POSITIVE_INFINITY).getInterval());
    assertEquals(
        1,
        buildTriggerWithRepeatIntervalValue(Long.valueOf((long) Integer.MAX_VALUE + 1L))
            .getInterval());
  }

  @Test
  public void timestamp_missingWithRepeatFrequencyThrowsNullPointerException() {
    Bundle trigger = new Bundle();
    trigger.putInt("repeatFrequency", REPEAT_FREQUENCY_DAILY);

    assertThrows(NullPointerException.class, () -> TimestampTriggerModel.fromBundle(trigger));
  }

  @Test
  public void timestamp_explicitNullWithRepeatFrequencyThrowsNullPointerException() {
    Bundle trigger = new Bundle();
    trigger.putInt("repeatFrequency", REPEAT_FREQUENCY_DAILY);
    trigger.putString("timestamp", null);

    assertThrows(NullPointerException.class, () -> TimestampTriggerModel.fromBundle(trigger));
  }

  @Test
  public void timestamp_longValueIsPreserved() {
    long timestamp = 123456789L;

    TimestampTriggerModel model = buildTriggerWithTimestampValue(timestamp);

    assertEquals(timestamp, model.getTimestamp());
  }

  @Test
  public void timestamp_truncatesDoubleValue() {
    TimestampTriggerModel model = buildTriggerWithTimestampValue(123456789.9d);

    assertEquals(123456789L, model.getTimestamp());
  }

  @Test
  public void timestamp_preservesClassCastForUnsupportedTypes() {
    assertThrows(ClassCastException.class, () -> buildTriggerWithTimestampValue(1));
    assertThrows(
        ClassCastException.class, () -> buildTriggerWithTimestampValue(Float.valueOf(1.0f)));
    assertThrows(ClassCastException.class, () -> buildTriggerWithTimestampValue("123456789"));
  }

  @Test
  public void alarmManager_missingKeepsAlarmManagerDisabled() {
    TimestampTriggerModel model = TimestampTriggerModel.fromBundle(new Bundle());

    assertFalse(model.getWithAlarmManager());
    assertEquals(TimestampTriggerModel.AlarmType.SET_EXACT, model.getAlarmType());
  }

  @Test
  public void alarmManager_nullBundlePreservesCurrentBehavior() {
    Bundle trigger = new Bundle();
    trigger.putBundle("alarmManager", null);

    assertThrows(NullPointerException.class, () -> TimestampTriggerModel.fromBundle(trigger));
  }

  @Test
  public void alarmManager_missingOrNullTypeDefaultsToSetExactAllowWhileIdle() {
    Bundle missingTypeAlarmManager = new Bundle();
    Bundle missingTypeTrigger = new Bundle();
    missingTypeTrigger.putBundle("alarmManager", missingTypeAlarmManager);
    TimestampTriggerModel missingTypeModel = TimestampTriggerModel.fromBundle(missingTypeTrigger);

    assertTrue(missingTypeModel.getWithAlarmManager());
    assertEquals(
        TimestampTriggerModel.AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE,
        missingTypeModel.getAlarmType());

    Bundle nullTypeAlarmManager = new Bundle();
    nullTypeAlarmManager.putString("type", null);
    Bundle nullTypeTrigger = new Bundle();
    nullTypeTrigger.putBundle("alarmManager", nullTypeAlarmManager);
    TimestampTriggerModel nullTypeModel = TimestampTriggerModel.fromBundle(nullTypeTrigger);

    assertTrue(nullTypeModel.getWithAlarmManager());
    assertEquals(
        TimestampTriggerModel.AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE,
        nullTypeModel.getAlarmType());
  }

  @Test
  public void alarmManager_mapsIntegerTypes() {
    TimestampTriggerModel.AlarmType[] expectedTypes =
        new TimestampTriggerModel.AlarmType[] {
          TimestampTriggerModel.AlarmType.SET,
          TimestampTriggerModel.AlarmType.SET_AND_ALLOW_WHILE_IDLE,
          TimestampTriggerModel.AlarmType.SET_EXACT,
          TimestampTriggerModel.AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE,
          TimestampTriggerModel.AlarmType.SET_ALARM_CLOCK
        };

    for (int type = 0; type < expectedTypes.length; type++) {
      TimestampTriggerModel model = buildTriggerWithAlarmManagerTypeValue(type);

      assertTrue(model.getWithAlarmManager());
      assertEquals(expectedTypes[type], model.getAlarmType());
    }
  }

  @Test
  public void alarmManager_truncatesDoubleType() {
    TimestampTriggerModel model = buildTriggerWithAlarmManagerTypeValue(4.9d);

    assertTrue(model.getWithAlarmManager());
    assertEquals(TimestampTriggerModel.AlarmType.SET_ALARM_CLOCK, model.getAlarmType());
  }

  @Test
  public void alarmManager_preservesClassCastForUnsupportedTypes() {
    assertThrows(
        ClassCastException.class, () -> buildTriggerWithAlarmManagerTypeValue(Long.valueOf(3L)));
    assertThrows(
        ClassCastException.class, () -> buildTriggerWithAlarmManagerTypeValue(Float.valueOf(3.0f)));
    assertThrows(ClassCastException.class, () -> buildTriggerWithAlarmManagerTypeValue("3"));
  }

  @Test
  public void alarmManager_allowWhileIdleOverridesTypeToSetExactAllowWhileIdle() {
    Bundle alarmManager = new Bundle();
    alarmManager.putInt("type", 4);
    alarmManager.putBoolean("allowWhileIdle", true);
    Bundle trigger = new Bundle();
    trigger.putBundle("alarmManager", alarmManager);

    TimestampTriggerModel model = TimestampTriggerModel.fromBundle(trigger);

    assertTrue(model.getWithAlarmManager());
    assertEquals(
        TimestampTriggerModel.AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE, model.getAlarmType());
  }

  // Regression tests for the DAILY/WEEKLY/HOURLY rescheduling cycle. Guard the fix for
  // upstream invertase/notifee#839 (DAILY trigger fails to re-fire from day 2 onwards on
  // Android) and #875 (DST-safe Calendar.add for repeat frequency) against future refactors
  // of TimestampTriggerModel.setNextTimestamp().

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
    TimestampTriggerModel trigger = buildRepeatingTrigger(original, REPEAT_FREQUENCY_DAILY, 2);

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
    TimestampTriggerModel trigger = buildRepeatingTrigger(original, REPEAT_FREQUENCY_WEEKLY, 2);

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
    TimestampTriggerModel trigger = buildRepeatingTrigger(original, REPEAT_FREQUENCY_MONTHLY, 3);

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

    TimestampTriggerModel trigger = buildRepeatingTrigger(original, REPEAT_FREQUENCY_MONTHLY, 1);

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
  @Config(instrumentedPackages = "app.notifee.core.model")
  public void setNextTimestamp_dailyEveryTwoDaysAcrossDstSpringForward() {
    TimeZone rome = TimeZone.getTimeZone("Europe/Rome");
    TimeZone.setDefault(rome);

    long originalTimestamp = 1774668600000L; // 2026-03-28 04:30 CET
    long fixedNow = 1774908000000L; // 2026-03-31 00:00 CEST
    long expectedTimestamp = 1775010600000L; // 2026-04-01 04:30 CEST
    assertTrue(SystemClock.setCurrentTimeMillis(fixedNow));

    TimestampTriggerModel trigger =
        buildRepeatingTrigger(originalTimestamp, REPEAT_FREQUENCY_DAILY, 2);
    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    // Two-day calendar steps cross the offset change without the 05:30 fixed-ms drift.
    assertEquals("next timestamp must match the fixed DST fixture", expectedTimestamp, next);
    assertTrue("next timestamp must be >= fixed now", next >= fixedNow);
    assertEquals("repeatInterval must remain 2", 2, trigger.getInterval());
    Calendar nextCal = Calendar.getInstance(rome);
    nextCal.setTimeInMillis(next);
    assertEquals(
        "wall-clock hour must remain 4 with repeatInterval=2",
        4,
        nextCal.get(Calendar.HOUR_OF_DAY));
    assertEquals("wall-clock minute must remain 30", 30, nextCal.get(Calendar.MINUTE));
    assertEquals("wall-clock second must remain 0", 0, nextCal.get(Calendar.SECOND));
  }

  @Test
  @Config(instrumentedPackages = "app.notifee.core.model")
  public void setNextTimestamp_dailyAcrossDstSpringForward() {
    TimeZone rome = TimeZone.getTimeZone("Europe/Rome");
    TimeZone.setDefault(rome);

    long originalTimestamp = 1774668600000L; // 2026-03-28 04:30 CET
    long fixedNow = 1774821600000L; // 2026-03-30 00:00 CEST
    long expectedTimestamp = 1774837800000L; // 2026-03-30 04:30 CEST
    assertTrue(SystemClock.setCurrentTimeMillis(fixedNow));

    TimestampTriggerModel trigger =
        buildRepeatingTrigger(originalTimestamp, REPEAT_FREQUENCY_DAILY);
    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    // Calendar days preserve 04:30 across spring-forward; fixed 24-hour steps reach 05:30.
    assertEquals("next timestamp must match the fixed DST fixture", expectedTimestamp, next);
    assertTrue("next timestamp must be >= fixed now", next >= fixedNow);
    Calendar nextCal = Calendar.getInstance(rome);
    nextCal.setTimeInMillis(next);
    assertEquals(
        "wall-clock hour must remain 4 after crossing spring-forward",
        4,
        nextCal.get(Calendar.HOUR_OF_DAY));
    assertEquals("wall-clock minute must remain 30", 30, nextCal.get(Calendar.MINUTE));
    assertEquals("wall-clock second must remain 0", 0, nextCal.get(Calendar.SECOND));
  }

  @Test
  @Config(instrumentedPackages = "app.notifee.core.model")
  public void setNextTimestamp_dailyAcrossDstFallBack() {
    TimeZone rome = TimeZone.getTimeZone("Europe/Rome");
    TimeZone.setDefault(rome);

    long originalTimestamp = 1761359400000L; // 2025-10-25 04:30 CEST
    long fixedNow = 1761519600000L; // 2025-10-27 00:00 CET
    long expectedTimestamp = 1761535800000L; // 2025-10-27 04:30 CET
    assertTrue(SystemClock.setCurrentTimeMillis(fixedNow));

    TimestampTriggerModel trigger =
        buildRepeatingTrigger(originalTimestamp, REPEAT_FREQUENCY_DAILY);
    trigger.setNextTimestamp();
    long next = trigger.getTimestamp();

    // Calendar days preserve 04:30 across fall-back; fixed 24-hour steps reach 03:30.
    assertEquals("next timestamp must match the fixed DST fixture", expectedTimestamp, next);
    assertTrue("next timestamp must be >= fixed now", next >= fixedNow);
    Calendar nextCal = Calendar.getInstance(rome);
    nextCal.setTimeInMillis(next);
    assertEquals(
        "wall-clock hour must remain 4 after crossing fall-back",
        4,
        nextCal.get(Calendar.HOUR_OF_DAY));
    assertEquals("wall-clock minute must remain 30", 30, nextCal.get(Calendar.MINUTE));
    assertEquals("wall-clock second must remain 0", 0, nextCal.get(Calendar.SECOND));
  }
}
