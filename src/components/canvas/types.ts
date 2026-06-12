import type { Coord } from "../../engine";

export interface SurfaceSize { width: number; height: number; }
export interface PanState { x: number; y: number; }

export interface Layout {
  cols: number;
  rows: number;
  width: number;
  height: number;
  boardWidth: number;
  boardHeight: number;
  fitZoom: number;
  step: number;
}

export interface ProjectedCell {
  x: number;
  y: number;
  centerX: number;
  centerY: number;
  size: number;
}

export interface PointerSnapshot { x: number; y: number; }

export interface InteractionState {
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

export interface MoveVisual {
  unitId: string;
  from: Coord;
  to: Coord;
  start: number;
  duration: number;
}

export interface PopupVisual {
  id: string;
  coord: Coord;
  label: string;
  color: number;
  start: number;
  duration: number;
}

export interface AttackVisual {
  id: string;
  kind: "arrow" | "stone" | "slash" | "heal";
  from: Coord;
  to: Coord;
  color: number;
  start: number;
  duration: number;
}

export interface ActiveVisuals {
  moves: MoveVisual[];
  popups: PopupVisual[];
  attacks: AttackVisual[];
}

export const NATURAL_CELL = 84;
export const VIEWPORT_PADDING = 12;
export const BOARD_TOP_PADDING = 16;
export const MIN_ZOOM = 0.45;
export const MAX_ZOOM = 2.2;
export const MOVE_ANIMATION_MS = 220;
export const PROJECTILE_MS = 240;
export const POPUP_MS = 760;
export const SLASH_MS = 170;
export const ARROW_COLOR = 0xf4efe1;
export const STONE_COLOR = 0xe3b2ab;
export const HEAL_COLOR = 0x8fdc80;
