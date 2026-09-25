# Getting the v50 app fixes into the APK (Rusindu12/1)

The web terminal in `app/` is the same code the Android app ships
(`crypto-app/app/src/main/assets/` in [Rusindu12/1](https://github.com/Rusindu12/1)).
A full check of v49 found bugs in paper trading, the bot and — in the APK only — live
trading. They are fixed in `app/` here, and the APK this repo builds
(`.github/workflows/apk.yml`) already has them. Rusindu12/1's own APK and its site
(rusindu12.github.io/1/) get them once Rusindu12/1 has the same files.
`v50-app-fixes.patch` does exactly that, made against Rusindu12/1@666ccd0:

- `crypto-app/app/src/main/assets/` and `web/app/`: `app.js`, `brain.js`, `index.html`,
  `sysmgmt.js`, `ta.js` (afterwards byte-identical to `app/` here)
- `tools/app-tests.js`: the regression tests for these fixes (33 checks, plain `node`)
- `crypto-app/app/build.gradle.kts`: versionCode 50 / versionName 50.0

## Apply it

With git, in a clone of Rusindu12/1:

```bash
curl -LO https://raw.githubusercontent.com/Rusindu12/Ai-/main/tools/upstream/v50-app-fixes.patch
git apply v50-app-fixes.patch
node tools/app-tests.js && node tools/regression.js     # both must pass
git commit -am "app v50: fixes from the v49 audit" && git push
```

The push triggers the APK workflow there, which publishes the new build to Rusindu12/1's
`cryptoai-apk-latest` release (the download buttons on rusindu12.github.io/1/ point there;
this repo's site links to its own build).

Without git: copy those five files from `app/` in this repo into
`crypto-app/app/src/main/assets/` (and `web/app/`) in Rusindu12/1 and change
`versionCode = 49` to `50` in `crypto-app/app/build.gradle.kts`.

After that `tools/sync-app.sh` works again (it refuses to run while Rusindu12/1 is
missing these fixes, so a sync can't undo them — `FORCE=1` overrides).

## Not in the patch — Android shell, for the owner to decide

Found in the same check; these need Kotlin / Gradle / signing changes that can't be
built or tested from here:

1. **Every CI build is signed with a new debug key.** The workflow runs `assembleDebug`
   on a fresh runner and never stores a keystore, so each APK very likely has a
   different signature — Android then refuses to install it over the previous one
   ("App not installed"), and uninstalling first wipes the paper account, the brain and
   the saved keys. Fix: create one release keystore, keep it in repository secrets and
   sign every build with it.
2. **Debug build + plain-text keys.** A debug APK is debuggable (WebView debugging on),
   and the exchange API key and secret sit unencrypted in SharedPreferences with
   `allowBackup` left on — anyone with the phone and a USB cable can read them. Fix: a
   release build, `EncryptedSharedPreferences` (or the Android Keystore) for the keys,
   `android:allowBackup="false"`.
3. `usesCleartextTraffic="true"`, `MIXED_CONTENT_ALWAYS_ALLOW` and an
   `onPermissionRequest` that grants everything are wider than the app needs.
4. The APK workflow runs on pushes to **any** branch and uploads to the same "latest"
   release, so an unfinished branch replaces the public download (the release notes
   say "Auto-built from main").
5. **Export / import do nothing in the APK.** The WebView has no `DownloadListener` and
   the `WebChromeClient` no `onShowFileChooser`, so on the phone the System → Files buttons
   (Trades CSV, Settings backup, Activity log, Signal report, Import settings) have no
   effect; they work in the web app. Fix: a `DownloadListener` that saves `blob:` downloads
   (or a bridge method that writes the file through MediaStore) plus `onShowFileChooser`.
6. Design choice worth a second look: bot trades are never sold at a loss in either exit
   mode (v44). In "Classic" mode the bot's SL field therefore does nothing below the
   minimum profit and the daily-loss stop can't trigger from bot trades; a coin that
   keeps falling is held indefinitely (the max-hold brake exists only in the min-profit
   mode). Live positions in Classic mode *do* sell at the SL — the two modes disagree.
