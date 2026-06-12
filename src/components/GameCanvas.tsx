import { useEffect, useMemo, useRef, useState } from "react";
import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { getUnitLevel, PLAYER_COLORS, unitDefinitions } from "../engine";
import type { Coord, MatchState, TerrainKind, TileState, UnitKind, UnitState } from "../engine";
import plainsUrl from "../assets/terrain_plains.png";
import plains2Url from "../assets/terrain_plains_2.png";
import plains3Url from "../assets/terrain_plains_3.png";
import forestUrl from "../assets/terrain_forest.png";
import hillUrl from "../assets/terrain_hill.png";
import keepUrl from "../assets/terrain_keep.png";
import bridgeUrl from "../assets/terrain_bridge.png";
import swampUrl from "../assets/terrain_swamp.png";
import villageUrl from "../assets/terrain_town.png";
import roadHorizontalUrl from "../assets/terrain_road_horizontal.png";
import roadVerticalUrl from "../assets/terrain_road_vertical.png";
import roadCornerUrl from "../assets/terrain_corner.png";
import roadCrossroadsUrl from "../assets/terrain_crossroads.png";
import roadTJunctionUrl from "../assets/terrain_road_t_junction.png";
import roadTJunctionRightUrl from "../assets/terrain_road_t_junction_right.png";
import roadTJunctionLeftUrl from "../assets/terrain_road_t_junction_left.png";
import roadTJunctionUpUrl from "../assets/terrain_road_t_junction_up.png";
import riverHorizontalUrl from "../assets/terrain_river_horizontal.png";
import riverCornerUrl from "../assets/terrain_river_corner.png";
import riverTJunctionUrl from "../assets/terrain_river_t_junction.png";
import riverCrossroadsUrl from "../assets/terrain_river_crossroads.png";
import riverEdgeUrl from "../assets/terrain_river_edge.png";
import bridgeWideUrl from "../assets/terrain_bridge_wide.png";
import waterOpenUrl from "../assets/terrain/water_open.png";
import shoreOverlayUrl from "../assets/terrain/shore_overlay.png";
import militiaUrl from "../assets/units/militia.png";
import swordsmanUrl from "../assets/units/swordsman.png";
import pikemanUrl from "../assets/units/pikeman.png";
import archerUrl from "../assets/units/archer.png";
import cavalryUrl from "../assets/units/cavalry.png";
import assassinUrl from "../assets/units/assassin.png";
import catapultUrl from "../assets/units/catapult.png";
import healerUrl from "../assets/units/healer.png";

interface GameCanvasProps {
  state: MatchState;
  selectedUnitId: string | null;
  reachable: Coord[];
  attackableIds: string[];
  healableIds: string[];
  onTileTap(coord: Coord): void;
  attackPreviews?: Record<string, { damage: number; retaliation: number }>;
  animateMovement: boolean;
  showHint?: boolean;
}

interface SurfaceSize { width: number; height: number; }
interface PanState { x: number; y: number; }
interface Layout {
  cols: number;
  rows: number;
  width: number;
  height: number;
  boardWidth: number;
  boardHeight: number;
  fitZoom: number;
  step: number;
}
interface ProjectedCell { x: number; y: number; centerX: number; centerY: number; size: number; }
interface PointerSnapshot { x: number; y: number; }
interface InteractionState {
  mode: "idle" | "tap" | "pan" | "pinch";
  pointerId: number | null;
  pointerType: string | null;
  moved: boolean;
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
  pinchStartDistance: number;
  pinchStartZoom: number;
  pinchWorldX: number;
  pinchWorldY: number;
}
interface MoveVisual { unitId: string; from: Coord; to: Coord; start: number; duration: number; }
interface PopupVisual { id: string; coord: Coord; label: string; color: number; start: number; duration: number; }
interface AttackVisual { id: string; kind: "arrow" | "stone" | "slash" | "heal"; from: Coord; to: Coord; color: number; start: number; duration: number; }
interface ActiveVisuals { moves: MoveVisual[]; popups: PopupVisual[]; attacks: AttackVisual[]; }

const NATURAL_CELL = 84;
const VIEWPORT_PADDING = 12;
const BOARD_TOP_PADDING = 16;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.2;
const MOVE_ANIMATION_MS = 220;
const PROJECTILE_MS = 240;
const POPUP_MS = 760;
const SLASH_MS = 170;
const ARROW_COLOR = 0xf4efe1;
const STONE_COLOR = 0xe3b2ab;
const HEAL_COLOR = 0x8fdc80;

const popupTextStyle = new TextStyle({ fill: 0xf4efe1, fontFamily: "Trebuchet MS", fontSize: 14, fontWeight: "700" });
const popupDarkStyle = new TextStyle({ fill: 0x102125, fontFamily: "Trebuchet MS", fontSize: 10, fontWeight: "700" });
const combatPreviewStyle = new TextStyle({ fill: 0xfff3ef, fontFamily: "Trebuchet MS", fontSize: 13, fontWeight: "800" });
const combatPreviewMetaStyle = new TextStyle({ fill: 0xffd7cf, fontFamily: "Trebuchet MS", fontSize: 9, fontWeight: "700" });

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

const unitTextures: Record<UnitKind, Texture> = {
  militia: Texture.from(militiaUrl), swordsman: Texture.from(swordsmanUrl), pikeman: Texture.from(pikemanUrl), archer: Texture.from(archerUrl), cavalry: Texture.from(cavalryUrl), assassin: Texture.from(assassinUrl), catapult: Texture.from(catapultUrl), healer: Texture.from(healerUrl)
};

const unitSpriteTuning: Record<UnitKind, { scale: number; yOffset: number }> = {
  militia: { scale: 0.9, yOffset: 0.01 }, swordsman: { scale: 0.92, yOffset: 0.01 }, pikeman: { scale: 0.98, yOffset: 0.015 }, archer: { scale: 0.98, yOffset: 0.015 }, cavalry: { scale: 1.04, yOffset: 0.02 }, assassin: { scale: 0.95, yOffset: 0.01 }, catapult: { scale: 1.08, yOffset: 0.03 }, healer: { scale: 0.96, yOffset: 0.01 }
};

export function GameCanvas({ state, selectedUnitId, reachable, attackableIds, healableIds, onTileTap, attackPreviews = {}, animateMovement, showHint = true }: GameCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const pointersRef = useRef(new Map<number, PointerSnapshot>());
  const interactionRef = useRef<InteractionState>(idleInteraction());
  const previousStateRef = useRef<MatchState | null>(null);
  const activeVisualsRef = useRef<ActiveVisuals>({ moves: [], popups: [], attacks: [] });

  const [surface, setSurface] = useState<SurfaceSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PanState>({ x: VIEWPORT_PADDING, y: BOARD_TOP_PADDING });
  const [spacePressed, setSpacePressed] = useState(false);
  const [visualTick, setVisualTick] = useState(0);
  const [animationClock, setAnimationClock] = useState(0);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(() => setSurface({ width: wrapper.clientWidth, height: wrapper.clientHeight }));
    observer.observe(wrapper);
    setSurface({ width: wrapper.clientWidth, height: wrapper.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const suppressWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const suppressGesture = (event: Event) => {
      event.preventDefault();
    };

    wrapper.addEventListener("wheel", suppressWheel, { passive: false });
    wrapper.addEventListener("gesturestart", suppressGesture, { passive: false });
    wrapper.addEventListener("gesturechange", suppressGesture, { passive: false });
    wrapper.addEventListener("gestureend", suppressGesture, { passive: false });

    return () => {
      wrapper.removeEventListener("wheel", suppressWheel);
      wrapper.removeEventListener("gesturestart", suppressGesture);
      wrapper.removeEventListener("gesturechange", suppressGesture);
      wrapper.removeEventListener("gestureend", suppressGesture);
    };
  }, []);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) { if (event.code === "Space") setSpacePressed(true); }
    function onKeyUp(event: KeyboardEvent) { if (event.code === "Space") setSpacePressed(false); }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const wrapper = wrapperRef.current;
    if (!host || !wrapper || appRef.current) return;
    const app = new Application({ width: wrapper.clientWidth || 640, height: wrapper.clientHeight || 420, antialias: true, backgroundAlpha: 0, resolution: Math.max(window.devicePixelRatio || 1, 1), autoDensity: true });
    const canvas = app.view as HTMLCanvasElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.appendChild(canvas);
    appRef.current = app;
    return () => {
      app.destroy(true, { children: true });
      appRef.current = null;
    };
  }, []);

  const layout = useMemo<Layout>(() => {
    const width = surface.width || 640;
    const height = surface.height || 420;
    const cols = state.board[0].length;
    const rows = state.board.length;
    const boardWidth = cols * NATURAL_CELL;
    const boardHeight = rows * NATURAL_CELL;
    const fitZoom = clamp(Math.min((width - VIEWPORT_PADDING * 2) / boardWidth, (height - VIEWPORT_PADDING * 2) / boardHeight), MIN_ZOOM, MAX_ZOOM);
    return { cols, rows, width, height, boardWidth, boardHeight, fitZoom, step: NATURAL_CELL };
  }, [state.board, surface]);

  useEffect(() => {
    setZoom(layout.fitZoom);
    setPan(centerPan(layout.fitZoom, layout));
  }, [layout.fitZoom, layout.width, layout.height, state.mapId]);

  useEffect(() => {
    const now = performance.now();
    activeVisualsRef.current = pruneVisuals(activeVisualsRef.current, now);
    if (previousStateRef.current?.id === state.id) {
      const nextVisuals = buildVisualDiff(previousStateRef.current, state, now, animateMovement);
      if (nextVisuals.moves.length || nextVisuals.popups.length || nextVisuals.attacks.length) {
        activeVisualsRef.current = {
          moves: [...activeVisualsRef.current.moves, ...nextVisuals.moves],
          popups: [...activeVisualsRef.current.popups, ...nextVisuals.popups],
          attacks: [...activeVisualsRef.current.attacks, ...nextVisuals.attacks]
        };
        setAnimationClock(now);
        setVisualTick((value) => value + 1);
      }
    }
    previousStateRef.current = state;
  }, [state, animateMovement]);

  useEffect(() => {
    if (!hasActiveVisuals(activeVisualsRef.current)) return;
    let frame = 0;
    const tick = (now: number) => {
      activeVisualsRef.current = pruneVisuals(activeVisualsRef.current, now);
      setAnimationClock(now);
      if (hasActiveVisuals(activeVisualsRef.current)) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visualTick]);

  useEffect(() => {
    const app = appRef.current;
    if (!app) return;

    app.renderer.resize(layout.width, layout.height);
    app.stage.removeChildren();
    const root = new Container();
    app.stage.addChild(root);

    const now = animationClock || performance.now();
    activeVisualsRef.current = pruneVisuals(activeVisualsRef.current, now);
    const activeVisuals = activeVisualsRef.current;
    const moveMap = new Map(activeVisuals.moves.map((move) => [move.unitId, interpolateMove(move, now)]));
    const reachableSet = new Set(reachable.map((coord) => `${coord.x},${coord.y}`));
    const attackableSet = new Set(attackableIds);
    const healableSet = new Set(healableIds);
    const unitMap = new Map(state.units.map((unit) => [`${unit.x},${unit.y}`, unit]));

    const boardShadow = new Graphics();
    boardShadow.beginFill(0x081214, 0.34);
    boardShadow.drawRoundedRect(pan.x - 10 * zoom, pan.y - 10 * zoom, layout.boardWidth * zoom + 20 * zoom, layout.boardHeight * zoom + 20 * zoom, 18 * zoom);
    boardShadow.endFill();
    root.addChild(boardShadow);

    for (const row of state.board) {
      for (const tile of row) {
        const projected = projectCell(tile, layout, pan, zoom);
        const occupant = unitMap.get(`${tile.x},${tile.y}`);
        drawTerrain(root, state, tile, projected.x, projected.y, projected.size);
        if (reachableSet.has(`${tile.x},${tile.y}`)) drawHighlight(root, projected, 0xf4d27a, 0.14, 0xf4d27a, 0.85);
        if (occupant && attackableSet.has(occupant.id)) drawHighlight(root, projected, 0xd66357, 0.2, 0xffc0b0, 0.9);
        if (occupant && healableSet.has(occupant.id)) drawHighlight(root, projected, 0x6fae6e, 0.18, 0xa8f0a2, 0.9);
      }
    }

    for (const attack of activeVisuals.attacks) drawAttackEffect(root, attack, layout, pan, zoom, now);

    const unitSize = getUnitRenderSize(zoom);
    const units = [...state.units].sort((left, right) => left.y - right.y || left.x - right.x);
    for (const unit of units) {
      const position = moveMap.get(unit.id) ?? unit;
      const projected = projectCell(position, layout, pan, zoom);
      drawUnit(root, unit, projected.centerX - unitSize / 2, projected.centerY - unitSize * 0.5, unitSize, zoom, unit.id === selectedUnitId);
    }

    for (const unit of units) {
      const preview = attackPreviews[unit.id];
      if (!attackableSet.has(unit.id) || !preview) continue;
      const position = moveMap.get(unit.id) ?? unit;
      const projected = projectCell(position, layout, pan, zoom);
      drawCombatPreview(root, preview, projected, zoom);
    }

    for (const popup of activeVisuals.popups) drawPopupEffect(root, popup, layout, pan, zoom, now);
  }, [attackPreviews, attackableIds, healableIds, layout, pan, reachable, selectedUnitId, state, animationClock, zoom]);

  function updateZoom(nextZoom: number, focus?: { x: number; y: number }) {
    const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const nextFocus = focus ?? { x: layout.width / 2, y: layout.height / 2 };
    const worldX = (nextFocus.x - pan.x) / zoom;
    const worldY = (nextFocus.y - pan.y) / zoom;
    setZoom(clampedZoom);
    setPan(clampPan({ x: nextFocus.x - worldX * clampedZoom, y: nextFocus.y - worldY * clampedZoom }, clampedZoom, layout));
  }

  function resetViewport() {
    setZoom(layout.fitZoom);
    setPan(centerPan(layout.fitZoom, layout));
  }

  function beginTap(pointerId: number, pointerType: string, clientX: number, clientY: number) {
    interactionRef.current = { mode: "tap", pointerId, pointerType, moved: false, startClientX: clientX, startClientY: clientY, startPanX: pan.x, startPanY: pan.y, pinchStartDistance: 0, pinchStartZoom: zoom, pinchWorldX: 0, pinchWorldY: 0 };
  }

  function beginPan(pointerId: number, pointerType: string, clientX: number, clientY: number) {
    interactionRef.current = { mode: "pan", pointerId, pointerType, moved: false, startClientX: clientX, startClientY: clientY, startPanX: pan.x, startPanY: pan.y, pinchStartDistance: 0, pinchStartZoom: zoom, pinchWorldX: 0, pinchWorldY: 0 };
  }

  function beginPinch() {
    const points = Array.from(pointersRef.current.values());
    if (points.length < 2) return;
    const first = points[0];
    const second = points[1];
    const centerX = (first.x + second.x) / 2;
    const centerY = (first.y + second.y) / 2;
    interactionRef.current = { mode: "pinch", pointerId: null, pointerType: "touch", moved: true, startClientX: centerX, startClientY: centerY, startPanX: pan.x, startPanY: pan.y, pinchStartDistance: distance(first, second), pinchStartZoom: zoom, pinchWorldX: (centerX - pan.x) / (NATURAL_CELL * zoom), pinchWorldY: (centerY - pan.y) / (NATURAL_CELL * zoom) };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!wrapperRef.current) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch") {
      if (pointersRef.current.size === 1) beginTap(event.pointerId, event.pointerType, event.clientX, event.clientY);
      else if (pointersRef.current.size === 2) beginPinch();
      return;
    }
    const mousePanRequested = event.button === 1 || (event.button === 0 && spacePressed);
    if (mousePanRequested) {
      event.preventDefault();
      beginPan(event.pointerId, event.pointerType, event.clientX, event.clientY);
      return;
    }
    beginTap(event.pointerId, event.pointerType, event.clientX, event.clientY);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const interaction = interactionRef.current;
    if (interaction.mode === "pinch") {
      const points = Array.from(pointersRef.current.values());
      if (points.length < 2) return;
      const first = points[0];
      const second = points[1];
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      const nextZoom = clamp(interaction.pinchStartZoom * (distance(first, second) / Math.max(24, interaction.pinchStartDistance)), MIN_ZOOM, MAX_ZOOM);
      setZoom(nextZoom);
      setPan(clampPan({ x: centerX - interaction.pinchWorldX * NATURAL_CELL * nextZoom, y: centerY - interaction.pinchWorldY * NATURAL_CELL * nextZoom }, nextZoom, layout));
      return;
    }
    if (interaction.pointerId !== event.pointerId) return;
    const dx = event.clientX - interaction.startClientX;
    const dy = event.clientY - interaction.startClientY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) interactionRef.current.moved = true;
    if (interaction.mode === "tap") {
      if (interaction.pointerType === "touch" && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) beginPan(event.pointerId, event.pointerType, event.clientX, event.clientY);
      return;
    }
    if (interaction.mode === "pan") setPan(clampPan({ x: interaction.startPanX + dx, y: interaction.startPanY + dy }, zoom, layout));
  }

  function finishPointer(event: React.PointerEvent<HTMLDivElement>) {
    const wrapper = wrapperRef.current;
    const interaction = interactionRef.current;
    const releasedPoint = pointersRef.current.get(event.pointerId);
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (interaction.mode === "pinch") {
      if (pointersRef.current.size === 1) {
        const [remainingId, point] = Array.from(pointersRef.current.entries())[0];
        beginTap(remainingId, "touch", point.x, point.y);
      } else {
        interactionRef.current = idleInteraction();
      }
      return;
    }
    if (interaction.pointerId !== event.pointerId) return;
    if (interaction.mode === "tap" && !interaction.moved && releasedPoint) {
      const rect = wrapper?.getBoundingClientRect();
      if (rect) {
        const screenX = releasedPoint.x - rect.left;
        const screenY = releasedPoint.y - rect.top;
        const target = hitTestCell(screenX, screenY, layout, pan, zoom);
        if (target) onTileTap(target);
      }
    }
    interactionRef.current = idleInteraction();
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  const compactControls = surface.width > 0 && surface.width <= 720;
  const controlsStyle = compactControls ? { ...toolbarButtonStyle, width: 40, minHeight: 40 } : toolbarButtonStyle;
  const fitButtonStyle = compactControls ? { ...controlsStyle, width: 50 } : { ...toolbarButtonStyle, width: 56 };
  const hintBoxStyle = compactControls ? { ...hintStyle, maxWidth: "calc(100% - 24px)", fontSize: "0.76rem", left: 8, bottom: 8, padding: "0.4rem 0.6rem" } : hintStyle;

  return (
    <div ref={wrapperRef} className="canvas-wrap" onContextMenu={(event) => event.preventDefault()}>
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      <div onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} onWheel={handleWheel} style={{ position: "absolute", inset: 0, touchAction: "none", cursor: interactionRef.current.mode === "pan" ? "grabbing" : spacePressed ? "grab" : "default" }} />
      <div style={{ position: "absolute", top: compactControls ? 8 : 12, right: compactControls ? 8 : 12, display: "grid", gap: compactControls ? 6 : 8, zIndex: 2 }}>
        <button type="button" onClick={() => updateZoom(zoom * 1.2)} style={controlsStyle}>+</button>
        <button type="button" onClick={() => updateZoom(zoom / 1.2)} style={controlsStyle}>-</button>
        <button type="button" onClick={resetViewport} style={fitButtonStyle}>Fit</button>
      </div>
      {showHint ? <div style={hintBoxStyle}>Desktop: click to select, hold Space and drag to pan, use buttons to zoom. Touch: drag to pan, pinch to zoom.</div> : null}
    </div>
  );
}

function projectCell(coord: Coord, layout: Layout, pan: PanState, zoom: number): ProjectedCell {
  const size = layout.step * zoom;
  const x = pan.x + coord.x * layout.step * zoom;
  const y = pan.y + coord.y * layout.step * zoom;
  return { x, y, centerX: x + size / 2, centerY: y + size / 2, size };
}

function hitTestCell(screenX: number, screenY: number, layout: Layout, pan: PanState, zoom: number): Coord | null {
  const worldX = (screenX - pan.x) / zoom;
  const worldY = (screenY - pan.y) / zoom;
  const x = Math.floor(worldX / layout.step);
  const y = Math.floor(worldY / layout.step);
  return x >= 0 && y >= 0 && x < layout.cols && y < layout.rows ? { x, y } : null;
}

function drawHighlight(root: Container, cell: ProjectedCell, fill: number, fillAlpha: number, stroke: number, strokeAlpha: number) {
  const highlight = new Graphics();
  highlight.lineStyle(Math.max(1.5, cell.size * 0.03), stroke, strokeAlpha);
  highlight.beginFill(fill, fillAlpha);
  highlight.drawRoundedRect(cell.x + 4, cell.y + 4, cell.size - 8, cell.size - 8, Math.max(5, cell.size * 0.14));
  highlight.endFill();
  root.addChild(highlight);
}

function drawTerrain(root: Container, state: MatchState, tile: TileState, x: number, y: number, size: number) {
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
    // Lake-boundary water gets the same grass-to-water transition as shore
    // tiles so the bank does not cut off hard against land.
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

  if (dirs.length >= 4) {
    return { texture: roadTextures.cross };
  }

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

  if (hasN || hasS) {
    return { texture: roadTextures.vertical };
  }
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

  // Two parallel river tiles form one wide river: each half uses the edge tile
  // with its water flush against the shared seam. Detected by a side-by-side
  // partner that shares a diagonal continuation.
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

  if (dirs.length >= 4) {
    return { texture: riverTextures.cross };
  }

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

function drawUnit(root: Container, unit: UnitState, x: number, y: number, size: number, zoom: number, selected: boolean) {
  const container = new Container();
  container.x = x;
  container.y = y;
  container.alpha = 1;

  const teamColor = PLAYER_COLORS[unit.owner];
  const tuning = unitSpriteTuning[unit.kind];

  const shadow = new Graphics();
  shadow.beginFill(0x081214, 0.3);
  shadow.drawEllipse(size * 0.5, size * 0.8, size * 0.23, size * 0.09);
  shadow.endFill();
  container.addChild(shadow);

  const sprite = new Sprite(unitTextures[unit.kind]);
  sprite.anchor.set(0.5, 1);
  sprite.x = size * 0.5;
  sprite.y = size * (0.72 + tuning.yOffset);
  const spriteSize = size * 0.84 * tuning.scale;
  sprite.width = spriteSize;
  sprite.height = spriteSize;
  sprite.roundPixels = true;
  container.addChild(sprite);

  const teamBadgeShadow = new Graphics();
  teamBadgeShadow.beginFill(0x081214, 0.38);
  teamBadgeShadow.drawCircle(size * 0.19, size * 0.14, size * 0.095);
  teamBadgeShadow.endFill();
  container.addChild(teamBadgeShadow);

  const teamBadgeRing = new Graphics();
  teamBadgeRing.lineStyle(Math.max(2, size * 0.022), 0xf4efe1, 0.94);
  teamBadgeRing.beginFill(teamColor, 0.98);
  teamBadgeRing.drawCircle(size * 0.19, size * 0.14, size * 0.068);
  teamBadgeRing.endFill();
  container.addChild(teamBadgeRing);

  if (unit.acted || unit.moved) {
    const badgeX = size * 0.81;
    const badgeY = size * 0.15;
    const badgeRadius = size * 0.078;

    const statusShadow = new Graphics();
    statusShadow.beginFill(0x081214, 0.42);
    statusShadow.drawCircle(badgeX, badgeY + size * 0.008, badgeRadius + size * 0.012);
    statusShadow.endFill();
    container.addChild(statusShadow);

    const statusBadge = new Graphics();
    statusBadge.lineStyle(Math.max(2, size * 0.022), unit.acted ? 0x132126 : 0x5a3912, 0.98);
    statusBadge.beginFill(unit.acted ? 0xf4efe1 : 0xf1c26a, 0.98);
    statusBadge.drawCircle(badgeX, badgeY, badgeRadius);
    statusBadge.endFill();
    container.addChild(statusBadge);

    const statusMark = new Graphics();
    statusMark.lineStyle(Math.max(2.5, size * 0.032), unit.acted ? 0x132126 : 0x5a3912, 1, 0.5, true);
    if (unit.acted) {
      statusMark.moveTo(badgeX - size * 0.032, badgeY + size * 0.002);
      statusMark.lineTo(badgeX - size * 0.008, badgeY + size * 0.03);
      statusMark.lineTo(badgeX + size * 0.038, badgeY - size * 0.03);
    } else {
      statusMark.moveTo(badgeX - size * 0.036, badgeY + size * 0.018);
      statusMark.lineTo(badgeX + size * 0.018, badgeY + size * 0.018);
      statusMark.moveTo(badgeX + size * 0.018, badgeY + size * 0.018);
      statusMark.lineTo(badgeX - size * 0.002, badgeY - size * 0.002);
      statusMark.moveTo(badgeX + size * 0.018, badgeY + size * 0.018);
      statusMark.lineTo(badgeX - size * 0.002, badgeY + size * 0.038);
    }
    container.addChild(statusMark);
  }

  const hpTrackY = size * 0.84;
  const level = getUnitLevel(unit);
  if (level > 1) {
    const pipCount = level - 1;
    const plateWidth = size * (pipCount === 1 ? 0.16 : 0.24);
    const plateX = size * 0.5 - plateWidth / 2;
    const plateY = hpTrackY - size * 0.1;

    const veteranPlateShadow = new Graphics();
    veteranPlateShadow.beginFill(0x081214, 0.36);
    veteranPlateShadow.drawRoundedRect(plateX, plateY + size * 0.008, plateWidth, size * 0.072, size * 0.03);
    veteranPlateShadow.endFill();
    container.addChild(veteranPlateShadow);

    const veteranPlate = new Graphics();
    veteranPlate.beginFill(0x102125, 0.88);
    veteranPlate.lineStyle(Math.max(1.5, size * 0.016), 0xf1c26a, 0.9);
    veteranPlate.drawRoundedRect(plateX, plateY, plateWidth, size * 0.072, size * 0.03);
    veteranPlate.endFill();
    container.addChild(veteranPlate);

    const veteranMarks = new Graphics();
    veteranMarks.beginFill(0xf1c26a, 1);
    veteranMarks.lineStyle(Math.max(1, size * 0.011), 0x4f3a18, 0.92);
    const gap = size * 0.064;
    const startX = size * 0.5 - ((pipCount - 1) * gap) / 2;
    const cy = plateY + size * 0.036;
    const radius = size * 0.022;
    for (let mark = 0; mark < pipCount; mark += 1) {
      const cx = startX + mark * gap;
      veteranMarks.moveTo(cx, cy - radius);
      veteranMarks.lineTo(cx + radius, cy);
      veteranMarks.lineTo(cx, cy + radius);
      veteranMarks.lineTo(cx - radius, cy);
      veteranMarks.lineTo(cx, cy - radius);
    }
    veteranMarks.endFill();
    container.addChild(veteranMarks);
  }

  const hpTrack = new Graphics();
  hpTrack.beginFill(0x142225, 0.82);
  hpTrack.drawRoundedRect(size * 0.14, hpTrackY, size * 0.72, size * 0.08, size * 0.04);
  hpTrack.endFill();
  container.addChild(hpTrack);

  const hpFill = new Graphics();
  hpFill.beginFill(0x98df9d, 0.96);
  hpFill.drawRoundedRect(size * 0.14, hpTrackY, size * 0.72 * (unit.hp / unitDefinitions[unit.kind].maxHp), size * 0.08, size * 0.04);
  hpFill.endFill();
  container.addChild(hpFill);

  const hpText = new Text(String(unit.hp), popupDarkStyle);
  hpText.anchor.set(0.5);
  hpText.x = size * 0.5;
  hpText.y = size * 0.88;
  hpText.scale.set(Math.max(0.8, zoom * 0.95));
  container.addChild(hpText);

  if (selected) {
    const outline = new Graphics();
    outline.lineStyle(Math.max(2, size * 0.045), 0xf4efe1, 0.95);
    outline.drawRoundedRect(size * 0.1, size * 0.08, size * 0.8, size * 0.78, size * 0.18);
    container.addChild(outline);
  }

  root.addChild(container);
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
      // Two adjacent bridge tiles span a wide river: each half uses the wide
      // deck tile, with the approach ramp facing away from the shared seam.
      const span = neighborDirections(state, tile, ["bridge"]);
      if (span.includes("e")) return { texture: terrainTextures.bridgeWide };
      if (span.includes("w")) return { texture: terrainTextures.bridgeWide, rotation: Math.PI };
      if (span.includes("s")) return { texture: terrainTextures.bridgeWide, rotation: Math.PI / 2 };
      if (span.includes("n")) return { texture: terrainTextures.bridgeWide, rotation: -Math.PI / 2 };
      return {
        texture: terrainTextures.bridge,
        rotation: shouldRotateBridge(state, tile) ? Math.PI / 2 : 0
      };
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
  // shore overlay has grass at N when unrotated; turn the grass toward the land
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

function terrainRotation(tile: TileState): number {
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

function drawCombatPreview(root: Container, preview: { damage: number; retaliation: number }, cell: ProjectedCell, zoom: number) {
  const label = preview.retaliation > 0 ? `${preview.damage} / ${preview.retaliation}` : `${preview.damage}`;
  const meta = preview.retaliation > 0 ? "damage / back" : "damage";
  const valueText = new Text(label, combatPreviewStyle);
  const metaText = new Text(meta, combatPreviewMetaStyle);
  valueText.anchor.set(0.5, 0.5);
  metaText.anchor.set(0.5, 0.5);
  valueText.scale.set(Math.max(0.95, zoom * 1.02));
  metaText.scale.set(Math.max(0.9, zoom));

  const contentWidth = Math.max(valueText.width, metaText.width);
  const paddingX = Math.max(8, cell.size * 0.09);
  const width = Math.max(cell.size * 0.5, contentWidth + paddingX * 2);
  const height = Math.max(cell.size * 0.22, valueText.height + metaText.height + 8);
  const x = cell.centerX;
  const y = cell.centerY + cell.size * 0.1;

  const shadow = new Graphics();
  shadow.beginFill(0x090f12, 0.34);
  shadow.drawRoundedRect(x - width / 2, y - height / 2 + 2, width, height, height / 2);
  shadow.endFill();
  root.addChild(shadow);

  const chip = new Graphics();
  chip.beginFill(0x3f1112, 0.94);
  chip.lineStyle(Math.max(1.5, zoom * 1.7), 0xffb3a4, 0.96);
  chip.drawRoundedRect(x - width / 2, y - height / 2, width, height, height / 2);
  chip.endFill();
  root.addChild(chip);

  valueText.x = x;
  valueText.y = y - height * 0.16;
  valueText.tint = 0xffe7df;
  root.addChild(valueText);

  metaText.x = x;
  metaText.y = y + height * 0.2;
  metaText.alpha = 0.92;
  root.addChild(metaText);
}

function drawPopupEffect(root: Container, popup: PopupVisual, layout: Layout, pan: PanState, zoom: number, now: number) {
  const progress = clamp((now - popup.start) / popup.duration, 0, 1);
  const projected = projectCell(popup.coord, layout, pan, zoom);
  const label = new Text(popup.label, popupTextStyle);
  label.anchor.set(0.5);
  label.x = projected.centerX;
  label.y = projected.centerY - projected.size * (0.15 + progress * 0.3);
  label.alpha = 1 - progress;
  label.tint = popup.color;
  root.addChild(label);
}

function drawAttackEffect(root: Container, attack: AttackVisual, layout: Layout, pan: PanState, zoom: number, now: number) {
  const progress = clamp((now - attack.start) / attack.duration, 0, 1);
  const from = projectCell(attack.from, layout, pan, zoom);
  const to = projectCell(attack.to, layout, pan, zoom);
  const effect = new Graphics();

  if (attack.kind === "slash") {
    effect.lineStyle(Math.max(2, zoom * 3), attack.color, 1 - progress * 0.25);
    effect.moveTo(to.centerX - to.size * 0.18, to.centerY - to.size * 0.16);
    effect.lineTo(to.centerX + to.size * 0.2, to.centerY + to.size * 0.12);
  } else if (attack.kind === "heal") {
    effect.lineStyle(Math.max(2, zoom * 2.5), attack.color, 0.8);
    effect.moveTo(from.centerX, from.centerY - from.size * 0.08);
    effect.lineTo(to.centerX, to.centerY - to.size * 0.08);
    effect.beginFill(attack.color, 0.18 * (1 - progress));
    effect.drawCircle(to.centerX, to.centerY - to.size * 0.08, to.size * (0.12 + 0.1 * progress));
    effect.endFill();
  } else {
    const projectileX = lerp(from.centerX, to.centerX, progress);
    const projectileY = lerp(from.centerY - from.size * 0.12, to.centerY - to.size * 0.12, progress);
    effect.lineStyle(Math.max(1.5, zoom * 2), attack.color, 0.38);
    effect.moveTo(from.centerX, from.centerY - from.size * 0.12);
    effect.lineTo(projectileX, projectileY);
    effect.beginFill(attack.color, 0.96);
    if (attack.kind === "stone") effect.drawCircle(projectileX, projectileY, Math.max(3, zoom * 5));
    else effect.drawRoundedRect(projectileX - Math.max(2, zoom * 5), projectileY - 1, Math.max(6, zoom * 10), 2, 2);
    effect.endFill();
  }

  root.addChild(effect);
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

function getUnitRenderSize(zoom: number) {
  return NATURAL_CELL * zoom;
}

function interpolateMove(move: MoveVisual, now: number): Coord {
  const progress = clamp((now - move.start) / move.duration, 0, 1);
  return { x: lerp(move.from.x, move.to.x, progress), y: lerp(move.from.y, move.to.y, progress) };
}

function buildVisualDiff(previous: MatchState, next: MatchState, now: number, animateMovement: boolean): ActiveVisuals {
  const previousUnits = new Map(previous.units.map((unit) => [unit.id, unit]));
  const nextUnits = new Map(next.units.map((unit) => [unit.id, unit]));
  const moves: MoveVisual[] = [];
  const popups: PopupVisual[] = [];
  const attacks: AttackVisual[] = [];

  for (const unit of next.units) {
    const oldUnit = previousUnits.get(unit.id);
    if (!oldUnit) continue;
    if (oldUnit.x !== unit.x || oldUnit.y !== unit.y) {
      moves.push({ unitId: unit.id, from: { x: oldUnit.x, y: oldUnit.y }, to: { x: unit.x, y: unit.y }, start: now, duration: animateMovement ? MOVE_ANIMATION_MS : 1 });
    }
    if (oldUnit.hp !== unit.hp) {
      const delta = unit.hp - oldUnit.hp;
      popups.push({ id: `${unit.id}-${now}-hp`, coord: { x: unit.x, y: unit.y }, label: delta > 0 ? `+${delta}` : `${delta}`, color: delta > 0 ? HEAL_COLOR : 0xffb2a4, start: now, duration: POPUP_MS });
    }
    if (getUnitLevel(unit) > getUnitLevel(oldUnit)) {
      popups.push({ id: `${unit.id}-${now}-level`, coord: { x: unit.x, y: unit.y }, label: "Level up!", color: 0xf1c26a, start: now, duration: POPUP_MS + 260 });
    }
  }

  const actor = detectActingUnit(previous, next);
  if (actor) {
    const harmed = collectChangedTargets(previous, next, actor.owner, "enemy");
    const healed = collectChangedTargets(previous, next, actor.owner, "ally", true);
    if (healed.length > 0 && actor.kind === "healer") {
      attacks.push({ id: `heal-${actor.id}-${now}`, kind: "heal", from: { x: actor.x, y: actor.y }, to: healed[0], color: HEAL_COLOR, start: now, duration: PROJECTILE_MS });
    } else if (harmed.length > 0) {
      const kind = actor.kind === "archer" ? "arrow" : actor.kind === "catapult" ? "stone" : "slash";
      const color = actor.kind === "catapult" ? STONE_COLOR : actor.kind === "archer" ? ARROW_COLOR : 0xffd17a;
      attacks.push({ id: `attack-${actor.id}-${now}`, kind, from: { x: actor.x, y: actor.y }, to: harmed[0], color, start: now, duration: kind === "slash" ? SLASH_MS : PROJECTILE_MS });
    }
  }

  for (const [id, oldUnit] of previousUnits) {
    if (!nextUnits.has(id)) popups.push({ id: `${id}-${now}-ko`, coord: { x: oldUnit.x, y: oldUnit.y }, label: "KO", color: 0xffb2a4, start: now, duration: POPUP_MS });
  }

  return { moves, popups, attacks };
}

function detectActingUnit(previous: MatchState, next: MatchState): UnitState | null {
  return next.units.find((unit) => {
    const oldUnit = previous.units.find((candidate) => candidate.id === unit.id);
    if (!oldUnit || unit.owner !== previous.currentPlayer) return false;
    return (!oldUnit.acted && unit.acted) || (!oldUnit.moved && unit.moved && oldUnit.x === unit.x && oldUnit.y === unit.y);
  }) ?? null;
}

function collectChangedTargets(previous: MatchState, next: MatchState, owner: UnitState["owner"], side: "enemy" | "ally", healing = false): Coord[] {
  const targets: Array<{ coord: Coord; magnitude: number }> = [];
  for (const oldUnit of previous.units) {
    const nextUnit = next.units.find((unit) => unit.id === oldUnit.id);
    const matchesSide = side === "enemy" ? oldUnit.owner !== owner : oldUnit.owner === owner;
    if (!matchesSide) continue;
    if (!nextUnit) {
      targets.push({ coord: { x: oldUnit.x, y: oldUnit.y }, magnitude: oldUnit.hp });
      continue;
    }
    const delta = nextUnit.hp - oldUnit.hp;
    if (healing ? delta > 0 : delta < 0) targets.push({ coord: { x: nextUnit.x, y: nextUnit.y }, magnitude: Math.abs(delta) });
  }
  return targets.sort((left, right) => right.magnitude - left.magnitude).map((entry) => entry.coord);
}

function pruneVisuals(visuals: ActiveVisuals, now: number): ActiveVisuals {
  return {
    moves: visuals.moves.filter((move) => now - move.start < move.duration),
    popups: visuals.popups.filter((popup) => now - popup.start < popup.duration),
    attacks: visuals.attacks.filter((attack) => now - attack.start < attack.duration)
  };
}

function hasActiveVisuals(visuals: ActiveVisuals) {
  return visuals.moves.length > 0 || visuals.popups.length > 0 || visuals.attacks.length > 0;
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function lerp(from: number, to: number, progress: number) { return from + (to - from) * progress; }
function distance(first: PointerSnapshot, second: PointerSnapshot) { return Math.hypot(first.x - second.x, first.y - second.y); }

function idleInteraction(): InteractionState {
  return { mode: "idle", pointerId: null, pointerType: null, moved: false, startClientX: 0, startClientY: 0, startPanX: 0, startPanY: 0, pinchStartDistance: 0, pinchStartZoom: 1, pinchWorldX: 0, pinchWorldY: 0 };
}

function clampPan(nextPan: PanState, zoom: number, layout: Layout): PanState {
  const boardWidth = layout.boardWidth * zoom;
  const boardHeight = layout.boardHeight * zoom;
  const maxWidth = layout.width - VIEWPORT_PADDING * 2;
  const maxHeight = layout.height - VIEWPORT_PADDING * 2;

  nextPan.x = boardWidth <= maxWidth ? Math.floor((layout.width - boardWidth) / 2) : clamp(nextPan.x, layout.width - VIEWPORT_PADDING - boardWidth, VIEWPORT_PADDING);
  nextPan.y = boardHeight <= maxHeight ? BOARD_TOP_PADDING : clamp(nextPan.y, layout.height - VIEWPORT_PADDING - boardHeight, BOARD_TOP_PADDING);
  return { x: nextPan.x, y: nextPan.y };
}

function centerPan(zoom: number, layout: Layout): PanState {
  return clampPan({ x: Math.floor((layout.width - layout.boardWidth * zoom) / 2), y: BOARD_TOP_PADDING }, zoom, layout);
}

const toolbarButtonStyle: React.CSSProperties = {
  width: 44,
  minHeight: 44,
  padding: 0,
  borderRadius: 14,
  background: "rgba(10, 20, 24, 0.82)",
  border: "1px solid rgba(255,255,255,0.12)",
  boxShadow: "none"
};

const hintStyle: React.CSSProperties = {
  position: "absolute",
  left: 12,
  bottom: 12,
  padding: "0.45rem 0.7rem",
  borderRadius: 999,
  background: "rgba(10, 20, 24, 0.72)",
  border: "1px solid rgba(255,255,255,0.1)",
  fontSize: "0.82rem",
  color: "#f4efe1",
  zIndex: 2,
  maxWidth: "calc(100% - 120px)"
};







