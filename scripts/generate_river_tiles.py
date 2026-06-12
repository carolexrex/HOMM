#!/usr/bin/env python3
"""Generate the missing river tile variants from the existing hand-made art.

Sources:
  terrain_river_horizontal.png  - straight river, water band running W-E
  terrain_bridge.png            - N-S bridge deck over a W-E river (for deck overlay)

Generated (written into src/assets/):
  terrain_river_corner.png      - bend connecting S and E edges (rotate in code for others)
  terrain_river_t_junction.png  - junction open S, E, W (rotate in code)
  terrain_river_crossroads.png  - junction open on all four edges
  terrain_river_edge.png        - wide-river half: water flush against the E edge
                                  (two of these mirrored make a 2-tile-wide river)
  terrain/water_open.png        - seamless open-water tile for lake interiors,
                                  built from the pure-water band of water_full.png
                                  (which has banks baked in and cannot tile)

The corner is built by warping the straight river through a 90-degree polar arc,
so its edge profiles are pixel-identical to the straight piece and tiles join
seamlessly.
"""

import math
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "src", "assets")
OUT = os.environ.get("RIVER_OUT", ROOT)
SIZE = 504


def is_water(px):
    r, g, b = px[:3]
    return b > r and b > g * 0.9 and b > 70


def load_straight():
    im = Image.open(os.path.join(ROOT, "terrain_river_horizontal.png")).convert("RGB")
    return im.crop((0, 0, SIZE, SIZE))  # source is 505x504; normalise


def water_rows_of_column(im, x):
    """Return (start, end) of the main water run in column x."""
    px = im.load()
    best = (0, 0)
    cur = None
    for y in range(im.height):
        w = is_water(px[x, y])
        if w and cur is None:
            cur = y
        if not w and cur is not None:
            if y - cur > best[1] - best[0]:
                best = (cur, y)
            cur = None
    if cur is not None and im.height - cur > best[1] - best[0]:
        best = (cur, im.height)
    return best


def make_corner(straight):
    """Corner open at S and E. Polar warp: radius from the SE tile corner picks the
    row of the straight piece, angle picks the column."""
    src = straight.load()
    out = Image.new("RGB", (SIZE, SIZE))
    dst = out.load()
    grass_lo, grass_hi = 400, SIZE - 1  # pure bottom grass band for r beyond the tile
    for y in range(SIZE):
        for x in range(SIZE):
            dx = SIZE - x
            dy = SIZE - y
            r = math.hypot(dx, dy)
            theta = math.atan2(dy, dx)  # 0 at S edge, pi/2 at E edge
            xs = min(SIZE - 1, int(theta / (math.pi / 2) * (SIZE - 1)))
            if r <= SIZE - 1:
                ys = int(r)
            else:
                ys = grass_hi - int(r - SIZE + 1) % (grass_hi - grass_lo)
            dst[x, y] = src[xs, ys]
    return out


def blend_rows(top, bottom, seam, feather):
    """Vertical concat of two full tiles, alpha-feathered across the seam."""
    out = bottom.copy()
    out.paste(top.crop((0, 0, SIZE, seam)), (0, 0))
    for i in range(feather):
        y = seam + i
        if y >= SIZE:
            break
        alpha = (i + 1) / (feather + 1)
        row_top = top.crop((0, y, SIZE, y + 1))
        row_bot = bottom.crop((0, y, SIZE, y + 1))
        out.paste(Image.blend(row_top, row_bot, alpha), (0, y))
    return out


def make_t_junction(straight, corner_se):
    """T open S, E, W: straight channel across the top, the S branch banks formed
    by two mirrored inner-corner quadrants (pixel-exact seam down the middle)."""
    q = make_inner_corner_quadrant(straight)
    half = SIZE // 2
    bottom = straight.copy()
    bottom.paste(q.transpose(Image.FLIP_TOP_BOTTOM), (0, half))
    bottom.paste(q.transpose(Image.ROTATE_180), (half, half))
    return blend_rows(straight, bottom, seam=half, feather=44)


def make_inner_corner_quadrant(straight):
    """Quadrant with a grass nub at its top-left and water everywhere far from it.
    Four of these (mirrored) assemble into the crossroads."""
    src = straight.load()
    half = SIZE // 2
    band_lo, band_hi = straight_band(straight)
    span = band_hi - band_lo - 16
    out = Image.new("RGB", (half, half))
    dst = out.load()
    for y in range(half):
        for x in range(half):
            r = math.hypot(x + 1, y + 1)
            theta = math.atan2(y + 1, x + 1)
            xs = min(SIZE - 1, int(theta / (math.pi / 2) * (SIZE - 1)))
            if r < band_lo:
                ys = int(r)
            else:
                # ping-pong inside the water band: no hard wrap seams
                k = int(r - band_lo) % (2 * span)
                ys = band_lo + 8 + (k if k < span else 2 * span - k)
            dst[x, y] = src[xs, ys]
    return out


def straight_band(straight):
    """Average water band (rows) of the straight piece."""
    a = water_rows_of_column(straight, 2)
    b = water_rows_of_column(straight, SIZE - 3)
    return (min(a[0], b[0]), max(a[1], b[1]))


def make_crossroads(straight):
    q = make_inner_corner_quadrant(straight)
    half = SIZE // 2
    out = Image.new("RGB", (SIZE, SIZE))
    out.paste(q, (0, 0))
    out.paste(q.transpose(Image.FLIP_LEFT_RIGHT), (half, 0))
    out.paste(q.transpose(Image.FLIP_TOP_BOTTOM), (0, half))
    out.paste(q.transpose(Image.ROTATE_180), (half, half))
    return out


def make_edge(straight):
    """Wide-river half tile: vertical river pushed against the E edge, grass fill
    on the W side. Mirrored pair = one wide river."""
    vert = straight.transpose(Image.ROTATE_270)  # water band now runs N-S
    # find min water end across rows so water is flush with the E edge everywhere
    ends = []
    px = vert.load()
    for y in range(0, SIZE, 4):
        run = water_cols_of_row(vert, y)
        if run[1] - run[0] > 40:
            ends.append(run[1])
    shift = SIZE - min(ends) + 2
    out = Image.new("RGB", (SIZE, SIZE))
    grass_w = 150  # leftmost columns of the vertical piece are pure grass
    for x in range(shift):
        col = vert.crop((x % grass_w, 0, x % grass_w + 1, SIZE))
        out.paste(col, (x, 0))
    out.paste(vert.crop((0, 0, SIZE - shift, SIZE)), (shift, 0))
    return out


def make_bridge_wide(edge):
    """Half of a two-tile bridge over the wide river: edge-river base with the
    bridge deck running W->E, approach ramp at W, railed deck extended to the E
    edge so it continues into the mirrored partner tile."""
    bridge = Image.open(os.path.join(ROOT, "terrain_bridge.png")).convert("RGB")
    band = bridge.crop((153, 0, 348, SIZE))  # railed deck column band
    approach_h = 88            # dirt ramp at the top of the band
    deck = Image.new("RGB", band.size)
    deck.paste(band.crop((0, 0, band.width, approach_h)), (0, 0))
    railed = band.crop((0, approach_h, band.width, 415))
    deck.paste(railed.resize((band.width, SIZE - approach_h)), (0, approach_h))
    deck = deck.transpose(Image.ROTATE_90)  # deck now horizontal, approach at W
    out = edge.copy()
    out.paste(deck, (0, 153))
    return out


def make_open_water():
    """Seamless deep-water tile: crop the widest all-water row band out of
    water_full.png (whose pebble banks make it untileable) and ping-pong it
    vertically so there are no wrap seams."""
    im = Image.open(os.path.join(ROOT, "terrain", "water_full.png")).convert("RGB")
    px = im.load()
    best = (0, 0)
    cur = None
    for y in range(im.height + 1):
        ok = y < im.height and sum(
            1 for x in range(im.width) if is_water(px[x, y])
        ) >= im.width * 0.95  # tolerate foam/whitecap pixels but not pebbles
        if ok and cur is None:
            cur = y
        if not ok and cur is not None:
            if y - cur > best[1] - best[0]:
                best = (cur, y)
            cur = None
    band = im.crop((0, best[0] + 8, im.width, best[1] - 8))
    flipped = band.transpose(Image.FLIP_TOP_BOTTOM)
    out = Image.new("RGB", im.size)
    y, flip = 0, False
    while y < im.height:
        out.paste(flipped if flip else band, (0, y))
        y += band.height
        flip = not flip
    return out


def water_cols_of_row(im, y):
    px = im.load()
    best = (0, 0)
    cur = None
    for x in range(im.width):
        w = is_water(px[x, y])
        if w and cur is None:
            cur = x
        if not w and cur is not None:
            if x - cur > best[1] - best[0]:
                best = (cur, x)
            cur = None
    if cur is not None and im.width - cur > best[1] - best[0]:
        best = (cur, im.width)
    return best


def main():
    straight = load_straight()
    corner = make_corner(straight)
    corner.save(os.path.join(OUT, "terrain_river_corner.png"))
    t = make_t_junction(straight, corner)
    t.save(os.path.join(OUT, "terrain_river_t_junction.png"))
    cross = make_crossroads(straight)
    cross.save(os.path.join(OUT, "terrain_river_crossroads.png"))
    edge = make_edge(straight)
    edge.save(os.path.join(OUT, "terrain_river_edge.png"))
    bridge_wide = make_bridge_wide(edge)
    bridge_wide.save(os.path.join(OUT, "terrain_bridge_wide.png"))
    water_dir = os.path.join(OUT, "terrain")
    os.makedirs(water_dir, exist_ok=True)
    make_open_water().save(os.path.join(water_dir, "water_open.png"))
    print("generated: corner, t_junction, crossroads, edge, bridge_wide, water_open")


if __name__ == "__main__":
    main()
