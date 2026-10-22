import type { MatchState, TerrainKind, TileState } from "../../engine";

/**
 * What the static terrain layer draws on each tile, worked out from the map alone (no Pixi), so
 * it can be tested. The board is one continuous grass surface; on top of it go grass decals,
 * road overlays, the swamp, lake, and river regions (regionRenderer.ts), the features, and
 * bridge decks. See scripts/build_terrain_art.py for the art.
 */

export type Side = "n" | "e" | "s" | "w";

/** Sides in the order the road art names them: road_<n><e><s><w>.png, 1 where the road leaves. */
export const SIDES: Side[] = ["n", "e", "s", "w"];

const STEP: Record<Side, { dx: number; dy: number }> = { n: { dx: 0, dy: -1 }, e: { dx: 1, dy: 0 }, s: { dx: 0, dy: 1 }, w: { dx: -1, dy: 0 } };

/** Terrain a road leads into: more road, a bridge deck, or a structure's entrance. */
export const ROAD_LIKE: TerrainKind[] = ["road", "bridge", "village", "keep"];

/** Terrain drawn with road arms under it; bridges carry their own deck instead. */
const ROAD_CARRYING: TerrainKind[] = ["road", "village", "keep"];

/** The river region: its water runs under the bridges. */
export const RIVER: TerrainKind[] = ["river", "bridge"];

export type FeatureKind = "forest" | "hill" | "village" | "keep";
const FEATURES: FeatureKind[] = ["forest", "hill", "village", "keep"];

/** Bridge deck frames in bridge_deck.png, left to right. */
export type DeckFrame = "single" | "start" | "middle" | "end";
export const DECK_FRAMES: DeckFrame[] = ["single", "start", "middle", "end"];

export interface RoadPiece { x: number; y: number; key: string; }
export interface FeaturePiece { x: number; y: number; kind: FeatureKind; }
/** A deck tile: across a river running north-south the deck runs east-west, else it is transposed. */
export interface DeckPiece { x: number; y: number; frame: DeckFrame; vertical: boolean; }
/** A painted river bank along the `side` of a river or bridge tile that faces land. */
export interface BankPiece { x: number; y: number; side: Side; }
/** A decal: its frame index, centre in board tiles, and size in tiles. */
export interface DecalPiece { frame: number; x: number; y: number; width: number; height: number; }

export interface TerrainPlan {
  roads: RoadPiece[];
  features: FeaturePiece[];
  decks: DeckPiece[];
  banks: BankPiece[];
  decals: DecalPiece[];
}

export interface DecalFrame { w: number; h: number; }

function at(state: MatchState, x: number, y: number): TileState | undefined {
  return state.board[y]?.[x];
}

export function sidesWhere(state: MatchState, tile: TileState, kinds: TerrainKind[]): Side[] {
  return SIDES.filter((side) => {
    const next = at(state, tile.x + STEP[side].dx, tile.y + STEP[side].dy);
    return !!next && kinds.includes(next.terrain);
  });
}

/** The road art for a set of sides, e.g. "0101" for a road running east-west. */
export function roadKey(sides: Side[]): string {
  return SIDES.map((side) => (sides.includes(side) ? "1" : "0")).join("");
}

/**
 * The road arms on a tile. A road joins every road-like neighbour; a lone road tile runs
 * east-west. Villages and keeps get arms only toward the roads that reach them, under the art.
 */
export function roadSides(state: MatchState, tile: TileState): Side[] {
  if (!ROAD_CARRYING.includes(tile.terrain)) return [];
  const sides = sidesWhere(state, tile, ROAD_LIKE);
  if (tile.terrain === "road" && sides.length === 0) return ["e", "w"];
  return sides;
}

/** Deterministic per-tile random numbers in 0..1. */
export function tileRandom(x: number, y: number, salt: number): number {
  let h = Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x7f4a, 0xc2b2ae35) ^ Math.imul(salt + 0x165667b1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Share of plains tiles that get a decal, and the decal size range (times the art's own scale). */
const DECAL_CHANCE = 0.42;
const DECAL_SCALE = [0.7, 0.95];
/** Decals stay this far inside their tile, so they never reach a road, region, or feature beside it. */
const DECAL_MARGIN = 0.06;

export function planTerrain(state: MatchState, decalFrames: DecalFrame[], decalTile: number): TerrainPlan {
  const plan: TerrainPlan = { roads: [], features: [], decks: [], banks: [], decals: [] };
  for (const tile of state.board.flat()) {
    const { x, y, terrain } = tile;
    const sides = roadSides(state, tile);
    if (sides.length) plan.roads.push({ x, y, key: roadKey(sides) });
    if ((FEATURES as TerrainKind[]).includes(terrain)) plan.features.push({ x, y, kind: terrain as FeatureKind });
    if (terrain === "bridge") plan.decks.push(deckPiece(state, tile));
    if (RIVER.includes(terrain)) {
      // Banks face land on the board; past the board's edge the river carries on.
      for (const side of SIDES) {
        const next = at(state, x + STEP[side].dx, y + STEP[side].dy);
        if (next && !RIVER.includes(next.terrain)) plan.banks.push({ x, y, side });
      }
    }
    if (terrain === "plains" && decalFrames.length && tileRandom(x, y, 1) < DECAL_CHANCE) {
      const frame = Math.floor(tileRandom(x, y, 2) * decalFrames.length);
      const scale = DECAL_SCALE[0] + (DECAL_SCALE[1] - DECAL_SCALE[0]) * tileRandom(x, y, 3);
      const width = (decalFrames[frame].w / decalTile) * scale;
      const height = (decalFrames[frame].h / decalTile) * scale;
      const roomX = 1 - width - DECAL_MARGIN * 2;
      const roomY = 1 - height - DECAL_MARGIN * 2;
      if (roomX <= 0 || roomY <= 0) continue;
      plan.decals.push({
        frame,
        x: x + DECAL_MARGIN + width / 2 + roomX * tileRandom(x, y, 4),
        y: y + DECAL_MARGIN + height / 2 + roomY * tileRandom(x, y, 5),
        width,
        height
      });
    }
  }
  return plan;
}

function deckPiece(state: MatchState, tile: TileState): DeckPiece {
  const spans = sidesWhere(state, tile, ["bridge"]);
  const landings = sidesWhere(state, tile, ROAD_LIKE);
  const along = (first: Side, second: Side) => spans.includes(first) || spans.includes(second) || landings.includes(first) || landings.includes(second);
  // The deck runs toward its approaches (or the rest of the span); east-west when both could.
  const vertical = !along("e", "w") && along("n", "s");
  const [start, end]: Side[] = vertical ? ["n", "s"] : ["w", "e"];
  const before = spans.includes(start);
  const after = spans.includes(end);
  const frame: DeckFrame = before && after ? "middle" : after ? "start" : before ? "end" : "single";
  return { x: tile.x, y: tile.y, frame, vertical };
}
