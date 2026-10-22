#!/usr/bin/env python3
"""Build the board's terrain layers from the hand-painted tiles.

The board is drawn as one continuous grass surface with masked overlays on top of it, instead
of one opaque painting per tile: the painted tiles each had their own grass (colour, contrast,
and blade size differed from tile to tile), so every road, junction, river, and feature tile
showed as a square patch. This script cuts the shared grass, the roads, the bridge deck, the
river water, and the features out of those paintings, offline and reproducibly.

Requires Pillow and NumPy (dev-only; nothing here ships at runtime):
  python3 -m venv .venv && .venv/bin/pip install pillow numpy
  .venv/bin/python scripts/build_terrain_art.py

Sources (src/assets/, the original paintings, kept unchanged and no longer bundled):
  terrain_plains.png, _2, _3       - grass, rock clusters, clover and bush patches
  terrain_road_horizontal.png      - the gravel road with its pebble edges
  terrain_bridge_wide.png          - wooden deck with rails over a river, gravel approach
  terrain_river_horizontal.png     - river water band
  terrain_forest.png, terrain_hill.png, terrain_town.png, terrain_keep.png - the features

Generated (src/assets/terrain/board/; every size a power of two so the GPU can mipmap):
  grass_base.jpg      1024x1024  seamless grass, one copy per 2x2 tiles, synthesised from
                                 rock-free patches of the three plains paintings
  grass_tone.png       128x128   seamless soft light and shade, multiplied over the grass at a
                                 scale that does not line up with the tiles, against repetition
  grass_decals.png     512x256   rocks, clover, and bushes cut from the plains paintings, placed
                                 over the grass (frames in decals.json)
  road_<n,e,s,w>.png   256x256   15 road overlays, one per set of connected sides (0/1 per side,
                                 in the order north, east, south, west). Every one is the same
                                 road profile, mapped along its centre line: the same width, and
                                 the same pixels where it crosses a tile side, so any two
                                 neighbours join exactly. Each is baked in its final orientation,
                                 so the painted light (from the top left) is the same on every
                                 variant; nothing is rotated at runtime.
  bridge_deck.png     1024x256   deck frames for a one-tile bridge, and the west end, middle, and
                                 east end of a longer one (east is the west end mirrored, so
                                 the light still comes from above)
  river_water.jpg      512x512   seamless river water with the current running north-south,
                                 one copy per 2x2 tiles
  forest.png, hill.png, village.png, keep.png  512x512  the features with their own grass
                                 masked away (the hill keeps its plateau), regraded to the
                                 shared grass palette and faded out at the tile sides; the
                                 keep's painted south road is removed (roads are drawn to
                                 match its real connections)
"""

import json
import math
import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "assets")
OUT = os.environ.get("TERRAIN_OUT", os.path.join(ROOT, "terrain", "board"))
SRC = 504  # the paintings are (about) 504 px per tile
SEED = 20261022


def load(name):
    image = Image.open(os.path.join(ROOT, name)).convert("RGB")
    return np.asarray(image, dtype=np.float32)[:SRC, :SRC] / 255.0


def resize(array, size):
    """Resizes an HxWxC float array; RGBA is resampled premultiplied so edges keep their colour."""
    h, w = size if isinstance(size, tuple) else (size, size)
    if array.shape[2] == 4:
        premul = array.copy()
        premul[..., :3] *= premul[..., 3:4]
        out = np.stack([_resize_channel(premul[..., c], (w, h)) for c in range(4)], axis=-1)
        alpha = out[..., 3:4]
        out[..., :3] = np.where(alpha > 1e-4, out[..., :3] / np.maximum(alpha, 1e-4), 0)
        return np.clip(out, 0, 1)
    return np.clip(np.stack([_resize_channel(array[..., c], (w, h)) for c in range(array.shape[2])], axis=-1), 0, 1)


def resize_periodic(array, size, axes=(0, 1)):
    """Resizes art that repeats along `axes`, filtering across its wrap-around instead of its edges."""
    h, w = array.shape[:2]
    out_h, out_w = size if isinstance(size, tuple) else (size, size)
    pad_y = h // 8 if 0 in axes else 0
    pad_x = w // 8 if 1 in axes else 0
    padded = np.pad(array, ((pad_y, pad_y), (pad_x, pad_x), (0, 0)), mode="wrap")
    scale_y, scale_x = out_h / h, out_w / w
    big = resize(padded, (int(round(padded.shape[0] * scale_y)), int(round(padded.shape[1] * scale_x))))
    top, left = int(round(pad_y * scale_y)), int(round(pad_x * scale_x))
    return big[top : top + out_h, left : left + out_w]


def _resize_channel(channel, size):
    return np.asarray(Image.fromarray(channel.astype(np.float32), mode="F").resize(size, Image.LANCZOS), dtype=np.float32)


def blur(mask, radius):
    if radius <= 0:
        return mask
    image = Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8), mode="L").filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(image, dtype=np.float32) / 255.0


def dilate(mask, pixels):
    size = pixels * 2 + 1
    image = Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8), mode="L").filter(ImageFilter.MaxFilter(size))
    return np.asarray(image, dtype=np.float32) / 255.0


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)


def grassness(rgb):
    """1 on the painted grass (warm yellow-green with almost no blue), 0 on anything else."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    ratio = b / np.maximum(r + g + b, 1e-3)
    blue_low = 1 - smoothstep(0.115, 0.15, ratio)
    warmth = r / np.maximum(g, 1e-3)
    # Grass is about as red as it is green; clover is greener, wood and gravel redder.
    return blue_low * smoothstep(0.66, 0.8, warmth) * (1 - smoothstep(1.2, 1.32, warmth))


def periodic_noise(size, scale, rng):
    """Smooth noise in 0..1 that wraps around in both directions (low-pass filtered white noise)."""
    white = rng.standard_normal((size, size))
    fy = np.fft.fftfreq(size)[:, None]
    fx = np.fft.fftfreq(size)[None, :]
    spectrum = np.fft.fft2(white) * np.exp(-((fx * fx + fy * fy) * (scale * scale)))
    noise = np.real(np.fft.ifft2(spectrum))
    noise -= noise.min()
    return noise / max(noise.max(), 1e-6)


def sharpen(rgb, alpha=None, amount=0.6, radius=1.0, wrap=(), clumps=0.35):
    """
    A mild unsharp mask. The GPU filters this art down through its mipmaps when the board is
    zoomed out, which softens the painting; this restores its crispness at play zoom, and
    `clumps` lifts the contrast of features a few pixels across (grass clumps, pebbles), which
    is what the mipmaps average away first. Under
    transparent pixels the colour is first bled outward, so edges get no dark or light halo.
    `wrap` lists the axes along which the art repeats; it is filtered across its wrap-around there.
    """
    if wrap:
        pad = [(8, 8) if axis in wrap else (0, 0) for axis in (0, 1)]
        padded_rgb = np.pad(rgb, pad + [(0, 0)], mode="wrap")
        padded_alpha = None if alpha is None else np.pad(alpha, pad, mode="wrap")
        out = sharpen(padded_rgb, padded_alpha, amount, radius, clumps=clumps)
        return out[pad[0][0] : out.shape[0] - pad[0][1], pad[1][0] : out.shape[1] - pad[1][1]]
    if alpha is not None:
        weight = blur(alpha, 3.0)[..., None]
        bled = np.stack([blur(rgb[..., c] * alpha, 3.0) for c in range(3)], axis=-1) / np.maximum(weight, 1e-3)
        rgb = rgb * alpha[..., None] + np.clip(bled, 0, 1) * (1 - alpha[..., None])
    soft = np.stack([_blur_float(rgb[..., c], radius) for c in range(3)], axis=-1)
    fine = np.stack([_blur_float(rgb[..., c], 1.5) for c in range(3)], axis=-1)
    coarse = np.stack([_blur_float(rgb[..., c], 6.0) for c in range(3)], axis=-1)
    return np.clip(rgb + (rgb - soft) * amount + (fine - coarse) * clumps, 0, 1)


def _blur_float(channel, radius):
    """Gaussian blur of a float channel (edges extended), kept in floating point."""
    taps = int(math.ceil(radius * 3))
    kernel = np.exp(-0.5 * (np.arange(-taps, taps + 1) / radius) ** 2)
    kernel /= kernel.sum()
    padded = np.pad(channel, taps, mode="edge")
    rows = sum(kernel[i] * padded[:, i : i + channel.shape[1]] for i in range(2 * taps + 1))
    return sum(kernel[i] * rows[i : i + channel.shape[0]] for i in range(2 * taps + 1)).astype(np.float32)


def save_rgb(array, name, quality=86):
    image = Image.fromarray((np.clip(array, 0, 1) * 255 + 0.5).astype(np.uint8), mode="RGB")
    path = os.path.join(OUT, name)
    if name.endswith(".jpg"):
        image.save(path, quality=quality, optimize=True, progressive=True)
    else:
        image.save(path, optimize=True)
    print(f"{name:22s} {image.size[0]}x{image.size[1]}  {os.path.getsize(path) // 1024} KB")


def save_rgba(array, name):
    rgba = np.clip(array, 0, 1).copy()
    rgba[..., :3] *= rgba[..., 3:4] > 1 / 255  # no stray colour under fully transparent pixels
    image = Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), mode="RGBA")
    path = os.path.join(OUT, name)
    image.save(path, optimize=True)
    print(f"{name:22s} {image.size[0]}x{image.size[1]}  {os.path.getsize(path) // 1024} KB")


# --- Patch synthesis -----------------------------------------------------------------------


def blob_mask(size, rng, soft=6.0):
    """A soft, irregular round mask: patch seams follow a wandering line, not a circle or grid."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) + 0.5
    cx = cy = size / 2
    angle = np.arctan2(yy - cy, xx - cx)
    radius = np.hypot(xx - cx, yy - cy)
    wobble = sum(rng.uniform(0.015, 0.04) * np.sin(k * angle + rng.uniform(0, 2 * np.pi)) for k in (2, 3, 5, 7))
    edge = size / 2 * (0.86 + wobble) - soft
    return np.clip((edge - radius) / soft + 0.5, 0, 1)


def synthesize(sources, out_size, patch, valid, rng, passes=3, soft=6.0, min_share=0.995):
    """
    Covers a wrap-around canvas with soft-edged patches cut from `sources` at positions where
    `valid` (per source) accepts the whole patch. The canvas tiles seamlessly because patches
    wrap around its sides; it has no repeat inside, unlike the source tiles.
    """
    canvas = np.zeros((out_size, out_size, 3), np.float32)
    coverage = np.zeros((out_size, out_size), np.float32)
    candidates = []
    for index, image in enumerate(sources):
        ok = valid[index]
        h, w = ok.shape
        # Integral image: a patch is usable when every pixel in it is.
        integral = np.pad(ok.astype(np.int64), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
        sums = integral[patch:, patch:] - integral[:-patch, patch:] - integral[patch:, :-patch] + integral[:-patch, :-patch]
        ys, xs = np.nonzero(sums >= patch * patch * min_share)
        candidates.extend((index, int(y), int(x)) for y, x in zip(ys[::7], xs[::7]))
    if not candidates:
        raise SystemExit("no usable patches in the sources")
    def splat(cy, cx):
        source, sy, sx = candidates[rng.integers(len(candidates))]
        piece = sources[source][sy : sy + patch, sx : sx + patch]
        mask = blob_mask(patch, rng, soft)
        rows = (np.arange(patch) + cy - patch // 2) % out_size
        cols = (np.arange(patch) + cx - patch // 2) % out_size
        region = np.ix_(rows, cols)
        canvas[region] = canvas[region] * (1 - mask[..., None]) + piece * mask[..., None]
        coverage[region] = 1 - (1 - coverage[region]) * (1 - mask)

    step = patch * 0.4
    for pass_index in range(passes):
        cells = int(math.ceil(out_size / step))
        order = [(gy, gx) for gy in range(cells) for gx in range(cells)]
        rng.shuffle(order)
        for gy, gx in order:
            cy = int((gy + rng.uniform(-0.35, 0.35) + 0.5 * (pass_index % 2)) * step) % out_size
            cx = int((gx + rng.uniform(-0.35, 0.35) + 0.5 * (pass_index % 2)) * step) % out_size
            splat(cy, cx)
    # Fill whatever the passes left uncovered, one patch on the emptiest point at a time.
    for _ in range(4000):
        if coverage.min() >= 0.999:
            break
        cy, cx = np.unravel_index(int(np.argmin(coverage)), coverage.shape)
        splat(int(cy), int(cx))
    if coverage.min() < 0.999:
        raise SystemExit(f"synthesis left gaps (coverage {coverage.min():.3f})")
    canvas /= np.maximum(coverage, 1e-3)[..., None]
    return canvas


def match_colour(rgb, weight, target_mean, target_std):
    """Regrades `rgb` so the pixels `weight` selects have the target per-channel mean and spread."""
    w = weight[..., None]
    total = max(float(weight.sum()), 1.0)
    mean = (rgb * w).sum((0, 1)) / total
    std = np.sqrt(((rgb - mean) ** 2 * w).sum((0, 1)) / total)
    graded = (rgb - mean) / np.maximum(std, 1e-3) * target_std + target_mean
    return np.clip(rgb * (1 - w) + graded * w, 0, 1)


# --- Grass -----------------------------------------------------------------------------------


def build_grass(rng):
    names = ["terrain_plains.png", "terrain_plains_2.png", "terrain_plains_3.png"]
    scale = 512 / SRC
    sources, valid = [], []
    for name in names:
        rgb = resize(load(name), 512)
        sources.append(rgb)
        valid.append(grassness(rgb) > 0.9)
    grass = synthesize(sources, 1024, 168, valid, rng, passes=3, soft=7.0)
    weight = np.ones(grass.shape[:2], np.float32)
    mean = (grass * weight[..., None]).sum((0, 1)) / weight.sum()
    std = grass.reshape(-1, 3).std(0)
    print(f"grass palette mean {np.round(mean * 255)} std {np.round(std * 255)} (source scale x{scale:.3f})")
    return grass, mean, std


def build_tone(rng):
    noise = periodic_noise(128, 9.0, rng)
    noise = smoothstep(0.2, 0.85, noise)
    light = np.array([1.0, 1.0, 1.0], np.float32)
    shade = np.array([0.88, 0.91, 0.86], np.float32)
    return shade + (light - shade) * noise[..., None]


def components(mask):
    """Connected regions of a boolean mask (4-neighbour), as lists of (y, x) arrays."""
    seen = np.zeros_like(mask, bool)
    found = []
    h, w = mask.shape
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]:
            continue
        stack = [(y0, x0)]
        seen[y0, x0] = True
        ys, xs = [], []
        while stack:
            y, x = stack.pop()
            ys.append(y)
            xs.append(x)
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        found.append((np.array(ys), np.array(xs)))
    return found


def build_decals():
    """Rock clusters, clover, and bushes from the plains paintings, at the grass's 512 px per tile."""
    pieces = []
    for name in ["terrain_plains.png", "terrain_plains_2.png", "terrain_plains_3.png"]:
        rgb = resize(load(name), 512)
        other = 1 - grassness(rgb)
        solid = dilate(blur(other, 1.5) > 0.5, 5) > 0.5
        for ys, xs in components(solid):
            if len(ys) < 900:
                continue
            top, bottom, left, right = ys.min() - 6, ys.max() + 7, xs.min() - 6, xs.max() + 7
            if top < 0 or left < 0 or bottom > 512 or right > 512:
                continue  # cut by the tile side
            region = np.zeros((512, 512), np.float32)
            region[ys, xs] = 1
            alpha = blur(region * smoothstep(0.15, 0.6, blur(other, 1.0)) + dilate(region, 1) * 0.25, 1.6)
            alpha = np.clip(alpha * 1.6, 0, 1)[top:bottom, left:right]
            pieces.append(np.dstack([rgb[top:bottom, left:right], alpha]))
    pieces.sort(key=lambda piece: -piece.shape[0] * piece.shape[1])
    pieces = pieces[:8]
    atlas = np.zeros((256, 512, 4), np.float32)
    frames = []
    x = y = row = 0
    for piece in pieces:
        h, w = piece.shape[:2]
        if x + w > 512:
            x, y, row = 0, y + row + 4, 0
        if y + h > 256:
            break
        atlas[y : y + h, x : x + w] = piece
        frames.append({"x": x, "y": y, "w": w, "h": h})
        x += w + 4
        row = max(row, h)
    atlas[..., :3] = sharpen(atlas[..., :3], atlas[..., 3])
    return atlas, frames


# --- Roads -----------------------------------------------------------------------------------

ROAD_RES = 512  # rendered at this size, then halved
ROAD_OUT = 256
ROAD_MARGIN = 16  # rendered past each tile side, so halving filters across the side like the neighbour does
PROFILE_HALF = 0.2  # the profile reaches this far either side of the centre line, in tiles
ROAD_WIDEN = 1.18  # the painted road (0.2 tiles) is widened a little to read at phone sizes


def make_periodic_x(rgba, rng):
    """Hides the left/right seam of a strip: the seam moves to the middle and is covered there."""
    h, w = rgba.shape[:2]
    shifted = np.roll(rgba, w // 2, axis=1)
    xs = np.arange(w)[None, :].astype(np.float32)
    wobble = (periodic_noise(max(h, 64), 6.0, rng)[:h, :1] - 0.5) * 0.12 * w
    distance = np.abs(xs - w / 2 + wobble)
    mask = 1 - smoothstep(0.1 * w, 0.18 * w, distance)
    return shifted * (1 - mask[..., None]) + rgba * mask[..., None]


def road_profile(rng):
    """
    The road across its width, as painted: RGBA rows from PROFILE_HALF tiles above the centre
    line to PROFILE_HALF below, made to repeat along the road once per tile. Its grass is
    transparent, so the shared grass shows through between the pebbles.
    """
    rgb = load("terrain_road_horizontal.png")
    other = 1 - grassness(rgb)
    rows = blur(other, 2).mean(1)
    band = np.nonzero(rows > 0.5)[0]
    centre = (band.min() + band.max()) / 2
    half = int(round(PROFILE_HALF * SRC))
    band_half = (band.max() - band.min()) / 2
    top = int(round(centre)) - half
    strip = rgb[top : top + 2 * half]
    alpha = smoothstep(0.25, 0.7, blur(1 - grassness(strip), 0.8))
    # Drop dark specks in the grass beyond the road's pebble edges.
    rows_off = np.abs(np.arange(2 * half) + 0.5 - half)[:, None]
    alpha *= 1 - smoothstep(band_half + 8, band_half + 16, rows_off)
    rgba = np.dstack([strip, alpha])
    profile = resize_periodic(make_periodic_x(rgba, rng), (2 * int(round(PROFILE_HALF * ROAD_RES)), ROAD_RES), axes=(1,))
    width = (band.max() - band.min()) / SRC
    print(f"road profile: centre row {centre:.0f}/{SRC}, painted width {width:.3f} tiles")
    return profile


def sample_profile(profile, u, offset):
    """Bilinear sample at u (tiles along the road, wraps) and offset (tiles across, signed)."""
    h, w = profile.shape[:2]
    fx = (u % 1.0) * w - 0.5
    fy = (offset / ROAD_WIDEN / (2 * PROFILE_HALF) + 0.5) * h - 0.5
    inside = (fy >= -0.5) & (fy <= h - 0.5)
    fy = np.clip(fy, 0, h - 1)
    x0 = np.floor(fx).astype(int)
    y0 = np.clip(np.floor(fy).astype(int), 0, h - 2)
    tx = (fx - x0)[..., None]
    ty = (fy - y0)[..., None]
    x0 %= w
    x1 = (x0 + 1) % w
    premul = profile.copy()
    premul[..., :3] *= premul[..., 3:4]
    value = (premul[y0, x0] * (1 - tx) * (1 - ty) + premul[y0, x1] * tx * (1 - ty) + premul[y0 + 1, x0] * (1 - tx) * ty + premul[y0 + 1, x1] * tx * ty)
    return value * inside[..., None]


SIDES = {"n": (0.5, 0.0), "e": (1.0, 0.5), "s": (0.5, 1.0), "w": (0.0, 0.5)}


def segment_distance(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1)
    return np.hypot(px - ax - t * dx, py - ay - t * dy)


def smooth_min(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def render_road(profile, sides):
    """
    One road overlay. Each arm runs from the middle of its tile side to the centre. Along an
    east-west arm the profile is sampled at (x, y - 0.5); along a north-south arm at (y, x - 0.5),
    which is the profile transposed, so the painted light stays top-left. Where the road crosses
    a tile side only that arm counts, so the side's pixels are the same as on the neighbour.
    """
    coords = (np.arange(-ROAD_MARGIN, ROAD_RES + ROAD_MARGIN, dtype=np.float32) + 0.5) / ROAD_RES
    py, px = np.meshgrid(coords, coords, indexing="ij")
    arms = {}
    for side in sides:
        u = px if side in "ew" else py
        offset = (py - 0.5) if side in "ew" else (px - 0.5)
        # Each arm runs on past its tile side (into the margin), as the neighbour's road does.
        sx, sy = SIDES[side]
        arms[side] = (u, offset, segment_distance(px, py, sx + (sx - 0.5) * 0.2, sy + (sy - 0.5) * 0.2, 0.5, 0.5))

    corner = len(sides) == 2 and not ({"e", "w"} == set(sides) or {"n", "s"} == set(sides))
    if corner:
        # A quarter circle through both side midpoints, centred on the tile corner they share.
        cx = 1.0 if "e" in sides else 0.0
        cy = 1.0 if "s" in sides else 0.0
        radial = np.hypot(px - cx, py - cy) - 0.5
        horizontal = "e" if "e" in sides else "w"
        vertical = "s" if "s" in sides else "n"
        # Each arm's offset at its own tile side: y - 0.5 for the horizontal arm, where the
        # radial distance is |y - cy| - 0.5 (so y - 0.5 when cy = 0, 0.5 - y when cy = 1), and
        # x - 0.5 for the vertical arm likewise.
        h_offset = radial if cy == 0.0 else -radial
        v_offset = radial if cx == 0.0 else -radial
        # 0 where the arc meets the vertical arm's side, pi/2 where it meets the horizontal's.
        angle = np.arctan2(np.abs(py - cy), np.abs(px - cx))
        weight_h = smoothstep(np.pi / 4 - 0.3, np.pi / 4 + 0.3, angle)[..., None]
        value = sample_profile(profile, arms[horizontal][0], h_offset) * weight_h + sample_profile(profile, arms[vertical][0], v_offset) * (1 - weight_h)
    else:
        # The union of the arms, with the inside corners between perpendicular arms rounded.
        distance = np.minimum.reduce([d for _, _, d in arms.values()])
        for first, second in (("n", "e"), ("e", "s"), ("s", "w"), ("w", "n")):
            if first in arms and second in arms:
                distance = np.minimum(distance, smooth_min(arms[first][2], arms[second][2], 0.05))
        # Blend the arms by nearness; at a tile side only the arm that meets it is left.
        weights = {side: np.exp(-(d - distance) / 0.03) for side, (_, _, d) in arms.items()}
        total = sum(weights.values())
        value = 0
        for side, (u, offset, _) in arms.items():
            # Each arm keeps its own side of the road, at the union's distance from the centre line.
            signed = np.where(offset >= 0, 1.0, -1.0) * distance
            value = value + sample_profile(profile, u, signed) * (weights[side] / total)[..., None]
    full = ROAD_RES + 2 * ROAD_MARGIN
    rgba = np.zeros((full, full, 4), np.float32)
    alpha = value[..., 3]
    rgba[..., 3] = alpha
    rgba[..., :3] = np.where(alpha[..., None] > 1e-4, value[..., :3] / np.maximum(alpha[..., None], 1e-4), 0)
    margin = ROAD_MARGIN * ROAD_OUT // ROAD_RES
    small = resize(rgba, ROAD_OUT + 2 * margin)
    small[..., :3] = sharpen(small[..., :3], small[..., 3])
    return small[margin:-margin, margin:-margin]


# --- Features --------------------------------------------------------------------------------


def polygon_mask(points, size, scale):
    from PIL import ImageDraw

    image = Image.new("L", (size, size), 0)
    ImageDraw.Draw(image).polygon([(x * scale, y * scale) for x, y in points], fill=255)
    return np.asarray(image, dtype=np.float32) / 255.0


def edge_fade(size, width):
    coords = (np.arange(size, dtype=np.float32) + 0.5) / size
    py, px = np.meshgrid(coords, coords, indexing="ij")
    nearest = np.minimum(np.minimum(px, 1 - px), np.minimum(py, 1 - py))
    return smoothstep(0.0, width, nearest)


# Outlines in the paintings' 504 px coordinates.
HILL_PLATEAU = [(0, 0), (504, 0), (504, 392), (474, 384), (446, 420), (404, 444), (352, 472), (300, 484), (248, 484),
                (198, 472), (158, 452), (118, 432), (78, 410), (40, 380), (14, 342), (0, 322)]
KEEP_ROAD = [(182, 334), (276, 334), (340, 504), (128, 504)]


def build_feature(name, grass_mean, grass_std, extra=None, remove=None, fade=0.035, brighten=1.0):
    size = 512
    scale = size / SRC
    rgb = resize(load(name), size)
    grass = grassness(rgb)
    other = 1 - grass
    # Objects are the larger non-grass regions; small specks are flowers and highlights in the grass.
    core = blur(other, 1.2) > 0.5
    objects = np.zeros(core.shape, np.float32)
    for ys, xs in components(core):
        if len(ys) >= 300:
            objects[ys, xs] = 1
    solid = blur(dilate(objects, 4), 3.0)
    # Shade under objects (tree and wall shadows) is dark grass: keep a soft halo of it.
    alpha = np.clip(solid * 1.25, 0, 1)
    if extra:
        alpha = np.maximum(alpha, blur(polygon_mask(extra, size, scale), 5.0))
    if remove:
        alpha *= 1 - blur(polygon_mask(remove, size, scale), 4.0)
    alpha *= edge_fade(size, fade)
    graded = match_colour(rgb, grass * (alpha > 0.02), grass_mean * brighten, grass_std)
    return np.dstack([sharpen(graded, alpha), alpha])


# --- Bridge and river ------------------------------------------------------------------------


def river_classes(rgb):
    """Water, and the olive grass of the river and bridge paintings (bluer than the plains grass)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    water = (b > r + 0.05) & (b > g) & (b > 0.3)
    warmth = r / np.maximum(g, 1e-3)
    grass = ((warmth < 1.1) & (b < g * 0.6) & ~water) | (grassness(rgb) > 0.5)
    return water, grass


def build_bridge(road):
    """The deck, with its gravel approach regraded to the road's gravel so the two meet unnoticed."""
    rgb = load("terrain_bridge_wide.png")
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    water, grass = river_classes(rgb)
    wood = (r > g * 1.25) & (g > b) & ~water
    rows = blur(wood.astype(np.float32), 2)[:, 160:480].mean(1)
    deck_rows = np.nonzero(rows > 0.5)[0]
    top, bottom = deck_rows.min(), deck_rows.max()
    keep = ~grass & ~water
    alpha = blur(keep.astype(np.float32), 0.7)
    band = np.zeros_like(alpha)
    band[max(top - 3, 0) : bottom + 4] = 1
    alpha *= band
    warmth = r / np.maximum(g, 1e-3)
    gravel = keep & (warmth > 1.08) & (warmth < 1.32) & (b > g * 0.55) & (rgb.mean(-1) > 0.5)
    middle = road[road.shape[0] // 2 - 12 : road.shape[0] // 2 + 12]
    solid = middle[..., 3] > 0.95
    rgb = match_colour(rgb, blur(gravel.astype(np.float32), 1.0), middle[..., :3][solid].mean(0), middle[..., :3][solid].std(0))
    deck = np.dstack([rgb, alpha])
    print(f"bridge deck rows {top}-{bottom} of {SRC} (centre {(top + bottom) / 2 / SRC:.3f})")
    west = resize(deck, 256)
    east = west[:, ::-1]
    single = np.concatenate([west[:, :128], east[:, 128:]], axis=1)
    middle = resize(deck[:, 126:], (256, 256))
    sheet = np.concatenate([single, west, middle, east], axis=1)
    sheet[..., :3] = sharpen(sheet[..., :3], sheet[..., 3])
    return sheet


BANK_ROWS = {"north": (126, 230), "south": (262, 366)}  # painting rows: land, pebbles, then shallows
BANK_DEPTH = 64  # px of a 256 px tile: the strip reaches a quarter tile into the river


def build_river_banks(rng):
    """
    Strips of the painted river bank, made to repeat once per tile along the bank: grass
    (transparent), round pebbles, then shallow water fading out over the river's own water. The
    top frame is the painting's north bank (land to the north), the bottom frame its south bank.
    The renderer transposes them (never turns or flips them) for banks on the west and east sides
    of a river tile, so the painted light stays top-left.
    """
    rgb = load("terrain_river_horizontal.png")
    water, grass = river_classes(rgb)
    land = 1 - blur(grass.astype(np.float32), 0.8)
    frames = []
    for name, (start, end) in BANK_ROWS.items():
        rows = np.arange(start, end, dtype=np.float32)[:, None]
        strip = rgb[start:end]
        alpha = land[start:end].copy()
        # Fade out the shallows over the river's own water, and stray grass tips on the land side.
        if name == "north":
            alpha *= (1 - smoothstep(end - 34, end - 4, rows)) * smoothstep(start + 8, start + 20, rows)
        else:
            alpha *= smoothstep(start + 4, start + 34, rows) * (1 - smoothstep(end - 20, end - 8, rows))
        rgba = make_periodic_x(np.dstack([strip, alpha]), rng)
        depth = int(round((end - start) * 256 / SRC))
        frame = np.zeros((BANK_DEPTH, 256, 4), np.float32)
        # Each frame's land side is on the tile side it is drawn against: top for the north bank.
        if name == "north":
            frame[:depth] = resize_periodic(rgba, (depth, 256), axes=(1,))
        else:
            frame[BANK_DEPTH - depth :] = resize_periodic(rgba, (depth, 256), axes=(1,))
        frames.append(frame)
    bank = np.concatenate(frames, axis=0)
    bank[..., :3] = sharpen(bank[..., :3], bank[..., 3], wrap=(1,))
    return bank


def build_river_water(rng):
    rgb = load("terrain_river_horizontal.png")
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    water = (b > r + 0.05) & (b > g) & (b > 0.3)
    row_share = water.mean(1)
    rows = np.nonzero(row_share > 0.9)[0]
    print(f"river water rows {rows.min()}-{rows.max()} of {SRC}")
    valid = np.zeros_like(water)
    valid[rows.min() : rows.max() + 1] = water[rows.min() : rows.max() + 1]
    canvas = synthesize([rgb], 1024, 48, [valid], rng, passes=3, soft=7.0, min_share=0.96)
    # Two tiles per copy at the painting's scale, with the current turned to run north-south.
    return np.rot90(resize_periodic(canvas, 512), k=-1).copy()


def main():
    os.makedirs(OUT, exist_ok=True)
    rng = np.random.default_rng(SEED)

    grass, grass_mean, grass_std = build_grass(rng)
    save_rgb(sharpen(grass, wrap=(0, 1), clumps=0.8), "grass_base.jpg", quality=84)
    save_rgb(build_tone(rng), "grass_tone.png")
    atlas, frames = build_decals()
    save_rgba(atlas, "grass_decals.png")
    with open(os.path.join(OUT, "decals.json"), "w") as handle:
        json.dump({"tile": 512, "frames": frames}, handle, indent=2)
        handle.write("\n")

    profile = road_profile(rng)
    for bits in range(1, 16):
        sides = [side for index, side in enumerate("nesw") if bits & (1 << (3 - index))]
        name = "road_" + "".join("1" if side in sides else "0" for side in "nesw") + ".png"
        save_rgba(render_road(profile, sides), name)

    save_rgba(build_feature("terrain_forest.png", grass_mean, grass_std), "forest.png")
    save_rgba(build_feature("terrain_hill.png", grass_mean, grass_std, extra=HILL_PLATEAU, fade=0.08, brighten=1.06), "hill.png")
    save_rgba(build_feature("terrain_town.png", grass_mean, grass_std), "village.png")
    save_rgba(build_feature("terrain_keep.png", grass_mean, grass_std, remove=KEEP_ROAD), "keep.png")
    save_rgba(build_bridge(profile), "bridge_deck.png")
    save_rgb(sharpen(build_river_water(rng), wrap=(0, 1)), "river_water.jpg", quality=84)
    save_rgba(build_river_banks(rng), "river_bank.png")


def verify():
    """
    Fails the build if a join shows a step: for every two road overlays that meet across a tile
    side, the grass, tone, and water wrap-arounds, and the bank strips along a bank, the change
    across the join must be no larger than the largest change between neighbouring columns (or
    rows) inside the art itself.
    """

    def premultiplied(name):
        rgba = np.asarray(Image.open(os.path.join(OUT, name)).convert("RGBA"), dtype=np.float32) / 255
        return np.concatenate([rgba[..., :3] * rgba[..., 3:4], rgba[..., 3:4]], axis=-1)

    def steepest(art, axis):
        return float(np.abs(np.diff(art, axis=axis)).mean(axis=tuple(i for i in range(3) if i != axis)).max())

    def ratio(first, second, art, axis):
        return float(np.abs(first - second).mean()) / max(steepest(art, axis), 1e-3)

    worst = {}
    roads = {key: premultiplied(f"road_{key}.png") for key in (format(bits, "04b") for bits in range(1, 16))}
    for a_key, a in roads.items():
        for b_key, b in roads.items():
            if a_key[1] == "1" and b_key[3] == "1":  # a's east side meets b's west side
                worst["road east-west"] = max(worst.get("road east-west", 0), ratio(a[:, -1], b[:, 0], a, 1))
            if a_key[2] == "1" and b_key[0] == "1":  # a's south side meets b's north side
                worst["road north-south"] = max(worst.get("road north-south", 0), ratio(a[-1], b[0], a, 0))
    for name in ("grass_base.jpg", "river_water.jpg", "grass_tone.png"):
        art = premultiplied(name)
        worst[name] = max(ratio(art[:, -1], art[:, 0], art, 1), ratio(art[-1], art[0], art, 0))
    bank = premultiplied("river_bank.png")
    worst["river bank"] = ratio(bank[:, -1], bank[:, 0], bank, 1)
    for name, value in worst.items():
        print(f"join check  {name:18s} {value:.2f} of the steepest step inside the art")
    failed = [name for name, value in worst.items() if value > 1.0]
    if failed:
        raise SystemExit(f"visible joins in: {', '.join(failed)}")


if __name__ == "__main__":
    main()
    verify()
