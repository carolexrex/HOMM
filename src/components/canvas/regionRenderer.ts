import { Container, Graphics, Matrix, Texture } from "pixi.js";
import type { MatchState, TerrainKind } from "../../engine";
import swampUrl from "../../assets/terrain_swamp.jpg";
import lakeWaterUrl from "../../assets/terrain/lake_water.jpg";
import shoreBankUrl from "../../assets/terrain/shore_bank.jpg";
import { regionTileOutline, type RegionEdge, type RegionTest } from "./regionShapes";

/**
 * Swamps and lakes are drawn as continuous regions over the grass that drawTerrain lays under
 * them: one texture runs across the whole region in board coordinates (no per-tile repeats or
 * seams between neighbouring tiles), and only the edges that face land are inset, softened,
 * and rounded. See regionShapes.ts for the outlines.
 */

const regionTextures = {
  swamp: Texture.from(swampUrl),
  lake: Texture.from(lakeWaterUrl),
  bank: Texture.from(shoreBankUrl)
};

/**
 * Resolves once the region textures have loaded. Texture fills compute their coordinates from
 * the texture size when drawn, so regions are drawn only after this (sprites update themselves).
 */
export const regionTexturesReady: Promise<void> = Promise.all(
  Object.values(regionTextures).map(
    (texture) =>
      new Promise<void>((resolve) => {
        const base = texture.baseTexture;
        if (base.valid) return resolve();
        base.once("loaded", () => resolve());
        base.once("error", () => resolve());
      })
  )
).then(() => undefined);

interface RegionLayer extends RegionEdge {
  texture: Texture;
  /** Board tiles covered by one copy of the texture. */
  tilesPerTexture: number;
  alpha: number;
  tint?: number;
  /** Shifts the texture, in tiles, so stacked layers of one texture do not line up. */
  offset?: number;
}

// Three nested passes fade the bog into the grass over the outer fifth of a land-facing side.
const SWAMP_LAYERS: RegionLayer[] = [
  { texture: regionTextures.swamp, tilesPerTexture: 3, alpha: 0.32, inset: 0.015, wobble: 0.035, cornerRadius: 0.32 },
  { texture: regionTextures.swamp, tilesPerTexture: 3, alpha: 0.5, inset: 0.075, wobble: 0.04, cornerRadius: 0.3 },
  { texture: regionTextures.swamp, tilesPerTexture: 3, alpha: 1, inset: 0.14, wobble: 0.045, cornerRadius: 0.27 }
];

// The lake fills its impassable tiles: a pebble bank at the tile edge, shallows, then open water,
// with a second, larger copy of the water over it so its repeat does not line up across the lake.
const LAKE_LAYERS: RegionLayer[] = [
  { texture: regionTextures.bank, tilesPerTexture: 1, alpha: 0.6, inset: 0.012, wobble: 0.01, cornerRadius: 0.42, tint: 0xcbbb98 },
  { texture: regionTextures.bank, tilesPerTexture: 1, alpha: 1, inset: 0.035, wobble: 0.015, cornerRadius: 0.4, tint: 0xcbbb98 },
  { texture: regionTextures.lake, tilesPerTexture: 2, alpha: 0.6, inset: 0.085, wobble: 0.02, cornerRadius: 0.36, tint: 0xd6ecef },
  { texture: regionTextures.lake, tilesPerTexture: 2, alpha: 1, inset: 0.13, wobble: 0.025, cornerRadius: 0.32 },
  { texture: regionTextures.lake, tilesPerTexture: 3.3, alpha: 0.38, inset: 0.13, wobble: 0.025, cornerRadius: 0.32, offset: 0.61 }
];

const REGIONS: Array<{ kinds: TerrainKind[]; layers: RegionLayer[] }> = [
  { kinds: ["swamp"], layers: SWAMP_LAYERS },
  { kinds: ["water", "shore"], layers: LAKE_LAYERS }
];

/** Terrain kinds drawn as regions; drawTerrain gives their tiles a grass base. */
export const REGION_TERRAIN: TerrainKind[] = REGIONS.flatMap((region) => region.kinds);

/**
 * Builds every swamp and lake on the board, in board coordinates: tile 0,0 at the origin and
 * `size` pixels per tile. The layer depends only on the map, so the canvas keeps it and moves and
 * scales it with the view.
 */
export function buildTerrainRegions(state: MatchState, size: number): Container {
  const regions = new Container();
  for (const { kinds, layers } of REGIONS) {
    const tiles = state.board.flat().filter((tile) => kinds.includes(tile.terrain));
    if (!tiles.length) continue;
    const inRegion: RegionTest = (x, y) => kinds.includes(state.board[y]?.[x]?.terrain as TerrainKind);
    const graphics = new Graphics();
    for (const layer of layers) {
      const texture = layer.texture;
      const scale = (size * layer.tilesPerTexture) / texture.width;
      const shift = (layer.offset ?? 0) * size;
      const matrix = new Matrix(scale, 0, 0, scale, shift, shift);
      for (const tile of tiles) {
        const outline = regionTileOutline(inRegion, tile.x, tile.y, layer);
        const points = outline.map((value, index) => (index % 2 === 0 ? (tile.x + value) * size : (tile.y + value) * size));
        graphics.beginTextureFill({ texture, matrix, alpha: layer.alpha, color: layer.tint ?? 0xffffff });
        graphics.drawPolygon(points);
        graphics.endFill();
      }
    }
    regions.addChild(graphics);
  }
  return regions;
}
