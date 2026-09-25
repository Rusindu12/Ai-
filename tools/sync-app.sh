#!/usr/bin/env bash
# Copy the latest web terminal from the main CryptoAI PRO repo into app/.
#
# The terminal lives in Rusindu12/1 under crypto-app/app/src/main/assets/ — the
# exact files the Android APK ships and that https://rusindu12.github.io/1/app/
# serves. This site hosts an identical copy, so re-run this after every release
# there, check the diff, commit and push to main (the Pages workflow deploys it).
#
# Usage:  tools/sync-app.sh [git-ref]      (default: main)
#
# v50 note: app/ here carries the fixes from the v49 audit (tools/upstream/README.md).
# Until Rusindu12/1 has them too, a sync would silently undo them — the script stops
# in that case. Apply tools/upstream/v50-app-fixes.patch in Rusindu12/1 first, or run
# with FORCE=1 to overwrite anyway.
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

# don't throw away the v50 fixes if the source does not have them yet
if grep -q "function paperSellQty" app/app.js && ! grep -q "function paperSellQty" "$tmp/src/$ASSETS/app.js" && [ "${FORCE:-0}" != "1" ]; then
  echo "Rusindu12/1@$rev does not have the v50 app fixes that app/ has — syncing would undo them." >&2
  echo "Apply tools/upstream/v50-app-fixes.patch in Rusindu12/1 first (see tools/upstream/README.md)," >&2
  echo "or run FORCE=1 tools/sync-app.sh to overwrite app/ anyway." >&2
  exit 1
fi

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
node tools/app-tests.js >/dev/null && echo "app regression tests: pass" || echo "WARNING: tools/app-tests.js fails on the synced app — check before pushing"
echo "Next: bump VERSION in sw.js so installed copies refresh, then commit + push to main."
