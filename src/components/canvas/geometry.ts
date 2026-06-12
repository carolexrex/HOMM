import type { Coord } from "../../engine";
import {
  BOARD_TOP_PADDING,
  VIEWPORT_PADDING,
  type InteractionState,
  type Layout,
  type PanState,
  type PointerSnapshot,
  type ProjectedCell
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

export function clampPan(nextPan: PanState, zoom: number, layout: Layout): PanState {
  const boardWidth = layout.boardWidth * zoom;
  const boardHeight = layout.boardHeight * zoom;
  const maxWidth = layout.width - VIEWPORT_PADDING * 2;
  const maxHeight = layout.height - VIEWPORT_PADDING * 2;

  nextPan.x = boardWidth <= maxWidth
    ? Math.floor((layout.width - boardWidth) / 2)
    : clamp(nextPan.x, layout.width - VIEWPORT_PADDING - boardWidth, VIEWPORT_PADDING);
  nextPan.y = boardHeight <= maxHeight
    ? BOARD_TOP_PADDING
    : clamp(nextPan.y, layout.height - VIEWPORT_PADDING - boardHeight, BOARD_TOP_PADDING);
  return { x: nextPan.x, y: nextPan.y };
}

export function centerPan(zoom: number, layout: Layout): PanState {
  return clampPan({ x: Math.floor((layout.width - layout.boardWidth * zoom) / 2), y: BOARD_TOP_PADDING }, zoom, layout);
}
