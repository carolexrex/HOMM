import { expect, test, type Page } from "@playwright/test";
import { maps, PLAYER_NAMES, type PlayerId } from "../src/engine";
import { canvasView, displayedBoard, endTurnButton, moveSomeUnit, openApp, turnChip } from "./support/app";
import { boardRect, expectPlayView, fitButton, onScreen, pinchOut, touchDrag } from "./support/board";

// Every map in a hot-seat match, at desktop size and on a 390x844 touch phone: the whole-board
// Fit, the readable play view on each army, tapping to select and move, panning, and End Turn.
// These run in the browser only (no server calls), alongside the online suites.

async function startHotseat(page: Page, mapName: string) {
  await openApp(page);
  await page.getByRole("button", { name: /Hot-seat/ }).first().click();
  await page.locator(".launch-map-list").getByRole("button", { name: new RegExp(`^${mapName}`) }).click();
  await page.getByRole("button", { name: "Start Hot-seat Match" }).click();
  // The swamp and lake textures have loaded and the board is drawn with them.
  await expect(page.locator(".canvas-wrap")).toHaveAttribute("data-regions", "ready");
  await expect(turnChip(page)).toContainText(`${PLAYER_NAMES.sun} to act`);
}

async function controlsRect(page: Page) {
  return page.locator(".canvas-wrap").getByRole("button", { name: "Zoom in" }).locator("..").evaluate((element) => {
    const controls = element.getBoundingClientRect();
    const canvas = element.closest(".canvas-wrap")!.getBoundingClientRect();
    return { left: controls.left - canvas.left, top: controls.top - canvas.top, right: controls.right - canvas.left, bottom: controls.bottom - canvas.top };
  });
}

/** Fit shows the whole board, inside the canvas and clear of the zoom controls. */
async function expectFit(page: Page) {
  await expect(fitButton(page)).toHaveText("Fit");
  await fitButton(page).click();
  await expect(page.locator(".canvas-wrap")).toHaveAttribute("data-view", "fit");
  const view = await canvasView(page);
  const board = boardRect(view, await displayedBoard(page));
  expect(view.zoom).toBe(view.fitZoom);
  expect(board.left).toBeGreaterThanOrEqual(0);
  expect(board.top).toBeGreaterThanOrEqual(0);
  expect(board.right).toBeLessThanOrEqual(view.width);
  expect(board.bottom).toBeLessThanOrEqual(view.height);
  const controls = await controlsRect(page);
  const overlaps = board.left < controls.right && controls.left < board.right && board.top < controls.bottom && controls.top < board.bottom;
  expect(overlaps, "the board is clear of the zoom controls").toBe(false);
  return view;
}

/** Ends the turn and waits for the other side to be up. */
async function endTurn(page: Page, next: PlayerId) {
  await endTurnButton(page).click();
  await expect(turnChip(page)).toContainText(`${PLAYER_NAMES[next]} to act`);
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  for (const map of maps) {
    test(`${map.name}: play view, Fit, touch selection, panning, pinch, and End Turn`, async ({ page }) => {
      await startHotseat(page, map.name);
      const opening = await expectPlayView(page, "sun");
      const state = await displayedBoard(page);
      const board = boardRect(opening, state);
      // The board fills the canvas height instead of leaving an empty band beneath it.
      const visibleHeight = Math.min(board.bottom, opening.height) - Math.max(board.top, 0);
      expect(visibleHeight).toBeGreaterThanOrEqual(Math.min(opening.height - 2 * 12, board.bottom - board.top) - 1);
      await expect(page.locator(".canvas-pan-hint")).toBeVisible();

      // Fit is a genuine whole-board overview, and the same button returns to the army.
      const fit = await expectFit(page);
      expect(fit.zoom).toBeLessThan(opening.zoom);
      await expect(fitButton(page)).toHaveText("Focus");
      await fitButton(page).click();
      await expectPlayView(page, "sun");

      // Tap a unit and a destination.
      const first = await moveSomeUnit(page);

      // Drag the board to see the far side; the hint has done its job.
      const before = await canvasView(page);
      const middle = { x: before.left + before.width / 2, y: before.top + before.height / 2 };
      await touchDrag(page, middle, { x: middle.x - 160, y: middle.y - 40 });
      await expect.poll(async () => (await canvasView(page)).mode).toBe("free");
      const panned = await canvasView(page);
      expect(panned.panX).toBeLessThan(before.panX);
      await expect(page.locator(".canvas-pan-hint")).toHaveCount(0);
      // Taps still land on the right tile after panning, and a move keeps the chosen view.
      await moveSomeUnit(page, [first.unitId]);
      expect(await canvasView(page)).toEqual(panned);

      // Pinch to zoom in.
      await pinchOut(page, middle);
      await expect.poll(async () => (await canvasView(page)).zoom).toBeGreaterThan(panned.zoom);

      // The next player's turn opens on their own army.
      await endTurn(page, "moon");
      await expectPlayView(page, "moon");
      await moveSomeUnit(page);
      await endTurn(page, "sun");
      await expectPlayView(page, "sun", false);
      await moveSomeUnit(page);
    });
  }
});

test.describe("on a desktop", () => {
  for (const map of maps) {
    test(`${map.name}: whole board readable, selection, zoomed panning, and End Turn`, async ({ page }) => {
      await startHotseat(page, map.name);
      const opening = await expectPlayView(page, "sun");
      // On a large screen the play view is the whole board, so Fit keeps it.
      const fit = await expectFit(page);
      expect(fit.zoom).toBe(opening.zoom);
      await expect(fitButton(page)).toHaveText("Fit");
      await expect(page.locator(".canvas-pan-hint")).toHaveCount(0);
      for (const unit of (await displayedBoard(page)).units) expect(onScreen(fit, unit)).toBe(true);

      const first = await moveSomeUnit(page);

      // Zoom in, then drag with the middle button to pan (Space and drag works the same way).
      await page.locator(".canvas-wrap").getByRole("button", { name: "Zoom in" }).click();
      await page.locator(".canvas-wrap").getByRole("button", { name: "Zoom in" }).click();
      const zoomed = await canvasView(page);
      expect(zoomed.zoom).toBeGreaterThan(fit.zoom);
      const middle = { x: zoomed.left + zoomed.width / 2, y: zoomed.top + zoomed.height / 2 };
      await page.mouse.move(middle.x, middle.y);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(middle.x + 150, middle.y + 60, { steps: 6 });
      await page.mouse.up({ button: "middle" });
      await expect.poll(async () => (await canvasView(page)).panX).toBeGreaterThan(zoomed.panX);
      await moveSomeUnit(page, [first.unitId]);

      // A new turn returns to the whole-board view.
      await endTurn(page, "moon");
      await expectPlayView(page, "moon");
      await moveSomeUnit(page);
      await endTurn(page, "sun");
      await expect(page.locator(".canvas-wrap")).toHaveAttribute("data-view", "play");
    });
  }
});
