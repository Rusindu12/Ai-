# Dahat OS — the Android launcher

A real, installable `.apk` that turns the phone's home screen into Dahat OS. It is
an ordinary Android app on purpose: `minSdk 24`, no root, no custom recovery, no
dangerous permissions. Setting it as the default Home app is the only step, and
uninstalling (or switching Home back) removes everything cleanly.

## What the host actually is

```
MainActivity (1 activity, 1 WebView)
  ├── WebViewAssetLoader     serves os/ from https://appassets.androidplatform.net/os/
  ├── DahatBridge            ~15 @JavascriptInterface methods (below)
  ├── AlarmReceiver          AlarmManager → notification + full-screen hand-back
  └── AndroidManifest        HOME · LAUNCHER · SEND · dahat://  intent filters
```

Serving the assets from an `https://` origin (instead of `file://`) is what makes
`localStorage`, the Wake Lock API, `getUserMedia`, clipboard writes and
`navigator.share` behave like they do on the deployed PWA — with no network and
no server. `setAllowFileAccess(false)` keeps `file://` closed.

`os/` is **not** duplicated in git: `syncOsAssets` (a Gradle `Copy` task wired
into `preBuild`) mirrors `../../os` into `app/src/main/assets/os` on every build,
and that directory is git-ignored. An APK can therefore never ship a stale OS, and
`sw.js` is excluded because a WebView has no service workers.

## The bridge — the whole privileged surface

| JS call (from `ctx.api` / shell) | Java | Android API |
| --- | --- | --- |
| `DahatBridge.info()` | device + build identity as JSON | `PackageManager`, `Build` |
| `DahatBridge.battery()` | level, charging, plug type, temperature, health | `ACTION_BATTERY_CHANGED` sticky intent |
| `DahatBridge.vibrate('[10,40,10]')` | haptics, one-shot or waveform | `Vibrator` / `VibrationEffect` |
| `DahatBridge.keepAwake(bool)` | screen stays on while an app holds the OS wakelock | `FLAG_KEEP_SCREEN_ON` |
| `DahatBridge.setSystemBars(json)` | status/nav bar colour + icon contrast follow the theme | `Window`, `SYSTEM_UI_FLAG_LIGHT_*` |
| `DahatBridge.notify(json)` | posts into the OS shade (channels `dahat.os`, `dahat.alarm`) | `NotificationCompat` |
| `DahatBridge.cancelNotification(id)` | keeps both shelves in sync | `NotificationManager` |
| `DahatBridge.share(json)` | Share sheet for text a note/file app hands out | `ACTION_SEND` |
| `DahatBridge.openUrl(url)` | links an app explicitly opened | `ACTION_VIEW` |
| `DahatBridge.dial(number)` | the Phone app's dial pad, no call permission taken | `ACTION_DIAL` |
| `DahatBridge.setWallpaper(dataUrl)` | Gallery ▸ "set as wallpaper" writes the *device* wallpaper | `WallpaperManager` |
| `DahatBridge.scheduleAlarm(json)` / `cancelAlarm(key)` | alarms that outlive the OS | `AlarmManager.setExactAndAllowWhileIdle` |
| `DahatBridge.requestIgnoreBatteryOptimizations()` | asks the user to exempt Dahat from Doze (for alarms) | `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` |
| `DahatBridge.exitLauncher()` | "Reboot to Android" in Quick Settings opens the Home-app picker | `Settings.ACTION_HOME_SETTINGS` |

`onPermissionRequest` maps `RESOURCE_VIDEO_CAPTURE`/`_AUDIO_CAPTURE` to real
Android camera/microphone runtime permissions, and `onShowFileChooser` lets
`<input type=file>` in Files pull a document into the OS.

Back / HOME are routed into the OS rather than killing it:

```java
web.evaluateJavascript("window.dahatOnBack ? (window.dahatOnBack() === true) : false", value -> {
  if (!"true".equals(value)) moveTaskToBack(true);   // nothing consumed it → behave like HOME
});
```

and `onResume` calls `window.dahatOnResume()`, `onPause` freezes the renderer
(`pauseTimers()`) so a home screen replacement does not burn CPU in a pocket.

## Alarms, the one place the OS keeps running without you

```
Clock app ──ctx.api.app.setAlarm()──▶ kernel (checks the `alarm` capability)
   └──▶ DahatBridge.scheduleAlarm(json) ──▶ AlarmManager.setExactAndAllowWhileIdle
                                                   │ (fires even with the OS closed)
                                                   ▼
                              AlarmReceiver → notification on the dahat.alarm channel
                                · alarm tone + vibration pattern, bypasses Doze
                                · tap → MainActivity with "dahatIntent" extra
                                · window.dahatOnIntent({type:'alarm', key, label})
                                · full-screen intent wakes the phone into the OS
```

`canScheduleExactAlarms()` decides exact vs `setAndAllowWhileIdle`, so a denied
"alarm & reminders" permission degrades to a five-minute-accurate alarm instead of
throwing. The Clock row shows `⏰ armed in Android` when the host took it, which
is the whole point: the app never claims a wake-up it cannot deliver.

## Build it

CI does it — `.github/workflows/build-apk.yml`: OS self-test + headless app smoke
first, then `gradle :app:assembleDebug :app:assembleRelease :app:bundleRelease`
with JDK 17, `compileSdk 34`, Gradle 8.7, and a release signing key from secrets
(or a freshly generated one, attached as an artefact so you can keep it).
Artefacts: `DahatOS.apk`, `DahatOS-debug.apk`, `DahatOS.aab`, `CHECKSUMS.txt`.

Locally, with an Android SDK installed:

```bash
cd android
gradle :app:assembleDebug            # no wrapper jar is committed on purpose
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Install the release build and keep the key if you want upgrades:

```bash
keytool -genkeypair -keystore dahat-release.keystore -alias dahat \
  -keyalg RSA -keysize 2048 -validity 10950
base64 -w0 dahat-release.keystore          # → repo secret DAHAT_KEYSTORE_B64
```

Then set `DAHAT_KEYSTORE_PASSWORD`, `DAHAT_KEY_ALIAS`, `DAHAT_KEY_PASSWORD` and
re-run the workflow. Without those secrets CI signs with a temporary key, so
Android will require an uninstall before you can install the next build.

## Setting it as Home

1. install the APK, allow "install unknown apps" for your browser/file manager
2. press Home → the picker appears → **Dahat OS** → *Always*
   (or: System Settings ▸ Apps ▸ Default home app)
3. to get Android's launcher back: Quick Settings ▸ Power ▸ "Reboot to Android"
   inside Dahat opens that very picker

Lock screen PIN, wallpaper and language are all inside the OS; the host stays
transparent (`SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN`, translucent system bars).

## What it is not

No kernel, no HAL, no RIL, no AOSP tree: the phone still runs Android underneath,
and Dahat replaces the *environment on top of it* — launcher, window manager,
apps, permissions, storage, settings, lock screen. `docs/roadmap-real-os.md`
says what a real fork would take.
