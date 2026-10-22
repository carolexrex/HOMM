import { BLEND_MODES, Container, Graphics, Matrix, Rectangle, Sprite, Texture } from "pixi.js";
import { PLAYER_COLORS } from "../../engine";
import type { MatchState, TileState } from "../../engine";
import grassBaseUrl from "../../assets/terrain/board/grass_base.jpg";
import grassToneUrl from "../../assets/terrain/board/grass_tone.png";
import grassDecalsUrl from "../../assets/terrain/board/grass_decals.png";
import decalAtlas from "../../assets/terrain/board/decals.json";
import bridgeDeckUrl from "../../assets/terrain/board/bridge_deck.png";
import riverBankUrl from "../../assets/terrain/board/river_bank.png";
import forestUrl from "../../assets/terrain/board/forest.png";
import hillUrl from "../../assets/terrain/board/hill.png";
import villageUrl from "../../assets/terrain/board/village.png";
import keepUrl from "../../assets/terrain/board/keep.png";
import type { ProjectedCell } from "./types";
import { buildTerrainRegions, regionTexturesReady, texturesReady } from "./regionRenderer";
import { DECK_FRAMES, planTerrain, type FeatureKind } from "./terrainPlan";

/**
 * The board's terrain is one static layer per map, built in board coordinates (tile 0,0 at the
 * origin, `size` pixels per tile) and moved and scaled with the view, never redrawn per frame:
 *
 * 1. One seamless grass texture filled across the whole board (a copy per 2x2 tiles), with a
 *    soft light-and-shade texture multiplied over it at a scale that does not line up with the
 *    tiles, so there are no tile squares and no obvious repeat.
 * 2. Rocks, clover, and bushes scattered over plains tiles.
 * 3. Road overlays: transparent apart from the road, one per set of connected sides, all with
 *    the same width and the same pixels where they cross a tile side (terrainPlan.ts).
 * 4. Swamps, lakes, and rivers as continuous regions (regionRenderer.ts), with painted banks
 *    along the river's land-facing sides.
 * 5. Forests, hills, villages, and keeps, masked to their objects over the shared grass.
 * 6. Bridge decks over the river.
 *
 * Every texture is shared art loaded once, all of it prepared offline by
 * scripts/build_terrain_art.py. Textures filled by Graphics (the grass, its tone, and the region
 * textures) are kept apart from those drawn by sprites, as Pixi switches fill textures to repeat.
 */

const roadUrls = import.meta.glob<string>("../../assets/terrain/board/road_*.png", { eager: true, import: "default" });

const GRASS_TILES_PER_TEXTURE = 2;
/** Not a whole number of tiles, so the light and shade never lines up with the tile grid. */
const TONE_TILES_PER_TEXTURE = 5.37;

const grassTextures = {
  base: Texture.from(grassBaseUrl),
  tone: Texture.from(grassToneUrl)
};

const featureTextures: Record<FeatureKind, Texture> = {
  forest: Texture.from(forestUrl),
  hill: Texture.from(hillUrl),
  village: Texture.from(villageUrl),
  keep: Texture.from(keepUrl)
};

const roadTextures = new Map<string, Texture>(
  Object.entries(roadUrls).map(([path, url]) => [/road_(\d{4})\.png$/.exec(path)![1], Texture.from(url)])
);

const decalSheet = Texture.from(grassDecalsUrl);
const deckSheet = Texture.from(bridgeDeckUrl);
const bankSheet = Texture.from(riverBankUrl);
/** Depth of a bank strip, in tiles: its frame's height over its width. */
const BANK_DEPTH = 0.25;

/** Frames of the decal and deck sheets, cut once the sheets have loaded (they need their sizes). */
let decalFrames: Texture[] = [];
let deckFrames: Texture[] = [];
/** The painting's north bank (land above the water) and south bank (land below). */
let bankFrames: { north: Texture; south: Texture } | null = null;

/** Resolves once every terrain texture has loaded; the layer is built only after this. */
export const terrainTexturesReady: Promise<void> = Promise.all([
  regionTexturesReady,
  texturesReady([...Object.values(grassTextures), ...Object.values(featureTextures), ...roadTextures.values(), decalSheet, deckSheet, bankSheet])
]).then(() => {
  decalFrames = decalAtlas.frames.map((frame) => new Texture(decalSheet.baseTexture, new Rectangle(frame.x, frame.y, frame.w, frame.h)));
  const deckWidth = deckSheet.width / DECK_FRAMES.length;
  deckFrames = DECK_FRAMES.map((_, index) => new Texture(deckSheet.baseTexture, new Rectangle(index * deckWidth, 0, deckWidth, deckSheet.height)));
  const half = bankSheet.height / 2;
  bankFrames = {
    north: new Texture(bankSheet.baseTexture, new Rectangle(0, 0, bankSheet.width, half)),
    south: new Texture(bankSheet.baseTexture, new Rectangle(0, half, bankSheet.width, half))
  };
});

/** Builds the static terrain layer for `state`'s map; `size` is the tile size in board pixels. */
export function buildTerrainLayer(state: MatchState, size: number): Container {
  const layer = new Container();
  const cols = state.board[0].length;
  const rows = state.board.length;
  const plan = planTerrain(state, decalAtlas.frames, decalAtlas.tile);

  layer.addChild(fill(grassTextures.base, GRASS_TILES_PER_TEXTURE, cols, rows, size));
  const tone = fill(grassTextures.tone, TONE_TILES_PER_TEXTURE, cols, rows, size, 0.37);
  tone.blendMode = BLEND_MODES.MULTIPLY;
  layer.addChild(tone);

  for (const decal of plan.decals) {
    const sprite = new Sprite(decalFrames[decal.frame]);
    sprite.anchor.set(0.5);
    sprite.position.set(decal.x * size, decal.y * size);
    sprite.width = decal.width * size;
    sprite.height = decal.height * size;
    layer.addChild(sprite);
  }

  for (const road of plan.roads) layer.addChild(tileSprite(roadTextures.get(road.key)!, road.x, road.y, size));
  layer.addChild(buildTerrainRegions(state, size));
  for (const bank of plan.banks) {
    // Land to the north or west takes the painting's north bank, to the south or east its south
    // bank; west and east banks are those transposed, so the painted light stays top-left.
    const texture = bank.side === "n" || bank.side === "w" ? bankFrames!.north : bankFrames!.south;
    const sprite = new Sprite(texture);
    const scale = size / texture.width;
    const far = bank.side === "s" || bank.side === "e" ? 1 - BANK_DEPTH : 0;
    if (bank.side === "n" || bank.side === "s") {
      sprite.position.set(bank.x * size, (bank.y + far) * size);
      sprite.scale.set(scale);
    } else {
      sprite.position.set((bank.x + far) * size, bank.y * size);
      transpose(sprite, scale);
    }
    layer.addChild(sprite);
  }
  for (const feature of plan.features) layer.addChild(tileSprite(featureTextures[feature.kind], feature.x, feature.y, size));

  for (const deck of plan.decks) {
    const texture = deckFrames[DECK_FRAMES.indexOf(deck.frame)];
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set((deck.x + 0.5) * size, (deck.y + 0.5) * size);
    const scale = size / texture.width;
    if (deck.vertical) {
      transpose(sprite, scale);
    } else {
      sprite.scale.set(scale);
    }
    layer.addChild(sprite);
  }
  return layer;
}

/**
 * Mirrors a sprite across its top-left to bottom-right diagonal (a quarter turn and a flip)
 * instead of turning it, so art lit from the top left is still lit from the top left.
 */
function transpose(sprite: Sprite, scale: number) {
  sprite.rotation = Math.PI / 2;
  sprite.scale.set(scale, -scale);
}

/** A rectangle over the whole board filled with a repeating texture, `tiles` board tiles per copy. */
function fill(texture: Texture, tiles: number, cols: number, rows: number, size: number, offset = 0): Graphics {
  const scale = (size * tiles) / texture.width;
  const graphics = new Graphics();
  graphics.beginTextureFill({ texture, matrix: new Matrix(scale, 0, 0, scale, offset * size, offset * size) });
  graphics.drawRect(0, 0, cols * size, rows * size);
  graphics.endFill();
  return graphics;
}

function tileSprite(texture: Texture, x: number, y: number, size: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.position.set(x * size, y * size);
  sprite.width = size;
  sprite.height = size;
  return sprite;
}

export function drawHighlight(root: Container, cell: ProjectedCell, fill: number, fillAlpha: number, stroke: number, strokeAlpha: number) {
  const highlight = new Graphics();
  highlight.lineStyle(Math.max(1.5, cell.size * 0.03), stroke, strokeAlpha);
  highlight.beginFill(fill, fillAlpha);
  highlight.drawRoundedRect(cell.x + 4, cell.y + 4, cell.size - 8, cell.size - 8, Math.max(5, cell.size * 0.14));
  highlight.endFill();
  root.addChild(highlight);
}

/** The flag on a village or keep in its owner's colour; drawn with each redraw, as owners change. */
export function drawOwnershipMarker(root: Container, tile: TileState, x: number, y: number, size: number) {
  const ownerColor = tile.owner ? PLAYER_COLORS[tile.owner] : 0xa0a9ab;
  const marker = new Graphics();
  const poleX = x + size * 0.16;
  const poleTop = y + size * 0.12;
  const poleBottom = y + size * 0.34;
  const flagWidth = size * 0.17;
  const flagHeight = size * 0.1;

  marker.lineStyle(Math.max(1.5, size * 0.028), 0x112024, 0.92);
  marker.moveTo(poleX, poleBottom);
  marker.lineTo(poleX, poleTop);
  marker.beginFill(ownerColor, tile.owner ? 0.96 : 0.58);
  marker.moveTo(poleX, poleTop + size * 0.01);
  marker.lineTo(poleX + flagWidth, poleTop + flagHeight * 0.18);
  marker.lineTo(poleX, poleTop + flagHeight);
  marker.closePath();
  marker.endFill();
  marker.beginFill(0xf4efe1, tile.owner ? 0.95 : 0.45);
  marker.drawCircle(poleX, poleTop, size * 0.018);
  marker.endFill();

  const base = new Graphics();
  base.beginFill(0x0f1d21, 0.55);
  base.drawRoundedRect(x + size * 0.08, y + size * 0.06, size * 0.19, size * 0.16, size * 0.06);
  base.endFill();
  root.addChild(base);
  root.addChild(marker);
}
