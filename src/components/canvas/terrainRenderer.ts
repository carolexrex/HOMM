import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { PLAYER_COLORS } from "../../engine";
import type { MatchState, TerrainKind, TileState } from "../../engine";
import plainsUrl from "../../assets/terrain_plains.png";
import plains2Url from "../../assets/terrain_plains_2.png";
import plains3Url from "../../assets/terrain_plains_3.png";
import forestUrl from "../../assets/terrain_forest.png";
import hillUrl from "../../assets/terrain_hill.png";
import keepUrl from "../../assets/terrain_keep.png";
import bridgeUrl from "../../assets/terrain_bridge.png";
import bridgeWideUrl from "../../assets/terrain_bridge_wide.png";
import swampUrl from "../../assets/terrain_swamp.png";
import villageUrl from "../../assets/terrain_town.png";
import roadHorizontalUrl from "../../assets/terrain_road_horizontal.png";
import roadVerticalUrl from "../../assets/terrain_road_vertical.png";
import roadCornerUrl from "../../assets/terrain_corner.png";
import roadCrossroadsUrl from "../../assets/terrain_crossroads.png";
import roadTJunctionUrl from "../../assets/terrain_road_t_junction.png";
import roadTJunctionRightUrl from "../../assets/terrain_road_t_junction_right.png";
import roadTJunctionLeftUrl from "../../assets/terrain_road_t_junction_left.png";
import roadTJunctionUpUrl from "../../assets/terrain_road_t_junction_up.png";
import riverHorizontalUrl from "../../assets/terrain_river_horizontal.png";
import riverCornerUrl from "../../assets/terrain_river_corner.png";
import riverTJunctionUrl from "../../assets/terrain_river_t_junction.png";
import riverCrossroadsUrl from "../../assets/terrain_river_crossroads.png";
import riverEdgeUrl from "../../assets/terrain_river_edge.png";
import waterOpenUrl from "../../assets/terrain/water_open.png";
import shoreOverlayUrl from "../../assets/terrain/shore_overlay.png";
import type { ProjectedCell } from "./types";
import { clamp } from "./geometry";

const terrainTextures = {
  plains: Texture.from(plainsUrl),
  plains2: Texture.from(plains2Url),
  plains3: Texture.from(plains3Url),
  forest: Texture.from(forestUrl),
  hill: Texture.from(hillUrl),
  keep: Texture.from(keepUrl),
  bridge: Texture.from(bridgeUrl),
  bridgeWide: Texture.from(bridgeWideUrl),
  swamp: Texture.from(swampUrl),
  village: Texture.from(villageUrl)
};

const roadTextures = {
  horizontal: Texture.from(roadHorizontalUrl),
  vertical: Texture.from(roadVerticalUrl),
  corner: Texture.from(roadCornerUrl),
  cross: Texture.from(roadCrossroadsUrl),
  t: Texture.from(roadTJunctionUrl),
  tRight: Texture.from(roadTJunctionRightUrl),
  tLeft: Texture.from(roadTJunctionLeftUrl),
  tUp: Texture.from(roadTJunctionUpUrl)
};

const riverTextures = {
  horizontal: Texture.from(riverHorizontalUrl),
  corner: Texture.from(riverCornerUrl),
  t: Texture.from(riverTJunctionUrl),
  cross: Texture.from(riverCrossroadsUrl),
  edge: Texture.from(riverEdgeUrl),
  water: Texture.from(waterOpenUrl),
  shore: Texture.from(shoreOverlayUrl)
};

export function drawHighlight(root: Container, cell: ProjectedCell, fill: number, fillAlpha: number, stroke: number, strokeAlpha: number) {
  const highlight = new Graphics();
  highlight.lineStyle(Math.max(1.5, cell.size * 0.03), stroke, strokeAlpha);
  highlight.beginFill(fill, fillAlpha);
  highlight.drawRoundedRect(cell.x + 4, cell.y + 4, cell.size - 8, cell.size - 8, Math.max(5, cell.size * 0.14));
  highlight.endFill();
  root.addChild(highlight);
}

export function drawTerrain(root: Container, state: MatchState, tile: TileState, x: number, y: number, size: number) {
  const palette = terrainPalette(tile.terrain);
  const shadow = new Graphics();
  shadow.beginFill(palette.shadow, 0.28);
  shadow.drawRoundedRect(x, y + size * 0.03, size, size, 16);
  shadow.endFill();
  root.addChild(shadow);

  if (tile.terrain === "road") {
    drawRoadTile(root, state, tile, x, y, size);
    if (tile.structure) drawOwnershipMarker(root, tile, x, y, size);
    return;
  }

  if (tile.terrain === "river") {
    drawRiverTile(root, state, tile, x, y, size);
    if (tile.structure) drawOwnershipMarker(root, tile, x, y, size);
    return;
  }

  if (tile.terrain === "water") {
    const fringe = waterFringeRotation(state, tile);
    if (fringe === null) {
      drawBaseTerrainSprite(root, riverTextures.water, x, y, size, 0, terrainTint(tile));
    } else {
      drawPlainsTile(root, tile, x, y, size);
      drawBaseTerrainSprite(root, riverTextures.shore, x, y, size, fringe);
    }
    return;
  }

  if (tile.terrain === "shore") {
    drawShoreTile(root, state, tile, x, y, size);
    return;
  }

  const config = resolveTerrainSprite(state, tile);
  if (config) {
    drawBaseTerrainSprite(root, config.texture, x, y, size, config.rotation, config.tint);
    if (tile.structure) drawOwnershipMarker(root, tile, x, y, size);
    return;
  }

  const fallback = new Graphics();
  fallback.beginFill(palette.base, 0.94);
  fallback.drawRoundedRect(x, y, size, size, 16);
  fallback.endFill();
  root.addChild(fallback);

  if (tile.structure) drawOwnershipMarker(root, tile, x, y, size);
}

function drawBaseTerrainSprite(root: Container, texture: Texture, x: number, y: number, size: number, rotation = 0, tint = 0xffffff) {
  const sprite = new Sprite(texture);
  if (rotation !== 0) {
    sprite.anchor.set(0.5);
    sprite.x = x + size * 0.5;
    sprite.y = y + size * 0.5;
  } else {
    sprite.x = x;
    sprite.y = y;
  }
  sprite.width = size;
  sprite.height = size;
  sprite.rotation = rotation;
  sprite.tint = tint;
  sprite.roundPixels = true;
  root.addChild(sprite);
}

function drawPlainsTile(root: Container, tile: TileState, x: number, y: number, size: number) {
  drawBaseTerrainSprite(root, selectPlainsTexture(tile), x, y, size, terrainRotation(tile), terrainTint(tile));
}

function drawOwnershipMarker(root: Container, tile: TileState, x: number, y: number, size: number) {
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

function drawRoadTile(root: Container, state: MatchState, tile: TileState, x: number, y: number, size: number) {
  const dirs = neighborDirections(state, tile, ["road", "bridge", "village", "keep"]);
  const activeDirs: Array<"n" | "s" | "e" | "w"> = dirs.length > 0 ? dirs : ["e", "w"];
  const config = resolveRoadSprite(activeDirs);
  drawBaseTerrainSprite(root, config.texture, x, y, size, config.rotation);
}

function drawRiverTile(root: Container, state: MatchState, tile: TileState, x: number, y: number, size: number) {
  const config = resolveRiverSprite(state, tile);
  drawBaseTerrainSprite(root, config.texture, x, y, size, config.rotation);
}

function drawShoreTile(root: Container, state: MatchState, tile: TileState, x: number, y: number, size: number) {
  drawPlainsTile(root, tile, x, y, size);
  drawBaseTerrainSprite(root, riverTextures.shore, x, y, size, shoreRotation(state, tile));
}

function resolveRoadSprite(dirs: Array<"n" | "s" | "e" | "w">): { texture: Texture; rotation?: number } {
  const hasN = dirs.includes("n");
  const hasS = dirs.includes("s");
  const hasE = dirs.includes("e");
  const hasW = dirs.includes("w");

  if (dirs.length >= 4) return { texture: roadTextures.cross };
  if (dirs.length === 3) {
    if (!hasN) return { texture: roadTextures.t };
    if (!hasE) return { texture: roadTextures.tLeft };
    if (!hasS) return { texture: roadTextures.tUp };
    return { texture: roadTextures.tRight };
  }
  if (dirs.length === 2) {
    if (hasN && hasS) return { texture: roadTextures.vertical };
    if (hasE && hasW) return { texture: roadTextures.horizontal };
    if (hasE && hasS) return { texture: roadTextures.corner, rotation: 0 };
    if (hasS && hasW) return { texture: roadTextures.corner, rotation: Math.PI / 2 };
    if (hasN && hasW) return { texture: roadTextures.corner, rotation: Math.PI };
    return { texture: roadTextures.corner, rotation: -Math.PI / 2 };
  }
  if (hasN || hasS) return { texture: roadTextures.vertical };
  return { texture: roadTextures.horizontal };
}

function riverLikeAt(state: MatchState, x: number, y: number): boolean {
  const next = state.board[y]?.[x];
  return !!next && (next.terrain === "river" || next.terrain === "bridge");
}

function resolveRiverSprite(state: MatchState, tile: TileState): { texture: Texture; rotation?: number } {
  const dirs = neighborDirections(state, tile, ["river", "bridge"]);
  const hasN = dirs.includes("n");
  const hasS = dirs.includes("s");
  const hasE = dirs.includes("e");
  const hasW = dirs.includes("w");
  const { x, y } = tile;

  if (hasE && !riverLikeAt(state, x + 2, y) && ((hasN && riverLikeAt(state, x + 1, y - 1)) || (hasS && riverLikeAt(state, x + 1, y + 1)))) {
    return { texture: riverTextures.edge };
  }
  if (hasW && !riverLikeAt(state, x - 2, y) && ((hasN && riverLikeAt(state, x - 1, y - 1)) || (hasS && riverLikeAt(state, x - 1, y + 1)))) {
    return { texture: riverTextures.edge, rotation: Math.PI };
  }
  if (hasS && !riverLikeAt(state, x, y + 2) && ((hasE && riverLikeAt(state, x + 1, y + 1)) || (hasW && riverLikeAt(state, x - 1, y + 1)))) {
    return { texture: riverTextures.edge, rotation: Math.PI / 2 };
  }
  if (hasN && !riverLikeAt(state, x, y - 2) && ((hasE && riverLikeAt(state, x + 1, y - 1)) || (hasW && riverLikeAt(state, x - 1, y - 1)))) {
    return { texture: riverTextures.edge, rotation: -Math.PI / 2 };
  }

  if (dirs.length >= 4) return { texture: riverTextures.cross };
  if (dirs.length === 3) {
    if (!hasN) return { texture: riverTextures.t, rotation: 0 };
    if (!hasE) return { texture: riverTextures.t, rotation: Math.PI / 2 };
    if (!hasS) return { texture: riverTextures.t, rotation: Math.PI };
    return { texture: riverTextures.t, rotation: -Math.PI / 2 };
  }
  if (dirs.length === 2) {
    if (hasN && hasS) return { texture: riverTextures.horizontal, rotation: Math.PI / 2 };
    if (hasE && hasW) return { texture: riverTextures.horizontal };
    if (hasE && hasS) return { texture: riverTextures.corner, rotation: 0 };
    if (hasS && hasW) return { texture: riverTextures.corner, rotation: Math.PI / 2 };
    if (hasN && hasW) return { texture: riverTextures.corner, rotation: Math.PI };
    return { texture: riverTextures.corner, rotation: -Math.PI / 2 };
  }
  if (hasN || hasS) return { texture: riverTextures.horizontal, rotation: Math.PI / 2 };
  return { texture: riverTextures.horizontal };
}

function resolveTerrainSprite(state: MatchState, tile: TileState): { texture: Texture; rotation?: number; tint?: number } | null {
  switch (tile.terrain) {
    case "plains": return { texture: selectPlainsTexture(tile), rotation: terrainRotation(tile), tint: terrainTint(tile) };
    case "forest": return { texture: terrainTextures.forest };
    case "hill": return { texture: terrainTextures.hill };
    case "swamp": return { texture: terrainTextures.swamp };
    case "village": return { texture: terrainTextures.village };
    case "keep": return { texture: terrainTextures.keep };
    case "bridge": {
      const span = neighborDirections(state, tile, ["bridge"]);
      if (span.includes("e")) return { texture: terrainTextures.bridgeWide };
      if (span.includes("w")) return { texture: terrainTextures.bridgeWide, rotation: Math.PI };
      if (span.includes("s")) return { texture: terrainTextures.bridgeWide, rotation: Math.PI / 2 };
      if (span.includes("n")) return { texture: terrainTextures.bridgeWide, rotation: -Math.PI / 2 };
      return { texture: terrainTextures.bridge, rotation: shouldRotateBridge(state, tile) ? Math.PI / 2 : 0 };
    }
    default: return null;
  }
}

function selectPlainsTexture(tile: TileState): Texture {
  const hash = ((tile.x * 73856093) ^ (tile.y * 19349663)) >>> 0;
  const variant = hash % 8;
  if (variant === 0) return terrainTextures.plains2;
  if (variant === 5) return terrainTextures.plains3;
  return terrainTextures.plains;
}

function shouldRotateBridge(state: MatchState, tile: TileState): boolean {
  const riverDirs = neighborDirections(state, tile, ["river"]);
  return riverDirs.includes("n") || riverDirs.includes("s");
}

function waterFringeRotation(state: MatchState, tile: TileState): number | null {
  const landDirs: Array<"n" | "s" | "e" | "w"> = [];
  const checks: Array<["n" | "s" | "e" | "w", number, number]> = [["n", 0, -1], ["s", 0, 1], ["w", -1, 0], ["e", 1, 0]];
  for (const [dir, dx, dy] of checks) {
    const next = state.board[tile.y + dy]?.[tile.x + dx];
    if (next && next.terrain !== "water" && next.terrain !== "shore") landDirs.push(dir);
  }
  if (landDirs.includes("n")) return 0;
  if (landDirs.includes("s")) return Math.PI;
  if (landDirs.includes("w")) return -Math.PI / 2;
  if (landDirs.includes("e")) return Math.PI / 2;
  return null;
}

function shoreRotation(state: MatchState, tile: TileState): number {
  const waterDirs = neighborDirections(state, tile, ["water"]);
  if (waterDirs.includes("s")) return 0;
  if (waterDirs.includes("w")) return Math.PI / 2;
  if (waterDirs.includes("n")) return Math.PI;
  if (waterDirs.includes("e")) return -Math.PI / 2;
  return 0;
}

function terrainTint(tile: TileState): number {
  const variance = ((tile.x * 31 + tile.y * 17) % 5) - 2;
  const value = clamp(255 + variance * 5, 236, 255);
  return (value << 16) | (value << 8) | value;
}

function terrainRotation(_tile: TileState): number {
  return 0;
}

function neighborDirections(state: MatchState, tile: TileState, kinds: TerrainKind[]): Array<"n" | "s" | "e" | "w"> {
  const directions: Array<"n" | "s" | "e" | "w"> = [];
  const checks: Array<["n" | "s" | "e" | "w", number, number]> = [["n", 0, -1], ["s", 0, 1], ["w", -1, 0], ["e", 1, 0]];
  for (const [dir, dx, dy] of checks) {
    const next = state.board[tile.y + dy]?.[tile.x + dx];
    if (next && kinds.includes(next.terrain)) directions.push(dir);
  }
  return directions;
}

function terrainPalette(terrain: TerrainKind) {
  switch (terrain) {
    case "plains": return { base: 0xa7b66a, shadow: 0x728c43 };
    case "forest": return { base: 0x6a8d4d, shadow: 0x3b5630 };
    case "hill": return { base: 0xb9af7b, shadow: 0x8c7f53 };
    case "road": return { base: 0xb7976a, shadow: 0x7a5e44 };
    case "swamp": return { base: 0x5b7353, shadow: 0x314634 };
    case "river": return { base: 0x567ea2, shadow: 0x2b4a64 };
    case "water": return { base: 0x315f78, shadow: 0x173344 };
    case "shore": return { base: 0x6f8651, shadow: 0x344627 };
    case "bridge": return { base: 0x7d6040, shadow: 0x4c311f };
    case "village": return { base: 0xb3b98b, shadow: 0x736a48 };
    case "keep": return { base: 0x8f9ca3, shadow: 0x5b6672 };
  }
}
