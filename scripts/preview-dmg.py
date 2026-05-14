#!/usr/bin/env python3
"""Render a realistic preview of the DMG installer window.

Composites the actual tellaflow icon and a stand-in Applications folder icon
on top of the @2x background at the positions configured in
electron-builder.yml. Output: build/dmg-preview.png.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BG = ROOT / "build" / "background@2x.png"
ICON_SRC = Path("/tmp/tellaflow-icon/tellaflow.iconset/icon_256x256@2x.png")
OUT = ROOT / "build" / "dmg-preview.png"

SCALE = 2
ICON_LOGICAL = 100  # matches dmg.iconSize in electron-builder.yml
ICON_PX = ICON_LOGICAL * SCALE  # 200 px on 2x canvas
LABEL_GAP = 8 * SCALE


def folder_icon(size: int) -> Image.Image:
    """Crude but recognizable macOS-style Applications folder icon."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Back tab
    pad = size * 0.08
    tab_h = size * 0.18
    body_top = pad + tab_h * 0.55
    d.rounded_rectangle(
        [pad, pad + tab_h * 0.05, pad + size * 0.45, pad + tab_h + tab_h * 0.05],
        radius=size * 0.05,
        fill=(110, 175, 235, 255),
    )
    # Body
    d.rounded_rectangle(
        [pad, body_top, size - pad, size - pad],
        radius=size * 0.09,
        fill=(140, 200, 245, 255),
    )
    # "A" glyph
    try:
        font = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", int(size * 0.55))
    except OSError:
        font = ImageFont.load_default()
    text = "A"
    tw = d.textlength(text, font=font)
    d.text(
        ((size - tw) / 2, size * 0.18),
        text,
        fill=(255, 255, 255, 230),
        font=font,
    )
    return img


def draw_label(draw: ImageDraw.ImageDraw, cx: int, top_y: int, text: str):
    try:
        font = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", int(13 * SCALE))
    except OSError:
        font = ImageFont.load_default()
    tw = draw.textlength(text, font=font)
    draw.text(
        (cx - tw / 2, top_y),
        text,
        fill=(40, 40, 40, 230),
        font=font,
    )


def main() -> None:
    bg = Image.open(BG).convert("RGBA")
    canvas = bg.copy()

    # Slots from electron-builder.yml
    slots = [
        (165 * SCALE, 200 * SCALE, "Tellaflow"),
        (435 * SCALE, 200 * SCALE, "Applications"),
    ]

    # App icon
    app = Image.open(ICON_SRC).convert("RGBA").resize((ICON_PX, ICON_PX), Image.LANCZOS)
    canvas.alpha_composite(app, (slots[0][0] - ICON_PX // 2, slots[0][1] - ICON_PX // 2))

    # Applications folder
    folder = folder_icon(ICON_PX)
    canvas.alpha_composite(folder, (slots[1][0] - ICON_PX // 2, slots[1][1] - ICON_PX // 2))

    # Labels
    d = ImageDraw.Draw(canvas)
    for cx, cy, label in slots:
        draw_label(d, cx, cy + ICON_PX // 2 + LABEL_GAP, label)

    # Fake macOS window chrome (titlebar) for realism
    chrome = Image.new("RGBA", (canvas.width, 28 * SCALE), (240, 240, 240, 255))
    cd = ImageDraw.Draw(chrome)
    # Traffic lights
    for i, col in enumerate(((255, 95, 86), (255, 189, 46), (39, 201, 63))):
        cx = (16 + i * 20) * SCALE
        cy = 14 * SCALE
        r = 6 * SCALE
        cd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    # Title
    try:
        font = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", int(12 * SCALE))
    except OSError:
        font = ImageFont.load_default()
    title = "Tellaflow Installer"
    tw = cd.textlength(title, font=font)
    cd.text(((canvas.width - tw) / 2, 7 * SCALE), title, fill=(60, 60, 60, 255), font=font)

    final = Image.new("RGBA", (canvas.width, canvas.height + chrome.height), (255, 255, 255, 0))
    final.paste(chrome, (0, 0))
    final.paste(canvas, (0, chrome.height))
    final.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({final.width}x{final.height})")


if __name__ == "__main__":
    main()
