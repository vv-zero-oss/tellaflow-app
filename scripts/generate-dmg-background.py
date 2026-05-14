#!/usr/bin/env python3
"""Generate the DMG installer background images.

Produces build/background.png (1x: 600x420) and build/background@2x.png
(2x: 1200x840). electron-builder picks the @2x asset automatically on
Retina displays.

Design: warm cream gradient, brand-orange curved arrow between the app
icon and the Applications folder, with a soft row of voice/dictation
line-art icons across the bottom.
"""
from __future__ import annotations

import math
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "build"

# Logical (1x) window in points; @2x is doubled.
W_LOGICAL, H_LOGICAL = 600, 420
SCALE = 2
W, H = W_LOGICAL * SCALE, H_LOGICAL * SCALE

# Brand palette
BG_TOP = (255, 247, 241)      # #FFF7F1
BG_BOTTOM = (254, 237, 223)   # #FEEDDF
ORANGE = (234, 82, 40)        # #EA5228 (brand)
ORANGE_SOFT = (234, 82, 40, 14)   # ~5% alpha — very subtle glow
ORANGE_HAIR = (234, 82, 40, 48)   # ~19% alpha (line art)
ORANGE_MID = (234, 82, 40, 140)   # arrow body — muted


# ---------- helpers ---------------------------------------------------------

def make_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size, top)
    px = img.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        r = round(top[0] + (bottom[0] - top[0]) * t)
        g = round(top[1] + (bottom[1] - top[1]) * t)
        b = round(top[2] + (bottom[2] - top[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return img


def hairline(draw: ImageDraw.ImageDraw, points, width: int, color):
    """Smooth polyline with rounded joins."""
    draw.line(points, fill=color, width=width, joint="curve")


# ---------- arrow -----------------------------------------------------------

def draw_arrow(canvas: Image.Image):
    """WhatsApp-style swoosh: tapered chunky filled curve that fades in from
    the tail and ends in a fat triangular head. Brand-orange.

    Built as a single closed polygon at 2× super-sample so the curved edges
    and back corners of the head antialias cleanly when downsampled.
    """
    SS = 2  # super-sample factor for crisp polygon edges
    sw = canvas.width * SS
    sh = canvas.height * SS
    layer = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # Curve endpoints (in super-sampled px).
    cx_left = 230 * SCALE * SS
    cx_right = 370 * SCALE * SS
    cy = 200 * SCALE * SS

    # Gentle quadratic arch.
    p0 = (cx_left, cy)
    p1 = ((cx_left + cx_right) / 2, cy - 26 * SCALE * SS)
    p2 = (cx_right, cy)

    samples = 220
    pts = []
    normals = []  # unit perpendicular at each sample
    for i in range(samples + 1):
        t = i / samples
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
        # First derivative for tangent.
        dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])
        dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])
        L = math.hypot(dx, dy) or 1.0
        # Rotate tangent 90° CCW to get the "up" normal.
        nx, ny = -dy / L, dx / L
        pts.append((x, y))
        normals.append((nx, ny))

    # Head occupies the last ~13% of the curve.
    head_idx = int(samples * 0.87)

    # Tapered shaft widths (super-sample px).
    shaft_w0 = 0.8 * SCALE * SS   # at the tail — almost a point
    shaft_w1 = 5.0 * SCALE * SS   # at the base of the head
    head_half = 9.0 * SCALE * SS   # wing extent at base of head

    # Top + bottom shaft edges.
    top = []
    bot = []
    for i in range(head_idx + 1):
        t = i / head_idx
        # Ease-in so the tail stays slim for longer, then fattens toward head.
        ease = t ** 1.4
        w = shaft_w0 + (shaft_w1 - shaft_w0) * ease
        x, y = pts[i]
        nx, ny = normals[i]
        top.append((x + nx * w / 2, y + ny * w / 2))
        bot.append((x - nx * w / 2, y - ny * w / 2))

    # Arrowhead wings at head_idx, tip at end of curve.
    base_x, base_y = pts[head_idx]
    nx_h, ny_h = normals[head_idx]
    wing_top = (base_x + nx_h * head_half, base_y + ny_h * head_half)
    wing_bot = (base_x - nx_h * head_half, base_y - ny_h * head_half)
    tip = pts[-1]
    # Push the tip slightly forward along the tangent so the head reads sharp.
    tan_x = pts[-1][0] - pts[-3][0]
    tan_y = pts[-1][1] - pts[-3][1]
    L = math.hypot(tan_x, tan_y) or 1.0
    tip = (tip[0] + tan_x / L * 2 * SCALE * SS, tip[1] + tan_y / L * 2 * SCALE * SS)

    poly = top + [wing_top, tip, wing_bot] + list(reversed(bot))
    d.polygon(poly, fill=(ORANGE[0], ORANGE[1], ORANGE[2], 255))

    # Downsample to canvas resolution — gives smooth antialiased edges.
    layer = layer.resize(canvas.size, Image.LANCZOS)

    # Horizontal alpha gradient: tail fades in from transparent → ~75% opacity.
    grad = Image.new("L", canvas.size, 0)
    gpx = grad.load()
    fade_end = int(canvas.width * 0.42)  # tail fade-in ends here
    plateau = 195                          # max opacity multiplier (~76%)
    for x in range(canvas.width):
        if x < fade_end:
            t = x / max(fade_end, 1)
            # Smoothstep for a gentle curve.
            t = t * t * (3 - 2 * t)
            v = int(plateau * t)
        else:
            v = plateau
        for y in range(canvas.height):
            gpx[x, y] = v

    r, g, b, a = layer.split()
    a = ImageChops.multiply(a, grad)
    layer = Image.merge("RGBA", (r, g, b, a))

    canvas.alpha_composite(layer)

    canvas.alpha_composite(layer)


# ---------- bottom illustrations -------------------------------------------
# A scattered band of Lucide icons + decorative bubbles, rendered from SVG
# via Node (scripts/build-dmg-decorations.mjs) and rasterized with macOS
# `sips`. The Node script ensures we use real Lucide path data; doing the
# scatter as SVG keeps it sharp at any size. sips preserves alpha (qlmanage
# flattens to white), which is essential for layering on the cream gradient.


def render_decorations(target_w: int, target_h: int) -> Image.Image:
    """Generate the bottom-band Lucide-icon scatter as an RGBA layer."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    svg_path = OUT_DIR / "_dmg-decorations.svg"
    png_path = OUT_DIR / "_dmg-decorations.png"

    subprocess.run(
        [
            "node",
            str(ROOT / "scripts" / "build-dmg-decorations.mjs"),
            str(target_w),
            str(target_h),
            str(svg_path),
        ],
        check=True,
    )
    if png_path.exists():
        png_path.unlink()
    subprocess.run(
        ["sips", "-s", "format", "png", str(svg_path), "--out", str(png_path)],
        check=True,
        capture_output=True,
    )
    img = Image.open(png_path).convert("RGBA")
    if img.size != (target_w, target_h):
        img = img.resize((target_w, target_h), Image.LANCZOS)
    # Clean up intermediates so they don't ship with the DMG.
    png_path.unlink(missing_ok=True)
    svg_path.unlink(missing_ok=True)
    return img


# ---------- compose ---------------------------------------------------------

def build_image() -> Image.Image:
    base = make_gradient((W, H), BG_TOP, BG_BOTTOM).convert("RGBA")

    # Very soft, blurred orange "glow" behind each icon slot — adds warmth
    # without competing with the actual icons that macOS will composite on top.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for cx_logical in (165, 435):
        cx = cx_logical * SCALE
        cy = 200 * SCALE
        r = 110 * SCALE
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ORANGE_SOFT)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=60 * SCALE / 2))
    base.alpha_composite(glow)

    draw_arrow(base)
    base.alpha_composite(render_decorations(W, H))
    return base


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    img2x = build_image()
    img1x = img2x.resize((W_LOGICAL, H_LOGICAL), Image.LANCZOS)

    out_1x = OUT_DIR / "background.png"
    out_2x = OUT_DIR / "background@2x.png"
    img1x.convert("RGB").save(out_1x, "PNG", optimize=True)
    img2x.convert("RGB").save(out_2x, "PNG", optimize=True)
    print(f"wrote {out_1x.relative_to(ROOT)} ({W_LOGICAL}x{H_LOGICAL})")
    print(f"wrote {out_2x.relative_to(ROOT)} ({W}x{H})")


if __name__ == "__main__":
    main()
