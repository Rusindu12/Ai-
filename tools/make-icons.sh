#!/usr/bin/env bash
# tools/make-icons.sh — regenerate the Dahat launcher icons.
# Master artwork is the hand-written SVG next to it; PNGs are rasterised with
# ImageMagick so the OS itself keeps zero build steps.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=os/assets/img
mkdir -p "$OUT"

D_OUTER="M 140 118 L 256 118 C 372 118 418 194 418 256 C 418 318 372 394 256 394 L 140 394 Z"
D_HOLE="M 208 190 L 252 190 C 318 190 350 216 350 256 C 350 296 318 322 252 322 L 208 322 Z"

convert -size 512x512 xc:none \
  -fill '#0a1620' -draw "roundrectangle 12,12,500,500,124,124" \
  -fill '#26e8c8' -draw "path '$D_OUTER'" \
  -fill '#0a1620' -draw "path '$D_HOLE'" \
  -fill '#eafdf9' -draw "circle 404,116 432,116" \
  "$OUT/icon-512.png"

for s in 192 96 32 180; do
  convert "$OUT/icon-512.png" -resize ${s}x${s} \
    "$OUT/$([ $s = 180 ] && echo apple-touch-icon.png || ([ $s = 32 ] && echo favicon.png || echo icon-$s.png))"
done

# maskable: full-bleed background, mark inside the 80% safe zone
convert -size 512x512 xc:'#053b35' \
  -fill '#26e8c8' -draw "path 'M 176 166 L 262 166 C 350 166 382 214 382 256 C 382 298 350 346 262 346 L 176 346 Z'" \
  -fill '#053b35' -draw "path 'M 228 214 L 258 214 C 306 214 330 232 330 256 C 330 280 306 298 258 298 L 228 298 Z'" \
  "$OUT/maskable-512.png"

identify -format "  %f  %wx%h\n" "$OUT"/*.png | sort
echo "icons written to $OUT"
