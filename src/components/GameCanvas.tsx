import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Application, Graphics } from "pixi.js";
import type { Coord, MatchState, PlayerId } from "../engine";
import {
  MAX_ZOOM,
  NATURAL_CELL,
  READABLE_ZOOM,
  VIEWPORT_PADDING,
  type ActiveVisuals,
  type InteractionState,
  type Layout,
  type PanState,
  type PointerSnapshot,
  type Rect,
  type SurfaceSize
} from "./canvas/types";
import { boardLayout, clamp, clampPan, distance, fitView, hitTestCell, idleInteraction, minZoom, playView, projectCell } from "./canvas/geometry";
import { buildTerrainLayer, drawHighlight, drawOwnershipMarker, terrainTexturesReady } from "./canvas/terrainRenderer";
import { drawUnit, getUnitRenderSize } from "./canvas/unitRenderer";
import { BoardScene } from "./canvas/boardScene";
import { trackCanvasApp } from "./canvas/resourceProbe";
import {
  buildVisualDiff,
  drawAttackEffect,
  drawCombatPreview,
  drawPopupEffect,
  hasActiveVisuals,
  interpolateMove,
  pruneVisuals
} from "./canvas/effectsRenderer";

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
  /** Whose army the play view centres on: the viewer online or against the AI; else the player to act. */
  focusPlayer?: PlayerId;
}

/** "play" is the readable start-of-turn view, "fit" the whole board, "free" anything the player panned or zoomed to. */
type ViewMode = "play" | "fit" | "free";

const PAN_HINT_KEY = "bannerfront.board-pan-hint-seen";

function panHintSeen() {
  try {
    return localStorage.getItem(PAN_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

/** The zoom controls' box in canvas coordinates (see the styles below). */
function controlsRect(width: number, compact: boolean): Rect {
  const inset = compact ? 8 : 12;
  const buttonWidth = compact ? 50 : 56;
  const height = compact ? 40 * 3 + 6 * 2 : 44 * 3 + 8 * 2;
  return { left: width - inset - buttonWidth, top: inset, right: width - inset, bottom: inset + height };
}

/** Centre of a player's army, or of their keeps when they have no units left. */
function armyCenter(state: MatchState, player: PlayerId): Coord | null {
  const units = state.units.filter((unit) => unit.owner === player);
  const points = units.length ? units : state.board.flat().filter((tile) => tile.structure === "keep" && tile.owner === player);
  if (!points.length) return null;
  return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
}

export function GameCanvas({ state, selectedUnitId, reachable, attackableIds, healableIds, onTileTap, attackPreviews = {}, animateMovement, showHint = true, focusPlayer }: GameCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const sceneRef = useRef<BoardScene | null>(null);
  const pointersRef = useRef(new Map<number, PointerSnapshot>());
  const interactionRef = useRef<InteractionState>(idleInteraction());
  const previousStateRef = useRef<MatchState | null>(null);
  const activeVisualsRef = useRef<ActiveVisuals>({ moves: [], popups: [], attacks: [] });

  const [surface, setSurface] = useState<SurfaceSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PanState>({ x: VIEWPORT_PADDING, y: VIEWPORT_PADDING });
  const [viewMode, setViewMode] = useState<ViewMode>("play");
  const [terrainReady, setTerrainReady] = useState(false);
  const [showPanHint, setShowPanHint] = useState(() => !panHintSeen());
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
    const scene = new BoardScene(app.stage);
    appRef.current = app;
    sceneRef.current = scene;
    const untrack = trackCanvasApp(app);
    // StrictMode runs this cleanup and then the effect again: the next run makes its own app and scene.
    return () => {
      untrack();
      appRef.current = null;
      sceneRef.current = null;
      scene.destroy();
      app.destroy(true, { children: true });
    };
  }, []);

  useEffect(() => {
    let active = true;
    void terrainTexturesReady.then(() => {
      if (active) setTerrainReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const compactControls = surface.width > 0 && surface.width <= 720;
  const layout = useMemo<Layout>(() => {
    const width = surface.width || 640;
    const height = surface.height || 420;
    return boardLayout({ width, height }, state.board[0].length, state.board.length, controlsRect(width, compactControls));
  }, [state.board, surface, compactControls]);

  // The terrain layer depends only on the terrain, which no action changes.
  const terrainKey = useMemo(() => state.board.map((row) => row.map((tile) => tile.terrain).join()).join("|"), [state.board]);

  const viewPlayer = focusPlayer ?? state.currentPlayer;
  const playViewFor = (target: Layout) => playView(target, armyCenter(state, viewPlayer));
  // On a large screen the whole board is the play view; on a phone Fit zooms out to an overview.
  const fitShowsPlay = layout.fitZoom >= READABLE_ZOOM;

  const showPlayView = () => {
    const view = playViewFor(layout);
    setZoom(view.zoom);
    setPan(view.pan);
    setViewMode("play");
  };

  // A new match, viewer, or canvas size starts in the play view, on the viewer's army. Layout
  // effects, so a new view is never painted (or tapped) in the previous one.
  useLayoutEffect(showPlayView, [layout.width, layout.height, layout.cols, layout.rows, layout.fitZoom, state.mapId, state.id, viewPlayer]);

  // So does each turn the viewer gets to play: every turn in hot-seat, where the viewer is the
  // player to act, and in solo and online play the viewer's next turn after the opponent's. The
  // view is left alone while the AI or the opponent acts, and on moves, refreshes, or a returned
  // submission within a turn the viewer has already been shown.
  const viewerTurn = state.currentPlayer === viewPlayer ? state.turnNumber : null;
  const focusedTurnRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (viewerTurn === null) return;
    const key = `${state.id}:${viewerTurn}`;
    if (focusedTurnRef.current === key) return;
    focusedTurnRef.current = key;
    showPlayView();
  }, [state.id, viewerTurn]);

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
    const scene = sceneRef.current;
    if (!app || !scene) return;

    app.renderer.resize(layout.width, layout.height);
    const root = scene.begin();

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

    if (terrainReady) {
      const terrain = scene.terrainLayer(`${terrainKey}:${layout.step}`, () => buildTerrainLayer(state, layout.step));
      terrain.position.set(pan.x, pan.y);
      terrain.scale.set(zoom);
      root.addChild(terrain);
    }
    for (const tile of state.board.flat()) {
      if (!tile.structure) continue;
      const projected = projectCell(tile, layout, pan, zoom);
      drawOwnershipMarker(root, tile, projected.x, projected.y, projected.size);
    }

    for (const row of state.board) {
      for (const tile of row) {
        const projected = projectCell(tile, layout, pan, zoom);
        const occupant = unitMap.get(`${tile.x},${tile.y}`);
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
      drawUnit(root, unit, projected.centerX - unitSize / 2, projected.centerY - unitSize * 0.5, unitSize, zoom, unit.id === selectedUnitId, scene.label);
    }

    for (const unit of units) {
      const preview = attackPreviews[unit.id];
      if (!attackableSet.has(unit.id) || !preview) continue;
      const position = moveMap.get(unit.id) ?? unit;
      const projected = projectCell(position, layout, pan, zoom);
      drawCombatPreview(root, preview, projected, zoom, scene.label);
    }

    for (const popup of activeVisuals.popups) drawPopupEffect(root, popup, layout, pan, zoom, now, scene.label);
    scene.end();
  }, [attackPreviews, attackableIds, healableIds, layout, pan, reachable, selectedUnitId, state, animationClock, zoom, terrainReady, terrainKey]);

  /** The player found the board controls; the pan hint has done its job. */
  function dismissPanHint() {
    if (!showPanHint) return;
    setShowPanHint(false);
    try {
      localStorage.setItem(PAN_HINT_KEY, "1");
    } catch {
      // Private browsing: the hint simply shows again next time.
    }
  }

  function updateZoom(nextZoom: number, focus?: { x: number; y: number }) {
    dismissPanHint();
    setViewMode("free");
    const clampedZoom = clamp(nextZoom, minZoom(layout), MAX_ZOOM);
    const nextFocus = focus ?? { x: layout.width / 2, y: layout.height / 2 };
    const worldX = (nextFocus.x - pan.x) / zoom;
    const worldY = (nextFocus.y - pan.y) / zoom;
    setZoom(clampedZoom);
    setPan(clampPan({ x: nextFocus.x - worldX * clampedZoom, y: nextFocus.y - worldY * clampedZoom }, clampedZoom, layout));
  }

  /** Fit shows the whole board; when that is smaller than the play view, pressing it again returns to the army. */
  function toggleViewport() {
    dismissPanHint();
    const showPlay = viewMode === "fit" && !fitShowsPlay;
    const view = showPlay ? playViewFor(layout) : fitView(layout);
    setZoom(view.zoom);
    setPan(view.pan);
    setViewMode(showPlay ? "play" : "fit");
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
      const nextZoom = clamp(interaction.pinchStartZoom * (distance(first, second) / Math.max(24, interaction.pinchStartDistance)), minZoom(layout), MAX_ZOOM);
      dismissPanHint();
      setViewMode("free");
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
    if (interaction.mode === "pan") {
      dismissPanHint();
      setViewMode("free");
      setPan(clampPan({ x: interaction.startPanX + dx, y: interaction.startPanY + dy }, zoom, layout));
    }
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

  const controlsStyle = compactControls ? { ...toolbarButtonStyle, width: 40, minHeight: 40 } : toolbarButtonStyle;
  const fitButtonStyle = compactControls ? { ...controlsStyle, width: 50 } : { ...toolbarButtonStyle, width: 56 };
  const hintBoxStyle = compactControls ? { ...hintStyle, maxWidth: "calc(100% - 24px)", fontSize: "0.76rem", left: 8, bottom: 8, padding: "0.4rem 0.6rem" } : hintStyle;
  const boardOverflows = layout.boardWidth * zoom > layout.width - VIEWPORT_PADDING * 2 || layout.boardHeight * zoom > layout.height - VIEWPORT_PADDING * 2;
  const fitLabel = viewMode === "fit" && !fitShowsPlay ? "Focus" : "Fit";

  return (
    <div
      ref={wrapperRef}
      className="canvas-wrap"
      onContextMenu={(event) => event.preventDefault()}
      data-view={viewMode}
      data-zoom={zoom}
      data-pan-x={pan.x}
      data-pan-y={pan.y}
      data-fit-zoom={layout.fitZoom}
      data-regions={terrainReady ? "ready" : "loading"}
    >
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      <div onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} onWheel={handleWheel} style={{ position: "absolute", inset: 0, touchAction: "none", cursor: interactionRef.current.mode === "pan" ? "grabbing" : spacePressed ? "grab" : "default" }} />
      <div style={{ position: "absolute", top: compactControls ? 8 : 12, right: compactControls ? 8 : 12, display: "grid", gap: compactControls ? 6 : 8, zIndex: 2 }}>
        <button type="button" onClick={() => updateZoom(zoom * 1.2)} style={controlsStyle} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => updateZoom(zoom / 1.2)} style={controlsStyle} aria-label="Zoom out">-</button>
        <button
          type="button"
          onClick={toggleViewport}
          style={fitButtonStyle}
          title={fitLabel === "Fit" ? "Show the whole board" : "Zoom back to your army"}
        >
          {fitLabel}
        </button>
      </div>
      {showHint ? <div style={hintBoxStyle}>Desktop: click to select, hold Space and drag to pan, use buttons to zoom. Touch: drag to pan, pinch to zoom.</div> : null}
      {!showHint && showPanHint && boardOverflows ? (
        <div className="canvas-pan-hint" style={{ ...hintBoxStyle, pointerEvents: "none" }}>Drag to pan, pinch to zoom. Fit shows the whole board.</div>
      ) : null}
    </div>
  );
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
