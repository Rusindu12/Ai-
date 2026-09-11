#!/usr/bin/env bash
# Local APK build helper.
# Usage:
#   ./build_apk.sh [backend_url]
#
# backend_url is optional and baked in as the default backend (can still be
# overridden at runtime in the app's Settings).

set -euo pipefail
cd "$(dirname "$0")"

BACKEND_URL="${1:-${NEXT_PUBLIC_API_URL:-}}"

echo "==> Building web bundle (static export)…"
(
  cd ../frontend
  NEXT_STATIC_EXPORT=true \
  NEXT_PUBLIC_API_URL="$BACKEND_URL" \
    npm run build
)

echo "==> Copying web assets into the Android project…"
npx cap copy android

echo "==> Assembling debug APK…"
(
  cd android
  ./gradlew assembleDebug --no-daemon
)

APK="$(pwd)/android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "✅ APK built: $APK"
echo "Install with: adb install \"$APK\""
