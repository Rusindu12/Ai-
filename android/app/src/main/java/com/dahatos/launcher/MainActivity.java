package com.dahatos.launcher;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * Dahat OS host activity.
 *
 * The whole operating system is ES modules packaged in assets/os; this class is
 * only the *hardware abstraction layer* for it: a WebView served from a secure
 * app-owned origin, back-key routing, runtime permissions, file sharing and the
 * launcher/home-screen intent contracts. Keeping it this small is the point: the
 * OS logic lives in JS where it can be tested, not in Java.
 */
public final class MainActivity extends Activity {

  /** WebViewAssetLoader serves assets over https:// so storage, clipboard, camera and
   *  service-worker-shaped APIs behave like a real secure origin (file:// does not). */
  static final String OS_URL = "https://appassets.androidplatform.net/os/index.html";
  static final String CHANNEL_OS = "dahat.os";
  static final String CHANNEL_ALARM = "dahat.alarm";

  private WebView web;
  private DahatBridge bridge;
  private boolean pageReady;
  private final List<String> queuedIntents = new ArrayList<>();
  private PermissionRequest pendingPermission;
  private ValueCallback<Uri[]> pendingFileChooser;
  private static final int REQ_PERMS = 41;
  private static final int REQ_FILE = 42;
  static final int REQ_NOTIF = 43;   // asked for by the bridge when an app posts

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    requestWindowFeature(Window.FEATURE_NO_TITLE);
    applyEdgeToEdge();

    WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
        .addPathHandler("/os/", new WebViewAssetLoader.AssetsPathHandler(this, true))
        .build();

    web = new WebView(this);
    setContentView(web);

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);            // the OS keeps its /storage on localStorage
    s.setDatabaseEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setAllowFileAccess(false);            // assets come through the loader, not file://
    s.setAllowContentAccess(true);
    s.setAllowUniversalAccessFromFileURLs(false);
    s.setAllowFileAccessFromFileURLs(false);
    s.setJavaScriptCanOpenWindowsAutomatically(false);
    s.setSupportZoom(false);
    s.setBuiltInZoomControls(false);
    configureViewport(s);
    s.setTextZoom(100);
    s.setCacheMode(WebSettings.LOAD_DEFAULT);
    if (isDebuggable()) WebView.setWebContentsDebuggingEnabled(true);

    bridge = new DahatBridge(this);
    web.addJavascriptInterface(bridge, "DahatBridge");
    web.setBackgroundColor(Color.parseColor("#07090c"));   // no white flash on cold start
    web.setOverScrollMode(View.OVER_SCROLL_NEVER);
    web.setVerticalScrollBarEnabled(false);
    web.setHorizontalScrollBarEnabled(false);

    web.setWebViewClient(new WebViewClientCompat() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
        return loader.shouldInterceptRequest(req.getUrl());
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        pageReady = true;
        flushIntents();
        ensureChannels();
      }

      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
        // anything that leaves our origin (a link an app opened) goes to Android
        String host = req.getUrl().getHost();
        if (host != null && host.endsWith("appassets.androidplatform.net")) return false;
        try {
          Intent open = new Intent(Intent.ACTION_VIEW, req.getUrl());
          open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
          startActivity(open);
        } catch (Exception ignored) {
          // no handler: stay inside the OS instead of crashing
        }
        return true;
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onPermissionRequest(final PermissionRequest req) {
        List<String> needed = new ArrayList<>();
        for (String res : req.getResources()) {
          if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) needed.add(android.Manifest.permission.CAMERA);
          else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) needed.add(android.Manifest.permission.RECORD_AUDIO);
        }
        List<String> missing = new ArrayList<>();
        for (String p : needed) {
          if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        }
        if (missing.isEmpty()) {
          req.grant(needed.toArray(new String[0]));
          return;
        }
        pendingPermission = req;
        requestPermissions(missing.toArray(new String[0]), REQ_PERMS);
      }

      @Override
      public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
        pendingFileChooser = callback;
        Intent pick = params.createIntent();
        try {
          startActivityForResult(pick, REQ_FILE);
        } catch (Exception e) {
          pendingFileChooser = null;
          return false;
        }
        return true;
      }
    });

    web.loadUrl(OS_URL);
    forwardIntent(getIntent());
  }

  /** Keep 1 CSS px == 1 device-independent px: the OS sizes itself with viewport-fit
   *  and safe-area insets, so no desktop-mode or text-autoscaling heuristics. */
  private void configureViewport(WebSettings s) {
    s.setUseWideViewPort(true);
    s.setLoadWithOverviewMode(false);
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    // a launcher is re-entered by the HOME key: hand the OS a chance to show page 0
    if (Intent.ACTION_MAIN.equals(intent.getAction()) && !queuedIntents.isEmpty()) flushIntents();
    if (intent.getData() != null || Intent.ACTION_SEND.equals(intent.getAction())) forwardIntent(intent);
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (web != null) {
      web.onResume();
      web.resumeTimers();
      js("window.dahatOnResume && window.dahatOnResume()");
      bridge.onForeground(true);
    }
  }

  @Override
  protected void onPause() {
    if (web != null) {
      js("window.dahatOnPause && window.dahatOnPause()");
      web.onPause();
      // freezing the renderer while backgrounded is what keeps a home-screen
      // replacement from eating battery; alarms are armed in Android, not here
      web.pauseTimers();
      bridge.onForeground(false);
    }
    super.onPause();
  }

  @Override
  public void onBackPressed() {
    if (web == null) { super.onBackPressed(); return; }
    web.evaluateJavascript("window.dahatOnBack ? (window.dahatOnBack() === true) : false", new ValueCallback<String>() {
      @Override public void onReceiveValue(String value) {
        if (!"true".equals(value)) moveTaskToBack(true);  // let HOME behave like HOME
      }
    });
  }

  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (keyCode == KeyEvent.KEYCODE_HOME) {   // only delivered to the default launcher
      js("window.dahatGoHome && window.dahatGoHome()");
      return true;
    }
    return super.onKeyDown(keyCode, event);
  }

  @Override
  protected void onActivityResult(int code, int result, Intent data) {
    super.onActivityResult(code, result, data);
    if (code == REQ_FILE && pendingFileChooser != null) {
      Uri[] uris = null;
      if (result == RESULT_OK && data != null) {
        Uri clip = data.getData();
        if (clip != null) uris = new Uri[]{clip};
        else if (data.getClipData() != null) {
          uris = new Uri[data.getClipData().getItemCount()];
          for (int i = 0; i < uris.length; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
        }
      }
      pendingFileChooser.onReceiveValue(uris);
      pendingFileChooser = null;
    }
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] perms, int[] grants) {
    super.onRequestPermissionsResult(code, perms, grants);
    if (code == REQ_NOTIF) { ensureChannels(); return; }
    if (code == REQ_PERMS && pendingPermission != null) {
      boolean all = true;
      for (int g : grants) if (g != PackageManager.PERMISSION_GRANTED) all = false;
      if (all) pendingPermission.grant(pendingPermission.getResources());
      else pendingPermission.deny();
      pendingPermission = null;
    }
  }

  /** Share ▸ Dahat OS (text), dahat:// deep links and alarm taps land here. */
  private void forwardIntent(Intent intent) {
    if (intent == null) return;
    String json = null;
    String direct = intent.getStringExtra("dahatIntent");
    if (direct != null && !direct.isEmpty()) {
      if (pageReady) js("window.dahatOnIntent && window.dahatOnIntent(" + JSONObjectLite.quote(direct) + ")");
      else queuedIntents.add(direct);
      return;
    }
    try {
      if (Intent.ACTION_SEND.equals(intent.getAction())) {
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        CharSequence subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
        if (text == null && intent.getParcelableExtra(Intent.EXTRA_STREAM) != null) {
          text = String.valueOf(intent.getParcelableExtra(Intent.EXTRA_STREAM));
        }
        if (text != null) {
          org.json.JSONObject o = new org.json.JSONObject();
          o.put("type", "share");
          o.put("title", subject == null ? "shared" : subject.toString());
          o.put("text", text.toString());
          json = o.toString();
        }
      } else if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
        org.json.JSONObject o = new org.json.JSONObject();
        o.put("type", "link");
        o.put("url", intent.getData().toString());
        json = o.toString();
      }
    } catch (Exception ignored) {
      return;
    }
    if (json != null) {
      if (pageReady) js("window.dahatOnIntent && window.dahatOnIntent(" + JSONObjectLite.quote(json) + ")");
      else queuedIntents.add(json);
    }
  }

  private void flushIntents() {
    for (String json : queuedIntents) {
      js("window.dahatOnIntent && window.dahatOnIntent(" + JSONObjectLite.quote(json) + ")");
    }
    queuedIntents.clear();
  }

  void js(String script) {
    if (web == null) return;
    web.evaluateJavascript(script, null);
  }

  void applyEdgeToEdge() {
    Window w = getWindow();
    w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
    w.setStatusBarColor(Color.TRANSPARENT);
    w.setNavigationBarColor(Color.TRANSPARENT);
    if (Build.VERSION.SDK_INT >= 27) w.getDecorView().setSystemUiVisibility(
        w.getDecorView().getSystemUiVisibility() & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
    w.getDecorView().setSystemUiVisibility(flags);
    if (Build.VERSION.SDK_INT >= 28) {
      w.getDecorView().setSystemUiVisibility(flags | View.SYSTEM_UI_FLAG_VISIBLE);
      w.setNavigationBarDividerColor(Color.TRANSPARENT);
    }
  }

  /** dark/light system-bar icon colour follows the OS theme through the bridge */
  void setBarAppearance(boolean lightBackground, int background) {
    Window w = getWindow();
    w.setStatusBarColor(background);
    w.setNavigationBarColor(background);
    int vis = w.getDecorView().getSystemUiVisibility();
    if (lightBackground) vis |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
    else vis &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
    if (Build.VERSION.SDK_INT >= 27) {
      if (lightBackground) vis |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
      else vis &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
    }
    w.getDecorView().setSystemUiVisibility(vis);
  }

  void keepScreenOn(boolean on) {
    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }

  void ensureChannels() {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (nm == null) return;
    NotificationChannel os = new NotificationChannel(CHANNEL_OS, getString(R.string.notif_channel_os), NotificationManager.IMPORTANCE_DEFAULT);
    os.setDescription(getString(R.string.notif_channel_os_desc));
    os.setShowBadge(true);
    nm.createNotificationChannel(os);
    NotificationChannel alarm = new NotificationChannel(CHANNEL_ALARM, getString(R.string.notif_channel_alarm), NotificationManager.IMPORTANCE_HIGH);
    alarm.setDescription(getString(R.string.notif_channel_alarm_desc));
    alarm.enableVibration(true);
    alarm.setVibrationPattern(new long[]{0, 420, 220, 420, 220, 700});
    alarm.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
    try {
      alarm.setSound(android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM), null);
    } catch (Exception ignored) {
      // no alarm tone on this device: the default channel sound is used
    }
    nm.createNotificationChannel(alarm);
  }

  boolean isDebuggable() {
    try {
      return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    } catch (Exception e) {
      return false;
    }
  }

  /** tiny helper so we never hand-build JS string literals badly */
  static final class JSONObjectLite {
    static String quote(String raw) {
      StringBuilder sb = new StringBuilder("'");
      for (int i = 0; i < raw.length(); i++) {
        char c = raw.charAt(i);
        switch (c) {
          case '\'': sb.append("\\'"); break;
          case '\\': sb.append("\\\\"); break;
          case '\n': sb.append("\\n"); break;
          case '\r': sb.append("\\r"); break;
          case '\u2028': case '\u2029': sb.append(' '); break;  // illegal in JS literals
          default:
            if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
            else sb.append(c);
        }
      }
      return sb.append('\'').toString();
    }
  }
}
