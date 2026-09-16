package com.dahatos.launcher;

import android.app.NotificationManager;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.BatteryManager;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Base64;
import android.app.WallpaperManager;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;

import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;

/**
 * The only privileged surface the OS gets: what an Android app may do, exposed as
 * small, boring methods. Every capability the in-OS permission manager gates maps
 * to exactly one method here, so "what can an app do" is answerable by reading
 * this file — the same argument Android makes with permissions, but auditable.
 *
 * Calls arrive on the WebView's JS thread, so anything touching the UI is posted.
 */
public final class DahatBridge {

  private final MainActivity act;

  DahatBridge(MainActivity activity) { this.act = activity; }

  // ------------------------------------------------------------------ info
  @JavascriptInterface
  public String info() {
    JSONObject o = new JSONObject();
    try {
      PackageInfo pi = act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
      o.put("package", act.getPackageName());
      o.put("versionName", pi.versionName == null ? "0" : pi.versionName);
      o.put("versionCode", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
      o.put("androidSdk", Build.VERSION.SDK_INT);
      o.put("brand", Build.BRAND);
      o.put("model", Build.MODEL);
      o.put("device", Build.DEVICE);
      o.put("manufacturer", Build.MANUFACTURER);
      o.put("osBuild", Build.DISPLAY);
      o.put("securityPatch", Build.VERSION.SECURITY_PATCH);
      o.put("abi", Build.SUPPORTED_ABIS != null && Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "?");
      o.put("host", "dahat-launcher");
      o.put("bootTimeMs", BuildConfig.OS_BUILD_TIME);
    } catch (Exception e) {
      try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
    }
    return o.toString();
  }

  @JavascriptInterface
  public String battery() {
    JSONObject o = new JSONObject();
    try {
      Intent st = act.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
      int level = st == null ? -1 : st.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
      int scale = st == null ? -1 : st.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
      int status = st == null ? -1 : st.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
      boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
      int plug = st == null ? 0 : st.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
      o.put("level", level >= 0 && scale > 0 ? (float) level / (float) scale : -1f);
      o.put("charging", charging);
      o.put("plugged", plug == BatteryManager.BATTERY_PLUGGED_AC ? "ac" : plug == BatteryManager.BATTERY_PLUGGED_USB ? "usb" : plug == BatteryManager.BATTERY_PLUGGED_WIRELESS ? "wireless" : "none");
      o.put("temperature", st != null && st.hasExtra(BatteryManager.EXTRA_TEMPERATURE) ? st.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0 : -1);
      o.put("health", st == null ? "?" : healthName(st.getIntExtra(BatteryManager.EXTRA_HEALTH, 0)));
    } catch (Exception e) {
      try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
    }
    return o.toString();
  }

  private static String healthName(int h) {
    switch (h) {
      case BatteryManager.BATTERY_HEALTH_GOOD: return "good";
      case BatteryManager.BATTERY_HEALTH_OVERHEAT: return "overheat";
      case BatteryManager.BATTERY_HEALTH_DEAD: return "dead";
      case BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE: return "over-voltage";
      case BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE: return "failure";
      case BatteryManager.BATTERY_HEALTH_COLD: return "cold";
      default: return "unknown";
    }
  }

  // ------------------------------------------------------------------ feel
  @JavascriptInterface
  public void vibrate(String patternJson) {
    try {
      Vibrator v = act.getSystemService(Vibrator.class);
      if (v == null || !v.hasVibrator()) return;
      String raw = patternJson == null ? "[12]" : patternJson.trim();
      if (raw.startsWith("[")) {
        long[] p = parsePattern(raw);
        if (p.length == 0) return;
        if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(p, -1));
        else v.vibrate(p, -1);
      } else {
        long ms = (long) Math.max(1, Double.parseDouble(raw.replaceAll("[^0-9.]", "")));
        if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
        else v.vibrate(ms);
      }
    } catch (Exception ignored) {
      // haptics are a nicety; never let them break a tap
    }
  }

  private static long[] parsePattern(String raw) {
    String body = raw.replace("[", "").replace("]", "").trim();
    if (body.isEmpty()) return new long[0];
    String[] parts = body.split(",");
    long[] out = new long[parts.length];
    for (int i = 0; i < parts.length; i++) {
      try { out[i] = (long) Math.max(1, Double.parseDouble(parts[i].trim())); } catch (Exception e) { out[i] = 10; }
    }
    return out;
  }

  @JavascriptInterface
  public void keepAwake(boolean on) { act.runOnUiThread(() -> act.keepScreenOn(on)); }

  @JavascriptInterface
  public void setSystemBars(String json) {
    try {
      JSONObject o = new JSONObject(json);
      final boolean light = "light".equals(o.optString("theme", "dark"));
      final int bg = android.graphics.Color.parseColor(o.optString("bg", "#07090c"));
      act.runOnUiThread(() -> act.setBarAppearance(light, bg));
    } catch (Exception ignored) { }
  }

  // ------------------------------------------------------------------ notify
  @JavascriptInterface
  public void notify(String json) {
    act.runOnUiThread(() -> {
      try {
        JSONObject o = new JSONObject(json);
        act.ensureChannels();
        if (!notificationAllowed()) {
          requestNotificationPermission();
          return;
        }
        String title = o.optString("title", "Dahat OS");
        String body = o.optString("body", "");
        String channel = "alarm".equals(o.optString("channel")) ? MainActivity.CHANNEL_ALARM : MainActivity.CHANNEL_OS;
        int id = o.optString("id", title).hashCode();
        NotificationCompat.Builder b = new NotificationCompat.Builder(act, channel)
            .setSmallIcon(R.drawable.ic_stat_dahat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setOnlyAlertOnce(!"alarm".equals(channel));
        if ("alarm".equals(channel)) {
          b.setPriority(NotificationCompat.PRIORITY_MAX)
              .setCategory(NotificationCompat.CATEGORY_ALARM)
              .setFullScreenIntent(AlarmReceiver.openIntent(act, o.optString("key", "clock"), title), true);
        }
        NotificationManager nm = act.getSystemService(NotificationManager.class);
        if (nm != null) nm.notify("dahat".concat(channel), id, b.build());
      } catch (Exception ignored) { }
    });
  }

  @JavascriptInterface
  public void cancelNotification(String idOrKey) {
    try {
      NotificationManager nm = act.getSystemService(NotificationManager.class);
      if (nm != null) nm.cancel("dahat" + MainActivity.CHANNEL_OS, String.valueOf(idOrKey).hashCode());
    } catch (Exception ignored) { }
  }

  private boolean notificationAllowed() {
    if (Build.VERSION.SDK_INT < 33) return true;
    return act.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
  }

  private void requestNotificationPermission() {
    if (Build.VERSION.SDK_INT < 33) return;
    try {
      act.requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, MainActivity.REQ_NOTIF);
    } catch (Exception ignored) { }
  }

  @JavascriptInterface
  public void toast(String text) {
    final String t = text == null ? "" : text;
    act.runOnUiThread(() -> Toast.makeText(act, t, Toast.LENGTH_SHORT).show());
  }

  // ------------------------------------------------------------------ share
  @JavascriptInterface
  public void share(String json) {
    act.runOnUiThread(() -> {
      try {
        JSONObject o = new JSONObject(json);
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType(o.optString("mime", "text/plain"));
        i.putExtra(Intent.EXTRA_TEXT, o.optString("text", ""));
        if (o.has("title")) i.putExtra(Intent.EXTRA_SUBJECT, o.optString("title"));
        act.startActivity(Intent.createChooser(i, o.optString("title", "Dahat OS")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      } catch (Exception ignored) { }
    });
  }

  @JavascriptInterface
  public void openUrl(String url) {
    if (url == null) return;
    final String u = url.trim();
    if (!(u.startsWith("http://") || u.startsWith("https://") || u.startsWith("tel:") || u.startsWith("mailto:") || u.startsWith("geo:") || u.startsWith("sms:"))) return;
    act.runOnUiThread(() -> {
      try { act.startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(u)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
      catch (Exception e) { Toast.makeText(act, "No app for " + u, Toast.LENGTH_SHORT).show(); }
    });
  }

  @JavascriptInterface
  public void dial(String number) {
    if (number == null || number.isEmpty()) return;
    final String n = number;
    act.runOnUiThread(() -> {
      try { act.startActivity(new Intent(Intent.ACTION_DIAL, android.net.Uri.fromParts("tel", n.replaceAll("[^0-9+#*,]", ""), null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
      catch (Exception ignored) { }
    });
  }

  // ------------------------------------------------------------------ host
  @JavascriptInterface
  public void setWallpaper(String dataUrl) {
    try {
      String b64 = dataUrl;
      int comma = b64.indexOf(',');
      if (b64.startsWith("data:") && comma > 0) b64 = b64.substring(comma + 1);
      final byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
      act.runOnUiThread(() -> {
        try {
          Bitmap bmp = BitmapFactory.decodeStream(new ByteArrayInputStream(bytes));
          if (bmp != null) act.getSystemService(WallpaperManager.class).setBitmap(bmp);
        } catch (Exception ignored) { }
      });
    } catch (Exception ignored) { }
  }

  @JavascriptInterface
  public boolean requestIgnoreBatteryOptimizations() {
    if (Build.VERSION.SDK_INT < 23) return true;
    act.runOnUiThread(() -> {
      try {
        Intent i = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            android.net.Uri.parse("package:" + act.getPackageName()));
        act.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      } catch (Exception e) {
        try {
          act.startActivity(new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored2) { }
      }
    });
    return true;
  }

  /** "Reboot to Android": opens Android's own default-home picker. */
  @JavascriptInterface
  public void exitLauncher() {
    act.runOnUiThread(() -> {
      try {
        if (Build.VERSION.SDK_INT >= 25) {
          act.startActivity(new Intent(android.provider.Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } else {
          act.startActivity(new Intent(android.provider.Settings.ACTION_DISPLAY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
      } catch (Exception ignored) { }
    });
  }

  // ------------------------------------------------------------------ alarms
  @JavascriptInterface
  public void scheduleAlarm(String json) {
    try {
      JSONObject o = new JSONObject(json);
      AlarmReceiver.schedule(act, o.optString("key"), o.optInt("hour", -1), o.optInt("minute", 0),
          o.optString("label", "Dahat alarm"), o.optBoolean("repeat", false), o.optString("appId", "clock"));
    } catch (Exception ignored) { }
  }

  @JavascriptInterface
  public void cancelAlarm(String key) { AlarmReceiver.cancel(act, String.valueOf(key)); }

  /** called by the activity so the OS knows whether it is in the foreground */
  void onForeground(boolean fg) {
    try { act.js("window.__dahatForeground = " + (fg ? "true" : "false")); } catch (Exception ignored) { }
  }
}
