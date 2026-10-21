import { expect, type Page } from "@playwright/test";
import { type Coord, type MatchState, type PlayerId } from "../../src/engine";
import { NATURAL_CELL, READABLE_ZOOM } from "../../src/components/canvas/types";
import { canvasView, displayedBoard, type CanvasView } from "./app";

// The board canvas's view (zoom, pan, and mode), which it publishes as data attributes, and the
// gestures that change it.

export const fitButton = (page: Page) => page.locator(".canvas-wrap").getByRole("button", { name: /^(Fit|Focus)$/ });

/** The board's rectangle in canvas coordinates. */
export function boardRect(view: CanvasView, state: MatchState) {
  const size = NATURAL_CELL * view.zoom;
  return { left: view.panX, top: view.panY, right: view.panX + state.board[0].length * size, bottom: view.panY + state.board.length * size };
}

export function onScreen(view: CanvasView, coord: Coord) {
  const size = NATURAL_CELL * view.zoom;
  const x = view.panX + (coord.x + 0.5) * size;
  const y = view.panY + (coord.y + 0.5) * size;
  return x > 0 && x < view.width && y > 0 && y < view.height;
}

export function armyCenter(state: MatchState, side: PlayerId): Coord {
  const army = state.units.filter((unit) => unit.owner === side);
  return { x: army.reduce((sum, unit) => sum + unit.x, 0) / army.length, y: army.reduce((sum, unit) => sum + unit.y, 0) / army.length };
}

/**
 * The turn opens on a readable view of `side`'s army: every unit on screen at the start of the
 * match, and the army's centre later (a spread-out army can be wider than a phone).
 */
export async function expectPlayView(page: Page, side: PlayerId, wholeArmy = true) {
  await expect(page.locator(".canvas-wrap")).toHaveAttribute("data-view", "play");
  const view = await canvasView(page);
  const state = await displayedBoard(page);
  expect(view.zoom).toBeGreaterThanOrEqual(READABLE_ZOOM);
  if (wholeArmy) {
    for (const unit of state.units.filter((entry) => entry.owner === side)) expect(onScreen(view, unit), `${unit.id} is on screen in the play view`).toBe(true);
  } else {
    expect(onScreen(view, armyCenter(state, side)), `the centre of ${side}'s army is on screen`).toBe(true);
  }
  return view;
}

/** One finger dragged across the board through Chromium's touch input, as a phone sends it. */
export async function touchDrag(page: Page, from: Coord, to: Coord) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let step = 1; step <= 8; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / 8;
    const y = from.y + ((to.y - from.y) * step) / 8;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Two fingers spread apart around `center`. */
export async function pinchOut(page: Page, center: Coord) {
  const cdp = await page.context().newCDPSession(page);
  const fingers = (spread: number) => [{ x: center.x - spread, y: center.y, id: 1 }, { x: center.x + spread, y: center.y, id: 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers(30) });
  for (let spread = 40; spread <= 90; spread += 10) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingers(spread) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
