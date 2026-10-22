import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maps, type MatchState, type TerrainKind } from "../src/engine";
import { planTerrain, ROAD_LIKE, RIVER, SIDES, type Side } from "../src/components/canvas/terrainPlan";
import decalAtlas from "../src/assets/terrain/board/decals.json";

// The static terrain layer's plan (src/components/canvas/terrainPlan.ts) on every map: roads
// join their neighbours side for side, bridges carry decks toward their approaches, river banks
// face land, decals stay on open plains, and every piece has its art.

const ART = join(__dirname, "../src/assets/terrain/board");
const STEP: Record<Side, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const OPPOSITE: Record<Side, Side> = { n: "s", e: "w", s: "n", w: "e" };

const stateOf = (map: (typeof maps)[number]) => ({ board: map.board }) as unknown as MatchState;
const planOf = (map: (typeof maps)[number]) => planTerrain(stateOf(map), decalAtlas.frames, decalAtlas.tile);
const cases = maps.map((map) => [map.name, map] as const);

describe("terrain plan", () => {
  it.each(cases)("%s: every road arm meets a road, bridge, village, or keep that meets it back", (_name, map) => {
    const plan = planOf(map);
    const keys = new Map(plan.roads.map((road) => [`${road.x},${road.y}`, road.key]));
    for (const road of plan.roads) {
      SIDES.forEach((side, index) => {
        const [dx, dy] = STEP[side];
        const next = map.board[road.y + dy]?.[road.x + dx];
        const open = road.key[index] === "1";
        if (!next) {
          expect(open, `road ${road.x},${road.y} does not run off the board`).toBe(false);
          return;
        }
        expect(open, `road ${road.x},${road.y} ${side} side`).toBe(ROAD_LIKE.includes(next.terrain));
        if (open && next.terrain !== "bridge") {
          // The neighbour's art crosses the same tile side, so the two halves of the road meet.
          expect(keys.get(`${next.x},${next.y}`)?.[SIDES.indexOf(OPPOSITE[side])], `${next.x},${next.y} meets ${road.x},${road.y}`).toBe("1");
        }
      });
    }
  });

  it.each(cases)("%s: roads, villages, and keeps carry road art; nothing else does", (_name, map) => {
    const carried = new Set(planOf(map).roads.map((road) => `${road.x},${road.y}`));
    for (const tile of map.board.flat()) {
      const linked = SIDES.some((side) => ROAD_LIKE.includes(map.board[tile.y + STEP[side][1]]?.[tile.x + STEP[side][0]]?.terrain as TerrainKind));
      const expected = tile.terrain === "road" || ((tile.terrain === "village" || tile.terrain === "keep") && linked);
      expect(carried.has(`${tile.x},${tile.y}`), `${tile.terrain} at ${tile.x},${tile.y}`).toBe(expected);
    }
  });

  it.each(cases)("%s: every bridge has a deck running toward its approaches", (_name, map) => {
    const plan = planOf(map);
    const bridges = map.board.flat().filter((tile) => tile.terrain === "bridge");
    expect(plan.decks).toHaveLength(bridges.length);
    for (const deck of plan.decks) {
      const [start, end]: Side[] = deck.vertical ? ["n", "s"] : ["w", "e"];
      const at = (side: Side) => map.board[deck.y + STEP[side][1]]?.[deck.x + STEP[side][0]]?.terrain;
      // Each end of the deck lands on road-like ground or continues as bridge.
      for (const side of [start, end]) {
        const frameEnds = side === start ? deck.frame === "single" || deck.frame === "start" : deck.frame === "single" || deck.frame === "end";
        if (frameEnds) expect(ROAD_LIKE.filter((kind) => kind !== "bridge"), `deck ${deck.x},${deck.y} lands ${side}`).toContain(at(side));
        else expect(at(side)).toBe("bridge");
      }
    }
  });

  it.each(cases)("%s: river banks line exactly the river sides that face land on the board", (_name, map) => {
    const plan = planOf(map);
    const banks = new Set(plan.banks.map((bank) => `${bank.x},${bank.y},${bank.side}`));
    for (const tile of map.board.flat()) {
      for (const side of SIDES) {
        const next = map.board[tile.y + STEP[side][1]]?.[tile.x + STEP[side][0]];
        const expected = RIVER.includes(tile.terrain) && !!next && !RIVER.includes(next.terrain);
        expect(banks.has(`${tile.x},${tile.y},${side}`), `${tile.terrain} ${tile.x},${tile.y} ${side}`).toBe(expected);
      }
    }
  });

  it.each(cases)("%s: decals stay inside open plains tiles", (_name, map) => {
    const plan = planOf(map);
    for (const decal of plan.decals) {
      const tile = map.board[Math.floor(decal.y)][Math.floor(decal.x)];
      expect(tile.terrain).toBe("plains");
      expect(Math.floor(decal.x - decal.width / 2)).toBe(tile.x);
      expect(Math.floor(decal.y - decal.height / 2)).toBe(tile.y);
      expect(decal.x + decal.width / 2).toBeLessThan(tile.x + 1);
      expect(decal.y + decal.height / 2).toBeLessThan(tile.y + 1);
    }
  });

  it("is the same every time for the same map", () => {
    for (const map of maps) expect(planOf(map)).toEqual(planOf(map));
  });

  it("has art for every road a map uses, and for every set of sides", () => {
    const used = new Set(maps.flatMap((map) => planOf(map).roads.map((road) => road.key)));
    for (let bits = 1; bits < 16; bits += 1) used.add(bits.toString(2).padStart(4, "0"));
    for (const key of used) expect(statSync(join(ART, `road_${key}.png`)).isFile(), `road_${key}.png`).toBe(true);
  });
});

/** Width and height from a PNG's header, or a JPEG's first frame header. */
function imageSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  if (bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  for (let offset = 2; offset < bytes.length; ) {
    const marker = bytes.readUInt16BE(offset);
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xffc0 && marker <= 0xffc2) return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    offset += 2 + length;
  }
  throw new Error(`no image size in ${path}`);
}

describe("terrain art", () => {
  const files = readdirSync(ART).filter((name) => /\.(png|jpg)$/.test(name));

  it("is sized in powers of two, so the GPU can mipmap it", () => {
    const isPowerOfTwo = (value: number) => value > 0 && (value & (value - 1)) === 0;
    for (const name of files) {
      const { width, height } = imageSize(join(ART, name));
      expect(isPowerOfTwo(width) && isPowerOfTwo(height), `${name} is ${width}x${height}`).toBe(true);
      expect(Math.max(width, height), name).toBeLessThanOrEqual(1024);
    }
  });

  it("stays within a mobile download and GPU budget", () => {
    const bytes = files.reduce((sum, name) => sum + statSync(join(ART, name)).size, 0);
    // Decoded RGBA plus a third for mipmaps.
    const gpu = files.reduce((sum, name) => {
      const { width, height } = imageSize(join(ART, name));
      return sum + width * height * 4 * (4 / 3);
    }, 0);
    expect(bytes / 1024 / 1024).toBeLessThan(4.5);
    expect(gpu / 1024 / 1024).toBeLessThan(32);
  });
});
