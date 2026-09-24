#!/usr/bin/env bash
# Copy the latest web terminal from the main CryptoAI PRO repo into app/.
#
# The terminal lives in Rusindu12/1 under crypto-app/app/src/main/assets/ — the
# exact files the Android APK ships and that https://rusindu12.github.io/1/app/
# serves. This site hosts an identical copy, so re-run this after every release
# there, check the diff, commit and push to main (the Pages workflow deploys it).
#
# Usage:  tools/sync-app.sh [git-ref]      (default: main)
set -euo pipefail

REF="${1:-main}"
SRC_REPO="https://github.com/Rusindu12/1.git"
ASSETS="crypto-app/app/src/main/assets"
FILES=(index.html ta.js patterns.js brain.js app.js sysmgmt.js worker.js)

cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git clone --quiet --depth 1 --branch "$REF" --filter=blob:none --sparse "$SRC_REPO" "$tmp/src"
git -C "$tmp/src" sparse-checkout set "$ASSETS"
rev="$(git -C "$tmp/src" rev-parse --short HEAD)"

for f in "${FILES[@]}"; do
  test -s "$tmp/src/$ASSETS/$f" || { echo "missing $ASSETS/$f in Rusindu12/1@$rev" >&2; exit 1; }
  cp "$tmp/src/$ASSETS/$f" "app/$f"
done

echo "app/ synced from Rusindu12/1@$rev ($REF)"

# a new script in app/index.html must also be precached by sw.js — check-site.py only
# verifies that listed files exist, so warn about unlisted ones here
for s in $(grep -o '<script src="[^"]*"' app/index.html | sed 's/<script src="//;s/"$//'); do
  grep -q "\"./app/$s\"" sw.js || echo "WARNING: app/$s is not in the SHELL list in sw.js (add it for offline use)"
done

python3 tools/check-site.py
echo "Next: bump VERSION in sw.js so installed copies refresh, then commit + push to main."
