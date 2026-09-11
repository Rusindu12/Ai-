# AI Crypto Trading — Android APK

This folder wraps the Next.js dashboard in **Capacitor** so it ships as a native
Android app (`app-debug.apk` / `app-release.apk`).

The app is the exact same trading dashboard as the web version, running inside a
native WebView. Live prices, charts, AI signals, paper trading, order book and
settings all work the same way.

---

## How the app connects to the backend

The APK does **not** have its own backend — it talks to the same Node.js
backend as the web app, over HTTP(S) + WebSockets. The backend URL is resolved
in this order:

1. **Runtime override** — open the app → ⚙ Settings → *Server* → enter
   `https://your-backend.example.com` and tap *Save*. Stored on the device.
2. **Build-time default** — `NEXT_PUBLIC_API_URL` set when building the bundle
   (the CI workflow reads the `BACKEND_URL` repository variable).
3. If neither is set, the app tries same-origin (only useful for the web build).

> Point the app at a **deployed** backend reachable from the phone (a public
> HTTPS URL, or `http://<your-LAN-ip>:4000` for local testing on the same
> network).

---

## Option A — Build the APK on GitHub (recommended, no local Android setup)

The repo includes a workflow at `.github/workflows/build-apk.yml`.

1. Push the code to GitHub (any branch).
2. *(Optional)* Add a repository **variable** named `BACKEND_URL` with your
   backend URL (repo → Settings → Secrets and variables → Actions → Variables).
3. Open the **Actions** tab → *Build Android APK* → **Run workflow**.
4. When it finishes, download the artifact **ai-crypto-trading-debug**
   (`app-debug.apk`) from the run summary.

## Option B — Build locally

Requirements: Node 20, JDK 17, Android SDK (or Android Studio), and an
`ANDROID_HOME` pointing at the SDK.

```bash
# 1. Build the web bundle as a static export
cd frontend
NEXT_STATIC_EXPORT=true NEXT_PUBLIC_API_URL=https://your-backend.example.com npm run build

# 2. Copy it into the Android project
cd ../mobile
npm install
npx cap copy android

# 3. Build the APK
cd android
./gradlew assembleDebug          # debug build (for testing)
# ./gradlew assembleRelease      # release build (needs signing config)
```

Output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

Install it on a phone with:

```bash
adb install mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Project layout

```
mobile/
  package.json             Capacitor CLI + android platform dependency
  capacitor.config.json    appId, app name, webDir -> ../frontend/out
  android/                 generated native project (gradle, manifest, icons)
```

- App ID: `com.rusindu.aicrypto` (change in `capacitor.config.json` + rebuild if
  you publish your own build).
- App name: **AI Crypto Trading**.
- The generated Android project is committed so builds are reproducible and the
  CI workflow does not need Capacitor to regenerate it.

---

## Signing a release build (Play Store)

A debug APK is fine for personal/testing use. To publish, create a keystore and
configure signing in `mobile/android/app/build.gradle`:

```gradle
android {
  signingConfigs {
    release {
      storeFile file("release.keystore")
      storePassword System.getenv("KEYSTORE_PASSWORD")
      keyAlias "upload"
      keyPassword System.getenv("KEY_PASSWORD")
    }
  }
  buildTypes {
    release {
      signingConfig signingConfigs.release
      minifyEnabled true
      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
  }
}
```

Then: `./gradlew assembleRelease`.
