package com.dahatos.launcher;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.util.Calendar;

/**
 * Alarms that must survive the OS being closed.
 *
 * An app inside Dahat asks the kernel (app.setAlarm), the kernel asks the bridge,
 * the bridge arms a real AlarmManager alarm. When it fires, this receiver owns the
 * notification and the full-screen hand-back into the OS, so waking the phone is
 * Android's job and the *meaning* of the alarm stays in JS.
 */
public final class AlarmReceiver extends BroadcastReceiver {

  static final String ACTION_FIRE = "com.dahatos.launcher.ALARM_FIRE";
  static final String ACTION_SNOOZE = "com.dahatos.launcher.ALARM_SNOOZE";
  static final String ACTION_DISMISS = "com.dahatos.launcher.ALARM_DISMISS";
  static final String EXTRA_KEY = "key";
  static final String EXTRA_LABEL = "label";
  static final String EXTRA_APP = "appId";
  static final String EXTRA_REPEAT = "repeat";
  static final String EXTRA_HOUR = "hour";
  static final String EXTRA_MIN = "minute";
  private static final int SNOOZE_MINUTES = 5;

  // ------------------------------------------------------------------ arm
  public static void schedule(Context c, String key, int hour, int minute, String label, boolean repeat, String appId) {
    if (key == null || key.isEmpty() || hour < 0 || hour > 23 || minute < 0 || minute > 59) return;
    ensureChannels(c);
    long triggerAt = nextTrigger(hour, minute);
    AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    Intent fire = new Intent(c, AlarmReceiver.class).setAction(ACTION_FIRE)
        .putExtra(EXTRA_KEY, key).putExtra(EXTRA_LABEL, label == null ? "Dahat alarm" : label)
        .putExtra(EXTRA_APP, appId == null ? "clock" : appId)
        .putExtra(EXTRA_REPEAT, repeat).putExtra(EXTRA_HOUR, hour).putExtra(EXTRA_MIN, minute);
    PendingIntent pi = broadcast(c, key.hashCode(), fire);
    boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
    try {
      if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
      else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);   // inexact under a denied permission
    } catch (Exception e) {
      am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
    }
  }

  public static void cancel(Context c, String key) {
    if (key == null) return;
    AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    Intent i = new Intent(c, AlarmReceiver.class).setAction(ACTION_FIRE).putExtra(EXTRA_KEY, key);
    am.cancel(broadcast(c, key.hashCode(), i));
    NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm != null) nm.cancel("dahat.alarm", key.hashCode());
  }

  /** the tap / full-screen target: opens the OS and tells it which alarm rang */
  static PendingIntent openIntent(Context c, String key, String label) {
    String json;
    try {
      JSONObject o = new JSONObject();
      o.put("type", "alarm");
      o.put("key", key);
      o.put("label", label == null ? "" : label);
      json = o.toString();
    } catch (Exception e) {
      json = "{\"type\":\"alarm\"}";
    }
    Intent i = new Intent(c, MainActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra("dahatIntent", json);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
    return PendingIntent.getActivity(c, key == null ? 0 : key.hashCode(), i, flags);
  }

  private static PendingIntent broadcast(Context c, int requestCode, Intent i) {
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
    return PendingIntent.getBroadcast(c, requestCode, i, flags);
  }

  private static long nextTrigger(int hour, int minute) {
    Calendar cal = Calendar.getInstance();
    cal.set(Calendar.HOUR_OF_DAY, hour);
    cal.set(Calendar.MINUTE, minute);
    cal.set(Calendar.SECOND, 0);
    cal.set(Calendar.MILLISECOND, 0);
    if (cal.getTimeInMillis() <= System.currentTimeMillis()) cal.add(Calendar.DAY_OF_YEAR, 1);
    return cal.getTimeInMillis();
  }

  // ------------------------------------------------------------------ fire
  @Override
  public void onReceive(Context c, Intent intent) {
    String action = intent.getAction() == null ? ACTION_FIRE : intent.getAction();
    String key = intent.getStringExtra(EXTRA_KEY);
    if (key == null) key = "alarm";
    String label = intent.getStringExtra(EXTRA_LABEL);
    String app = intent.getStringExtra(EXTRA_APP);
    ensureChannels(c);
    NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;

    if (ACTION_DISMISS.equals(action)) { nm.cancel("dahat.alarm", key.hashCode()); return; }

    if (ACTION_SNOOZE.equals(action)) {
      nm.cancel("dahat.alarm", key.hashCode());
      Calendar cal = Calendar.getInstance();
      cal.add(Calendar.MINUTE, SNOOZE_MINUTES);
      Intent fire = new Intent(c, AlarmReceiver.class).setAction(ACTION_FIRE)
          .putExtra(EXTRA_KEY, key + ":snooze").putExtra(EXTRA_LABEL, label).putExtra(EXTRA_APP, app).putExtra(EXTRA_REPEAT, false);
      AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
      if (am != null) am.set(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), broadcast(c, (key + ":snooze").hashCode(), fire));
      return;
    }

    boolean repeat = intent.getBooleanExtra(EXTRA_REPEAT, false);
    String body = label == null || label.isEmpty() ? "Dahat OS alarm" : label;
    NotificationCompat.Builder b = new NotificationCompat.Builder(c, MainActivity.CHANNEL_ALARM)
        .setSmallIcon(R.drawable.ic_stat_dahat)
        .setContentTitle("⏰ " + body)
        .setContentText(c.getString(R.string.alarm_body))
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_ALARM)
        .setAutoCancel(true)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setContentIntent(openIntent(c, key, body))
        .setDeleteIntent(broadcast(c, key.hashCode() + 2, new Intent(c, AlarmReceiver.class).setAction(ACTION_DISMISS)
            .putExtra(EXTRA_KEY, key).putExtra(EXTRA_LABEL, label).putExtra(EXTRA_APP, app)))
        .addAction(0, "Snooze", broadcast(c, key.hashCode() + 1, new Intent(c, AlarmReceiver.class).setAction(ACTION_SNOOZE)
            .putExtra(EXTRA_KEY, key).putExtra(EXTRA_LABEL, label).putExtra(EXTRA_APP, app)));
    try { b.setFullScreenIntent(openIntent(c, key, body), true); } catch (Exception ignored) { }
    nm.notify("dahat.alarm", key.hashCode(), b.build());

    // a repeating alarm re-arms itself for tomorrow; a one-shot is done, and the
    // in-OS Clock forgets it the next time the app is focused (it re-syncs on mount)
    if (repeat) {
      schedule(c, key, intent.getIntExtra(EXTRA_HOUR, -1), intent.getIntExtra(EXTRA_MIN, 0), label, true, app);
    }
  }

  static void ensureChannels(Context c) {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    NotificationChannel alarm = new NotificationChannel(MainActivity.CHANNEL_ALARM, c.getString(R.string.notif_channel_alarm), NotificationManager.IMPORTANCE_HIGH);
    alarm.setDescription(c.getString(R.string.notif_channel_alarm_desc));
    alarm.enableVibration(true);
    alarm.setVibrationPattern(new long[]{0, 420, 220, 420, 220, 700});
    try { alarm.setBypassDnd(true); } catch (SecurityException ignored) { }  // only with DND policy access
    alarm.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
    try {
      alarm.setSound(android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM), null);
    } catch (Exception ignored) { }
    nm.createNotificationChannel(alarm);
    NotificationChannel os = new NotificationChannel(MainActivity.CHANNEL_OS, c.getString(R.string.notif_channel_os), NotificationManager.IMPORTANCE_DEFAULT);
    os.setDescription(c.getString(R.string.notif_channel_os_desc));
    os.setShowBadge(true);
    nm.createNotificationChannel(os);
  }
}
