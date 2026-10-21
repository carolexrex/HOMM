#!/usr/bin/env python3
"""Regrade the swamp and build the lake textures from the existing hand-made art.

Requires Pillow and NumPy (dev-only; nothing here ships at runtime):
  python3 -m venv .venv && .venv/bin/pip install pillow numpy
  .venv/bin/python scripts/generate_swamp_and_lake_tiles.py

Sources:
  terrain_swamp.png (git history) - the original 1254x1254 painted bog PNG: seamless, but much
                                  darker than the grass, with reeds and pools far too small at
                                  board scale
  terrain/water_full.png        - lake water between two pebble banks
  terrain_road_horizontal.png   - gravel road through grass

Generated (written into src/assets/ as JPEG, quality 85: the textures are opaque, and PNG
made the swamp alone 2.1 MB):
  terrain_swamp.jpg             - 1024x1024 seamless bog, regraded towards the grass palette with
                                  murky teal pools. The renderer spreads one copy over 3x3 tiles,
                                  so pools and reeds read at board scale, and blends its edges.
  terrain/lake_water.jpg        - 512x512 seamless open water from the pure-water band of
                                  water_full.png, stacked with sideways offsets and cross-fades
                                  (the older water_open.png mirrors the band, which repeats visibly)
  terrain/shore_bank.jpg        - 256x256 seamless sand and pebble bank from the road gravel

All three tile in both directions: the renderer fills whole regions with them in board
coordinates, so neighbouring tiles continue the same image instead of repeating it per tile.
"""

import os
import subprocess
import sys
from io import BytesIO

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "assets")
OUT = os.environ.get("SWAMP_OUT", ROOT)
# The swamp is regraded from the original painting, which this script replaces.
SWAMP_SOURCE_COMMIT = "2e45779"


def load_original_swamp():
    path = os.environ.get("SWAMP_SOURCE")
    if path:
        return Image.open(path).convert("RGB")
    blob = subprocess.run(
        ["git", "show", f"{SWAMP_SOURCE_COMMIT}:src/assets/terrain_swamp.png"],
        cwd=ROOT, check=True, capture_output=True,
    ).stdout
    return Image.open(BytesIO(blob)).convert("RGB")


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)


def wrap_resize(im, size):
    """Resize a seamless image and keep it seamless: resample a 3x3 tiling, keep the centre."""
    w, h = im.size
    tiled = Image.new("RGB", (w * 3, h * 3))
    for y in range(3):
        for x in range(3):
            tiled.paste(im, (x * w, y * h))
    big = tiled.resize((size * 3, size * 3), Image.LANCZOS)
    return big.crop((size, size, size * 2, size * 2))


def wrap_blur(gray, radius):
    """Gaussian blur of a 2D float array that wraps around the edges."""
    pad = int(radius * 4)
    padded = np.pad(gray, pad, mode="wrap")
    blurred = Image.fromarray((padded * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))
    return (np.asarray(blurred).astype(np.float32) / 255)[pad:-pad, pad:-pad]


def make_swamp(source):
    src = np.asarray(wrap_resize(source, 1024)).astype(np.float32) / 255
    r, g, b = src[..., 0], src[..., 1], src[..., 2]
    lum = src @ np.array([0.299, 0.587, 0.114], dtype=np.float32)

    # Pools: darker pixels whose blue is high relative to red (the painting's murky water).
    pools = smoothstep(0.5, 0.72, b / (r + 0.004)) * (1 - smoothstep(0.27, 0.37, lum)) * smoothstep(-0.008, 0.024, g - r)
    pools = smoothstep(0.25, 0.6, wrap_blur(pools, 5))[..., None]
    rim = np.clip(wrap_blur(pools[..., 0], 3) - pools[..., 0], 0, 1)[..., None]

    # Land: lift the shadows and warm the moss towards the olive-yellow grass.
    land = np.clip(src ** 0.78 * 1.3, 0, 1)
    land_lum = (land @ np.array([0.299, 0.587, 0.114], dtype=np.float32))[..., None]
    land = np.clip(land_lum + (land - land_lum) * 1.2, 0, 1)
    land = land * np.array([1.11, 1.07, 0.6], dtype=np.float32)

    # Pools: murky teal that echoes the lake, keeping the painted ripples as light and shade.
    detail = (lum[..., None] - 0.22) * 1.6
    water = np.clip(np.array([0.27, 0.4, 0.4], dtype=np.float32) + detail * np.array([0.8, 0.9, 0.9], dtype=np.float32), 0, 1)

    out = land * (1 - pools) + water * pools
    out = out * (1 - rim * 0.35)  # a damp, darker margin around each pool
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))


def seamless_columns(band):
    """Make a strip wrap left-right: blend in a copy rolled by half its width towards the ends."""
    a = np.asarray(band).astype(np.float32)
    w = a.shape[1]
    rolled = np.roll(a, w // 2, axis=1)
    x = np.arange(w, dtype=np.float32)
    weight = np.clip(1 - np.abs(x - (w - 1) / 2) / (w * 0.32), 0, 1)
    weight = (weight * weight * (3 - 2 * weight))[None, :, None]
    return a * weight + rolled * (1 - weight)


def stack_seamless(strip, height, copies, shifts):
    """Stack `copies` of a seamless strip, each rolled sideways, cross-fading every join
    (including the wrap from bottom to top) so the result tiles in both directions."""
    h, w = strip.shape[:2]
    step = height / copies
    overlap = h - step
    assert overlap > 8, "strip too short for the requested height"
    acc = np.zeros((height, w, 3), dtype=np.float32)
    total = np.zeros((height, 1, 1), dtype=np.float32)
    for index in range(copies):
        layer = np.roll(strip, shifts[index % len(shifts)], axis=1)
        start = int(np.floor(index * step - overlap / 2))
        for row in range(h):
            fade = min(1.0, (row + 0.5) / overlap, (h - row - 0.5) / overlap)
            fade = fade * fade * (3 - 2 * fade)
            y = (start + row) % height
            acc[y] += layer[row] * fade
            total[y] += fade
    return acc / np.maximum(total, 1e-6)


def make_lake_water():
    im = Image.open(os.path.join(ROOT, "terrain", "water_full.png")).convert("RGB")
    band = im.crop((0, 105, im.width, 290))  # the all-water rows, clear of both banks
    strip = seamless_columns(band)
    water = stack_seamless(strip, 512, 3, [0, 197, 331])
    return Image.fromarray(np.clip(water + 0.5, 0, 255).astype(np.uint8))


def make_shore_bank():
    road = Image.open(os.path.join(ROOT, "terrain_road_horizontal.png")).convert("RGB")
    band = road.crop((0, 226, 504, 286))  # gravel between the grass verges
    strip = seamless_columns(band)
    bank = stack_seamless(strip, 504, 12, [0, 173, 311, 89, 241, 401])
    bank = Image.fromarray(np.clip(bank + 0.5, 0, 255).astype(np.uint8))
    return wrap_resize(bank, 256)


def save(image, *parts):
    path = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.save(path, "JPEG", quality=85, optimize=True, progressive=True)
    print(f"{os.path.relpath(path, OUT)}: {image.size[0]}x{image.size[1]}, {os.path.getsize(path) // 1024} KB")


def main():
    save(make_swamp(load_original_swamp()), "terrain_swamp.jpg")
    save(make_lake_water(), "terrain", "lake_water.jpg")
    save(make_shore_bank(), "terrain", "shore_bank.jpg")


if __name__ == "__main__":
    sys.exit(main())
