#!/usr/bin/env python3
"""Generate the launcher icons (legacy densities) and the store icon.

No Flutter/Android SDK needed - pure Pillow. Run from the app folder:

    python tooling/make_icons.py

The adaptive (API 26+) icon lives in res/mipmap-anydpi-v26 and is a vector,
so it adds no bytes. These PNGs only cover API 24-25 and the Play listing.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android" / "app" / "src" / "main" / "res"

BG = (11, 18, 32)          # #0B1220
BG2 = (17, 27, 46)
GREEN = (16, 185, 129)      # #10B981
BLUE = (56, 189, 248)       # #38BDF8
AMBER = (245, 158, 11)      # #F59E0B
RED = (244, 63, 94)


def _round_rect(d: ImageDraw.ImageDraw, box, radius, fill):
    d.rounded_rectangle(box, radius=radius, fill=fill)


def render(size: int, *, mask_square: bool = True) -> Image.Image:
    """Render the icon at ``size`` px. Legacy launchers want a full-bleed square
    with the glyph inside the safe zone; adaptive icons are handled in XML."""
    s = max(size, 48) * 4  # supersample for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if mask_square:
        _round_rect(d, (0, 0, s - 1, s - 1), int(s * 0.18), BG)
        # subtle vertical gradient
        for i in range(s // 2):
            alpha = int(28 * (1 - i / (s / 2)))
            d.line([(0, i), (s, i)], fill=(255, 255, 255, alpha))
    else:
        d.rectangle((0, 0, s, s), fill=BG)

    u = s / 108.0  # design unit, same proportions as the adaptive vector

    # Candles: body rectangles + wicks.
    candles = [
        (30, 74, 22, GREEN),
        (46, 68, 32, GREEN),
        (62, 72, 18, BLUE),
    ]
    for x, bottom, height, colour in candles:
        cx = x * u + 4 * u
        top = (bottom - height) * u
        # wick
        d.line([(cx, (bottom - height - 6) * u), (cx, (bottom + 6) * u)], fill=colour, width=max(1, int(3 * u)))
        # body
        _round_rect(d, (x * u, top, (x + 8) * u, bottom * u), 2 * u, colour)

    # Trend line.
    pts = [(26, 66), (46, 52), (58, 58), (82, 34)]
    d.line([(px * u, py * u) for px, py in pts], fill=AMBER, width=max(2, int(4.5 * u)), joint="curve")
    for px, py in pts:
        r = 3.4 * u
        d.ellipse([px * u - r, py * u - r, px * u + r, py * u + r], fill=AMBER)

    # "AI" spark dot in the corner
    r = 5 * u
    cx, cy = 84 * u, 22 * u
    for k in range(6):
        a = k / 6 * 2 * math.pi
        d.line([(cx, cy), (cx + r * math.cos(a), cy + r * math.sin(a))], fill=(255, 255, 255, 150), width=max(1, int(1.6 * u)))

    out = img.resize((size, size), Image.LANCZOS)
    return out


def main() -> None:
    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for name, px in densities.items():
        folder = RES / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        icon = render(px)
        icon.save(folder / "ic_launcher.png")
        icon.save(folder / "ic_launcher_round.png")
        print(f"wrote {folder.relative_to(ROOT)}/ic_launcher.png ({px}px)")

    (ROOT / "assets" / "images").mkdir(parents=True, exist_ok=True)
    render(512).save(ROOT / "assets" / "images" / "app_icon_512.png")
    render(1024).save(ROOT / "assets" / "images" / "app_icon_master.png")
    print("wrote assets/images/app_icon_512.png + app_icon_master.png")


if __name__ == "__main__":
    main()
