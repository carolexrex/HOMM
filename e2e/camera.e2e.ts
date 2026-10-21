import { expect, test, type Page } from "@playwright/test";
import { PLAYER_NAMES, type PlayerId } from "../src/engine";
import { canvasView, displayedBoard, endTurnButton, message, moveSomeUnit, openApp, syncButton, turnChip, unitPositions, type CanvasView } from "./support/app";
import { armyCenter, expectPlayView, fitButton, onScreen, touchDrag } from "./support/board";
import { closePlayers, startDuel } from "./support/duel";

// The board camera across turns on a 390x844 phone, where the play view shows only part of
// Lakewatch: the viewer's next turn opens on their army after the AI or the online opponent has
// played, and a view the player chose is kept through moves, Refresh, and the opponent's turn.

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

test.afterEach(closePlayers);

const viewKey = (view: Pick<CanvasView, "mode" | "zoom" | "panX" | "panY">) => `${view.mode} ${view.zoom} ${view.panX} ${view.panY}`;

/**
 * Records every view the board shows from now on, as the canvas publishes it; returns a reader.
 * It only observes the canvas's attributes.
 */
async function recordViews(page: Page) {
  await page.evaluate(() => {
    const wrap = document.querySelector<HTMLElement>(".canvas-wrap")!;
    const views: string[] = [];
    const record = () => {
      const data = wrap.dataset;
      const view = `${data.view} ${Number(data.zoom)} ${Number(data.panX)} ${Number(data.panY)}`;
      if (views[views.length - 1] !== view) views.push(view);
    };
    record();
    new MutationObserver(record).observe(wrap, { attributes: true, attributeFilter: ["data-view", "data-zoom", "data-pan-x", "data-pan-y"] });
    (window as unknown as { boardViews: string[] }).boardViews = views;
  });
  return () => page.evaluate(() => (window as unknown as { boardViews: string[] }).boardViews.slice());
}

/** Drags the board by one finger from the middle of the canvas. */
async function drag(page: Page, dx: number, dy: number) {
  await page.locator(".canvas-wrap").scrollIntoViewIfNeeded();
  const view = await canvasView(page);
  const middle = { x: view.left + view.width / 2, y: view.top + view.height / 2 };
  await touchDrag(page, middle, { x: middle.x + dx, y: middle.y + dy });
  await expect.poll(async () => viewKey(await canvasView(page))).not.toBe(viewKey(view));
  return canvasView(page);
}

/** Drags the board across to `enemy`'s army, leaving the viewer's whole army offscreen. */
async function panToEnemy(page: Page, viewer: PlayerId, enemy: PlayerId) {
  const state = await displayedBoard(page);
  let view = await canvasView(page);
  for (let step = 0; step < 8 && !onScreen(view, armyCenter(state, enemy)); step += 1) view = await drag(page, -150, 0);
  expect(view.mode).toBe("free");
  expect(onScreen(view, armyCenter(state, enemy)), `${enemy}'s army is in view`).toBe(true);
  for (const unit of state.units.filter((entry) => entry.owner === viewer)) expect(onScreen(view, unit), `${unit.id} is offscreen`).toBe(false);
  return view;
}

/** A small drag, then a move: the move keeps the view the player chose. */
async function moveInPannedView(page: Page) {
  const panned = await drag(page, -20, -30);
  expect(panned.mode).toBe("free");
  await moveSomeUnit(page);
  expect(await canvasView(page)).toEqual(panned);
  return panned;
}

test.describe("on a phone", () => {
  test.use(PHONE);

  test("solo: the next human turn opens on the army after the AI's turn, without moving while the AI acts", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /Solo vs AI/ }).click();
    await page.locator(".launch-map-list").getByRole("button", { name: /^Lakewatch/ }).click();
    await page.getByRole("button", { name: "Start Solo Match" }).click();
    await expect(page.locator(".canvas-wrap")).toHaveAttribute("data-regions", "ready");
    await expect(turnChip(page)).toContainText(`${PLAYER_NAMES.sun} to act`);
    await expectPlayView(page, "sun");

    await moveInPannedView(page);
    const away = await panToEnemy(page, "sun", "moon");
    const moonBefore = unitPositions(await displayedBoard(page));

    // The AI plays its turn action by action; the camera stays where the player left it, then
    // moves once, to the player's army, when their turn begins.
    const views = await recordViews(page);
    await endTurnButton(page).click();
    await expect(turnChip(page)).toContainText(`${PLAYER_NAMES.sun} to act`);
    await expect(turnChip(page)).toContainText("Turn 3");
    await expect(endTurnButton(page)).toBeEnabled();
    expect(unitPositions(await displayedBoard(page)), "the AI moved its units").not.toEqual(moonBefore);
    const refocused = await expectPlayView(page, "sun", false);
    expect(await views()).toEqual([viewKey(away), viewKey(refocused)]);

    // Fit is kept through a move, and Focus returns to the army.
    await fitButton(page).click();
    await expect(page.locator(".canvas-wrap")).toHaveAttribute("data-view", "fit");
    const fit = await canvasView(page);
    await moveSomeUnit(page);
    expect(await canvasView(page)).toEqual(fit);
    await expect(fitButton(page)).toHaveText("Focus");
    await fitButton(page).click();
    await expectPlayView(page, "sun", false);
  });
});

test("online: Refresh into the viewer's next turn opens on their army; Refresh within a turn or while waiting keeps the view", async ({ browser }) => {
  const { sun, moon } = await startDuel(browser, "Lakewatch", { sun: PHONE });
  await expect(sun.locator(".canvas-wrap")).toHaveAttribute("data-regions", "ready");
  await expectPlayView(sun, "sun");

  // Within Sun's turn: a move, a Refresh, and the accepted submission keep the chosen view.
  const panned = await moveInPannedView(sun);
  await syncButton(sun).click();
  await expect(message(sun)).toHaveText("Refreshed: your 1 unsent move(s) are kept until End Turn.");
  expect(await canvasView(sun)).toEqual(panned);
  await endTurnButton(sun).click();
  await expect(message(sun)).toHaveText("Turn accepted. Waiting for opponent.");
  expect(await canvasView(sun)).toEqual(panned);

  // While waiting, Sun looks across at Moon's army and refreshes before Moon has played.
  const away = await panToEnemy(sun, "sun", "moon");
  const views = await recordViews(sun);
  await syncButton(sun).click();
  await expect(message(sun)).toHaveText("Refreshed: waiting for opponent.");
  expect(await canvasView(sun)).toEqual(away);

  // Moon plays its turn.
  await syncButton(moon).click();
  await expect(message(moon)).toHaveText("Refreshed: your turn.");
  await moveSomeUnit(moon);
  await endTurnButton(moon).click();
  await expect(message(moon)).toHaveText("Turn accepted. Waiting for opponent.");

  // Sun's Refresh brings its next turn, which opens on its army.
  await syncButton(sun).click();
  await expect(message(sun)).toHaveText("Refreshed: your turn.");
  await expect(turnChip(sun)).toContainText("Turn 3");
  const refocused = await expectPlayView(sun, "sun", false);
  expect(await views()).toEqual([viewKey(away), viewKey(refocused)]);

  // And a move and a Refresh on that turn keep a view chosen during it.
  const again = await moveInPannedView(sun);
  await syncButton(sun).click();
  await expect(message(sun)).toHaveText("Refreshed: your 1 unsent move(s) are kept until End Turn.");
  expect(await canvasView(sun)).toEqual(again);
});
