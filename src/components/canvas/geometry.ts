import type { Coord } from "../../engine";
import {
  CONTROLS_GAP,
  MAX_ZOOM,
  MIN_ZOOM,
  NATURAL_CELL,
  PLAY_MAX_ZOOM,
  READABLE_ZOOM,
  VIEWPORT_PADDING,
  type BoardView,
  type InteractionState,
  type Layout,
  type PanState,
  type PointerSnapshot,
  type ProjectedCell,
  type Rect,
  type SurfaceSize
} from "./types";

export function projectCell(coord: Coord, layout: Layout, pan: PanState, zoom: number): ProjectedCell {
  const size = layout.step * zoom;
  const x = pan.x + coord.x * layout.step * zoom;
  const y = pan.y + coord.y * layout.step * zoom;
  return { x, y, centerX: x + size / 2, centerY: y + size / 2, size };
}

export function hitTestCell(screenX: number, screenY: number, layout: Layout, pan: PanState, zoom: number): Coord | null {
  const worldX = (screenX - pan.x) / zoom;
  const worldY = (screenY - pan.y) / zoom;
  const x = Math.floor(worldX / layout.step);
  const y = Math.floor(worldY / layout.step);
  return x >= 0 && y >= 0 && x < layout.cols && y < layout.rows ? { x, y } : null;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

export function distance(first: PointerSnapshot, second: PointerSnapshot) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function idleInteraction(): InteractionState {
  return {
    mode: "idle",
    pointerId: null,
    pointerType: null,
    moved: false,
    startClientX: 0,
    startClientY: 0,
    startPanX: 0,
    startPanY: 0,
    pinchStartDistance: 0,
    pinchStartZoom: 1,
    pinchWorldX: 0,
    pinchWorldY: 0
  };
}

/** Board metrics for a canvas; `fitZoom` is the largest zoom that shows the whole board. */
export function boardLayout(surface: SurfaceSize, cols: number, rows: number, controls: Rect): Layout {
  const boardWidth = cols * NATURAL_CELL;
  const boardHeight = rows * NATURAL_CELL;
  const base = { cols, rows, width: surface.width, height: surface.height, boardWidth, boardHeight, step: NATURAL_CELL, controls };
  return { ...base, fitZoom: fitPlacement({ ...base, fitZoom: 1 }).zoom };
}

/** The free areas beside and below the zoom controls, and the larger fit of the two. */
function fitPlacement(layout: Layout): { zoom: number; area: Rect } {
  const { width, height, boardWidth, boardHeight, controls } = layout;
  const inner = { left: VIEWPORT_PADDING, top: VIEWPORT_PADDING, right: width - VIEWPORT_PADDING, bottom: height - VIEWPORT_PADDING };
  const areas = [
    { ...inner, right: Math.min(inner.right, controls.left - CONTROLS_GAP) },
    { ...inner, top: Math.max(inner.top, controls.bottom + CONTROLS_GAP) }
  ];
  const fits = areas.map((area) => ({
    area,
    zoom: Math.min(MAX_ZOOM, Math.max(0.01, Math.min((area.right - area.left) / boardWidth, (area.bottom - area.top) / boardHeight)))
  }));
  return fits[0].zoom >= fits[1].zoom ? fits[0] : fits[1];
}

/** The smallest zoom allowed: the whole-board fit, or MIN_ZOOM if that is smaller. */
export function minZoom(layout: Layout) {
  return Math.min(MIN_ZOOM, layout.fitZoom);
}

/** The whole board, centred in the free area beside or below the zoom controls. */
export function fitView(layout: Layout): BoardView {
  const { zoom, area } = fitPlacement(layout);
  return {
    zoom,
    pan: {
      x: Math.round(area.left + (area.right - area.left - layout.boardWidth * zoom) / 2),
      y: Math.round(area.top + (area.bottom - area.top - layout.boardHeight * zoom) / 2)
    }
  };
}

/**
 * The view a turn starts in. When the whole board is readable, that is the fit. Otherwise (a
 * phone) the board fills the canvas height at a readable zoom, centred on `focus` (the
 * player's army), and the rest of the board is a drag away.
 */
export function playView(layout: Layout, focus: Coord | null): BoardView {
  const fit = fitView(layout);
  if (layout.fitZoom >= READABLE_ZOOM) return fit;
  const fillHeight = (layout.height - VIEWPORT_PADDING * 2) / layout.boardHeight;
  const zoom = clamp(fillHeight, READABLE_ZOOM, Math.max(READABLE_ZOOM, PLAY_MAX_ZOOM));
  const center = focus ?? { x: (layout.cols - 1) / 2, y: (layout.rows - 1) / 2 };
  const cell = layout.step * zoom;
  const pan = { x: layout.width / 2 - (center.x + 0.5) * cell, y: layout.height / 2 - (center.y + 0.5) * cell };
  return { zoom, pan: clampPan(pan, zoom, layout) };
}

/**
 * Keeps the board on screen. A board that fits along an axis stays fully visible; a larger one
 * can be dragged until its edge reaches the padding, and on the right until its last column
 * clears the zoom controls.
 */
export function clampPan(nextPan: PanState, zoom: number, layout: Layout): PanState {
  const boardWidth = layout.boardWidth * zoom;
  const boardHeight = layout.boardHeight * zoom;
  const controlsGutter = layout.width - layout.controls.left + CONTROLS_GAP;
  const x = boardWidth <= layout.width - VIEWPORT_PADDING * 2
    ? clamp(nextPan.x, VIEWPORT_PADDING, layout.width - VIEWPORT_PADDING - boardWidth)
    : clamp(nextPan.x, layout.width - Math.max(VIEWPORT_PADDING, controlsGutter) - boardWidth, VIEWPORT_PADDING);
  const y = boardHeight <= layout.height - VIEWPORT_PADDING * 2
    ? clamp(nextPan.y, VIEWPORT_PADDING, layout.height - VIEWPORT_PADDING - boardHeight)
    : clamp(nextPan.y, layout.height - VIEWPORT_PADDING - boardHeight, VIEWPORT_PADDING);
  return { x: Math.round(x), y: Math.round(y) };
}
