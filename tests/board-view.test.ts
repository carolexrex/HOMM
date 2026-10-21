import { describe, expect, it } from "vitest";
import { maps, type PlayerId } from "../src/engine";
import { boardLayout, clampPan, fitView, minZoom, playView, projectCell } from "../src/components/canvas/geometry";
import { regionTileOutline, type RegionEdge } from "../src/components/canvas/regionShapes";
import { CONTROLS_GAP, MIN_ZOOM, READABLE_ZOOM, VIEWPORT_PADDING, type BoardView, type Layout, type Rect } from "../src/components/canvas/types";

// Canvas sizes measured in the app: a 390x844 phone (compact controls) and a 1280x860 desktop.
const PHONE = { width: 366, height: 544, controls: { left: 308, top: 8, right: 358, bottom: 140 } };
const SMALL_PHONE = { width: 351, height: 367, controls: { left: 293, top: 8, right: 343, bottom: 140 } };
const DESKTOP = { width: 1230, height: 655, controls: { left: 1162, top: 12, right: 1218, bottom: 160 } };

function layoutFor(canvas: typeof PHONE, mapIndex: number): Layout {
  const map = maps[mapIndex];
  return boardLayout({ width: canvas.width, height: canvas.height }, map.size.width, map.size.height, canvas.controls);
}

function boardRect(layout: Layout, view: BoardView): Rect {
  return { left: view.pan.x, top: view.pan.y, right: view.pan.x + layout.boardWidth * view.zoom, bottom: view.pan.y + layout.boardHeight * view.zoom };
}

const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function armyCenter(mapIndex: number, owner: PlayerId) {
  const units = maps[mapIndex].units.filter((unit) => unit.owner === owner);
  return { x: units.reduce((sum, unit) => sum + unit.x, 0) / units.length, y: units.reduce((sum, unit) => sum + unit.y, 0) / units.length };
}

const cases = maps.map((map, index) => [map.name, index] as const);

describe("board view: Fit", () => {
  it.each(cases)("shows the whole of %s on a phone, clear of the zoom controls", (_name, index) => {
    for (const canvas of [PHONE, SMALL_PHONE]) {
      const layout = layoutFor(canvas, index);
      const view = fitView(layout);
      const board = boardRect(layout, view);
      expect(board.left).toBeGreaterThanOrEqual(VIEWPORT_PADDING - 0.5);
      expect(board.top).toBeGreaterThanOrEqual(VIEWPORT_PADDING - 0.5);
      expect(board.right).toBeLessThanOrEqual(canvas.width - VIEWPORT_PADDING + 0.5);
      expect(board.bottom).toBeLessThanOrEqual(canvas.height - VIEWPORT_PADDING + 0.5);
      expect(overlaps(board, { ...canvas.controls, left: canvas.controls.left - CONTROLS_GAP + 1, bottom: canvas.controls.bottom + CONTROLS_GAP - 1 })).toBe(false);
      // A genuine fit, not held at a minimum zoom: the largest board that fits beside or below the controls.
      const inner = { width: canvas.width - VIEWPORT_PADDING * 2, height: canvas.height - VIEWPORT_PADDING * 2 };
      const beside = Math.min((canvas.controls.left - CONTROLS_GAP - VIEWPORT_PADDING) / layout.boardWidth, inner.height / layout.boardHeight);
      const below = Math.min(inner.width / layout.boardWidth, (canvas.height - VIEWPORT_PADDING - canvas.controls.bottom - CONTROLS_GAP) / layout.boardHeight);
      expect(view.zoom).toBe(layout.fitZoom);
      expect(view.zoom).toBeCloseTo(Math.max(beside, below), 9);
      expect(minZoom(layout)).toBeLessThanOrEqual(view.zoom);
    }
  });

  it("zooms out below the old minimum when a wide map needs it", () => {
    const lakewatch = layoutFor(PHONE, maps.findIndex((map) => map.id === "lakewatch"));
    expect(lakewatch.fitZoom).toBeLessThan(MIN_ZOOM);
    expect(minZoom(lakewatch)).toBe(lakewatch.fitZoom);
  });

  it.each(cases)("keeps %s on desktop beside the zoom controls", (_name, index) => {
    const layout = layoutFor(DESKTOP, index);
    const board = boardRect(layout, fitView(layout));
    expect(overlaps(board, DESKTOP.controls)).toBe(false);
    expect(board.bottom).toBeLessThanOrEqual(DESKTOP.height - VIEWPORT_PADDING + 0.5);
  });
});

describe("board view: play view", () => {
  it.each(cases)("is the readable whole board for %s on desktop", (_name, index) => {
    const layout = layoutFor(DESKTOP, index);
    expect(layout.fitZoom).toBeGreaterThanOrEqual(READABLE_ZOOM);
    expect(playView(layout, armyCenter(index, "sun"))).toEqual(fitView(layout));
  });

  it.each(cases)("starts %s on a phone at a readable zoom with the army to act in view", (_name, index) => {
    for (const canvas of [PHONE, SMALL_PHONE]) {
      const layout = layoutFor(canvas, index);
      for (const owner of ["sun", "moon"] as const) {
        const view = playView(layout, armyCenter(index, owner));
        expect(view.zoom).toBeGreaterThanOrEqual(READABLE_ZOOM);
        const board = boardRect(layout, view);
        // Fills the canvas height on a tall phone (no empty band below the board).
        if (canvas === PHONE) expect(board.bottom - board.top).toBeGreaterThanOrEqual(Math.min(canvas.height - VIEWPORT_PADDING * 2, layout.boardHeight) - 1);
        for (const unit of maps[index].units.filter((entry) => entry.owner === owner)) {
          const cell = projectCell(unit, layout, view.pan, view.zoom);
          expect(cell.centerX, `${unit.id} is on screen`).toBeGreaterThan(0);
          expect(cell.centerX).toBeLessThan(canvas.width);
          if (canvas === PHONE) {
            expect(cell.centerY).toBeGreaterThan(0);
            expect(cell.centerY).toBeLessThan(canvas.height);
          }
        }
      }
    }
  });

  it("lets a zoomed board be dragged until its last column clears the zoom controls", () => {
    const layout = layoutFor(PHONE, maps.findIndex((map) => map.id === "lakewatch"));
    const view = playView(layout, armyCenter(maps.findIndex((map) => map.id === "lakewatch"), "moon"));
    const farRight = clampPan({ x: -10_000, y: view.pan.y }, view.zoom, layout);
    expect(farRight.x + layout.boardWidth * view.zoom).toBeLessThanOrEqual(PHONE.controls.left - CONTROLS_GAP + 0.5);
    expect(clampPan({ x: 10_000, y: view.pan.y }, view.zoom, layout).x).toBe(VIEWPORT_PADDING);
  });
});

describe("region outlines", () => {
  const edge: RegionEdge = { inset: 0.12, wobble: 0.04, cornerRadius: 0.3 };
  const region = (cells: string[]) => (x: number, y: number) => cells[y]?.[x] === "#";
  const pointsOf = (outline: number[]) => outline.flatMap((value, index) => (index % 2 === 0 ? [{ x: value, y: outline[index + 1] }] : []));

  it("runs straight along sides shared with the region, so neighbouring tiles meet without a seam", () => {
    const inRegion = region(["...", ".##", ".##"]);
    for (const [ax, ay, bx, by] of [[1, 1, 2, 1], [1, 2, 2, 2], [1, 1, 1, 2]]) {
      const horizontal = ay === by;
      const a = pointsOf(regionTileOutline(inRegion, ax, ay, edge)).filter((point) => (horizontal ? point.x === 1 : point.y === 1));
      const b = pointsOf(regionTileOutline(inRegion, bx, by, edge)).filter((point) => (horizontal ? point.x === 0 : point.y === 0));
      const span = (points: Array<{ x: number; y: number }>) => {
        const values = points.map((point) => (horizontal ? point.y : point.x));
        return [Math.min(...values), Math.max(...values)];
      };
      expect(a.length).toBeGreaterThanOrEqual(2);
      expect(span(a)).toEqual(span(b));
    }
  });

  it("insets land-facing sides, rounds outer corners, and cuts inner corners to meet the neighbours", () => {
    const inRegion = region(["##", "#."]);
    const corner = pointsOf(regionTileOutline(inRegion, 0, 0, edge));
    // Land only diagonally (to the south-east): a quarter circle of the inset's radius is cut from the corner.
    expect(Math.min(...corner.map((point) => Math.hypot(1 - point.x, 1 - point.y)))).toBeCloseTo(edge.inset, 9);
    expect(corner).toContainEqual({ x: 1, y: 1 - edge.inset });
    expect(corner).toContainEqual({ x: 1 - edge.inset, y: 1 });
    // The east tile faces land on three sides: every point stays inside the tile and off the land edges.
    const east = pointsOf(regionTileOutline(inRegion, 1, 0, edge));
    for (const point of east) {
      expect(point.x).toBeLessThanOrEqual(1 - edge.inset + edge.wobble + 1e-9);
      expect(point.y).toBeGreaterThanOrEqual(edge.inset - edge.wobble - 1e-9);
      expect(point.y).toBeLessThanOrEqual(1);
    }
    // Rounded: no point sits in the square outer corner beyond the arc.
    expect(east.some((point) => point.x > 1 - edge.inset - 0.05 && point.y < edge.inset + 0.05)).toBe(false);
  });
});
