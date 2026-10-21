import { expect, test, type Page } from "@playwright/test";
import { applyTurnAction, PLAYER_NAMES, unitDefinitions, type Coord, type MatchState, type PlayerId, type TurnAction } from "../src/engine";
import { planAiTurn } from "../src/engine/ai/planner";
import type { CanvasLabel, CanvasResourceStats } from "../src/components/canvas/resourceProbe";
import { canvasView, cellPoint, displayedBoard, endTurnButton, moveSomeUnit, openApp, openMenu, tapTile, tappable, turnChip } from "./support/app";
import { fitButton } from "./support/board";
import { NATURAL_CELL } from "../src/components/canvas/types";

// The board's rendering resources stay steady through play: every redraw replaces the scene,
// and what it replaced must be released (Text canvases and textures, Graphics buffers), while
// the shared unit, terrain, and region art is kept. The counts come from a read-only probe the
// page switches on (src/components/canvas/resourceProbe.ts) and are of resources alive now, not
// of allocations so far. The labels are checked as the GPU draws them and on screen.

declare global {
  interface Window {
    __BANNERFRONT_PROBE__?: boolean;
    __bannerfrontCanvas?: { stats(): CanvasResourceStats; labels(): CanvasLabel[] };
  }
}

const resources = (page: Page) => page.evaluate(() => window.__bannerfrontCanvas!.stats());
const labels = (page: Page) => page.evaluate(() => window.__bannerfrontCanvas!.labels());

/** WebGL errors the browser reports, such as the glGenerateMipmap warning seen in Safari. */
const glWarnings = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__BANNERFRONT_PROBE__ = true;
  });
  const warnings: string[] = [];
  glWarnings.set(page, warnings);
  page.on("console", (entry) => {
    if (/INVALID_|glGenerateMipmap|CONTEXT_LOST|WebGL: /i.test(entry.text())) warnings.push(entry.text());
  });
});

test.afterEach(async ({ page }) => {
  expect(glWarnings.get(page), "no WebGL errors").toEqual([]);
});

async function startMatch(page: Page, mode: "hotseat" | "solo", mapName: string) {
  await page.getByRole("button", { name: mode === "hotseat" ? /Hot-seat/ : /Solo vs AI/ }).first().click();
  await page.locator(".launch-map-list").getByRole("button", { name: new RegExp(`^${mapName}`) }).click();
  await page.getByRole("button", { name: mode === "hotseat" ? "Start Hot-seat Match" : "Start Solo Match" }).click();
  await expect(page.locator(".canvas-wrap")).toHaveAttribute("data-regions", "ready");
  await expect(turnChip(page)).toContainText(`${PLAYER_NAMES.sun} to act`);
  await expect.poll(async () => (await resources(page)).apps).toBe(1);
}

async function exitMatch(page: Page) {
  await openMenu(page);
  await page.locator(".play-menu").getByRole("button", { name: "Exit Match" }).click();
  await expect(page.getByRole("heading", { name: "Launch A Match" })).toBeVisible();
}

/** Resources once no attack or popup is on the board and the art has loaded. */
async function settled(page: Page) {
  await expect.poll(async () => {
    const stats = await resources(page);
    return stats.effects === 0 && stats.sharedTexturesLoaded === stats.sharedTextures;
  }).toBe(true);
  return resources(page);
}

/** The same scene holds the same resources: nothing from earlier redraws is still alive. */
function expectSameResources(after: CanvasResourceStats, before: CanvasResourceStats) {
  expect(before).toMatchObject({ orphanCanvasTextures: 0, orphanGlTextures: 0, orphanGlGeometries: 0, orphanGlBuffers: 0 });
  const { glTextures, ...rest } = after;
  const { glTextures: beforeTextures, ...beforeRest } = before;
  expect(rest).toEqual(beforeRest);
  // The GPU may also have let go of an unused texture since.
  expect(glTextures).toBeLessThanOrEqual(beforeTextures);
}

/**
 * Whatever the scene, the live resources are the scene's own: every canvas texture is a label on
 * the board, every GPU texture, geometry, and buffer is drawn by the scene (or is the shared art
 * or the renderer's batching), and the shared art is unchanged and loaded.
 */
function expectOwnedResources(stats: CanvasResourceStats, start: CanvasResourceStats) {
  expect(stats).toMatchObject({ apps: 1, orphanCanvasTextures: 0, orphanGlTextures: 0, orphanGlGeometries: 0, orphanGlBuffers: 0 });
  expect(stats.textures - stats.canvasTextures, "the shared art is kept, once").toBe(start.textures - start.canvasTextures);
  expect(stats.sharedTextures).toBe(start.sharedTextures);
  expect(stats.sharedTexturesLoaded).toBe(start.sharedTextures);
}

const distance = (left: number[], right: number[]) => Math.hypot(...left.map((value, index) => value - right[index]));

/** Counts screen pixels in a rectangle of the canvas (CSS pixels): light ones, and dark ones. */
async function screenPixels(page: Page, rect: CanvasLabel["bounds"]) {
  const view = await canvasView(page);
  const clip = { x: view.left + rect.left, y: view.top + rect.top, width: Math.max(1, rect.right - rect.left), height: Math.max(1, rect.bottom - rect.top) };
  const png = (await page.screenshot({ clip })).toString("base64");
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let light = 0;
    let dark = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const [r, g, b] = [pixels[index], pixels[index + 1], pixels[index + 2]];
      if (r > 200 && g > 170 && b > 160) light += 1;
      // Well below the HP bar's green (luminance about 195), even where a glyph is blended into it.
      if (0.3 * r + 0.59 * g + 0.11 * b < 130) dark += 1;
    }
    canvas.width = canvas.height = 0;
    return { light, dark, total: pixels.length / 4 };
  }, png);
}

/**
 * Every label on the board is drawn: its texture, as the GPU draws it, has its glyphs in the
 * label's colour (not black, not empty). Combat labels show light glyphs on screen, and the HP
 * numbers of unhurt units show dark glyphs on their green bars.
 */
async function expectLabelsVisible(page: Page, required: string[]) {
  const found = await labels(page);
  for (const name of required) expect(found.filter((label) => label.name === name).length, `a ${name} label is on the board`).toBeGreaterThan(0);
  for (const label of found) {
    const description = `${label.name} label "${label.text}"`;
    expect(label.coverage, `${description} has glyphs`).toBeGreaterThan(0.03);
    expect(distance(label.color!, label.expected), `${description} is drawn in ${label.color}, meant ${label.expected}`).toBeLessThan(48);
  }
  for (const label of found.filter((entry) => entry.name === "combat")) {
    expect((await screenPixels(page, label.bounds)).light, `${label.name} label "${label.text}" is light on screen`).toBeGreaterThan(3);
  }
  // HP numbers of unhurt units, whose bars are green right across: matched to their unit by position.
  const state = await displayedBoard(page);
  const view = await canvasView(page);
  const size = NATURAL_CELL * view.zoom;
  const unhurt = state.units.filter((unit) => unit.hp === unitDefinitions[unit.kind].maxHp);
  const onBars = found.filter((label) => {
    if (label.name !== "hp" || label.bounds.left < 0 || label.bounds.top < 0 || label.bounds.right > view.width || label.bounds.bottom > view.height) return false;
    const x = (label.bounds.left + label.bounds.right) / 2;
    const y = (label.bounds.top + label.bounds.bottom) / 2;
    return unhurt.some((unit) => Math.abs(view.panX + (unit.x + 0.5) * size - x) < size * 0.1 && Math.abs(view.panY + (unit.y + 0.88) * size - y) < size * 0.1);
  });
  expect(onBars.length, "unhurt units' HP numbers are on screen").toBeGreaterThan(0);
  for (const label of onBars.slice(0, 4)) {
    // The middle third of the label's height lies on the HP bar.
    const third = (label.bounds.bottom - label.bounds.top) / 3;
    const pixels = await screenPixels(page, { ...label.bounds, top: label.bounds.top + third, bottom: label.bounds.bottom - third });
    expect(pixels.dark, `hp label "${label.text}" is dark on its green bar on screen`).toBeGreaterThan(1);
  }
}

/**
 * Points at a cell and clicks it once nothing covers it: on a desktop the selected unit's panel
 * fades and lets clicks through while the pointer is over it.
 */
async function tapWhenUncovered(page: Page, coord: Coord) {
  const point = await cellPoint(page, coord);
  await page.mouse.move(point.x, point.y);
  await expect.poll(() => tappable(page, coord), { message: `cell ${coord.x},${coord.y} is uncovered` }).toBe(true);
  await tapTile(page, coord);
}

async function clearSelection(page: Page) {
  if (await page.locator(".play-selected").isVisible()) {
    await page.locator(".play-actions").getByRole("button", { name: "Clear" }).click();
    await expect(page.locator(".play-selected")).toHaveCount(0);
  }
}

/**
 * Zooms in twice, holds Space and drags the board, and zooms out, as a desktop player does.
 * (Space and drag rather than the middle button, which Playwright's WebKit does not press.)
 */
async function zoomAndPan(page: Page) {
  const zoomIn = page.locator(".canvas-wrap").getByRole("button", { name: "Zoom in" });
  const before = await canvasView(page);
  await zoomIn.click();
  await zoomIn.click();
  await expect.poll(async () => (await canvasView(page)).zoom).toBeGreaterThan(before.zoom);
  // Click the turn chip so Space does not press the focused zoom button, then hold it.
  await turnChip(page).click();
  await page.keyboard.down("Space");
  await expect(page.locator(".canvas-wrap > div").nth(1)).toHaveCSS("cursor", "grab");
  const zoomed = await canvasView(page);
  const middle = { x: zoomed.left + zoomed.width / 2, y: zoomed.top + zoomed.height / 2 };
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x + 120, middle.y + 50, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(async () => (await canvasView(page)).panX).not.toBe(zoomed.panX);
  await page.locator(".canvas-wrap").getByRole("button", { name: "Zoom out" }).click();
  await fitButton(page).click();
  await expect(page.locator(".canvas-wrap")).toHaveAttribute("data-view", "fit");
}

interface PlayHooks {
  /** Called with the attacker of the turn's first attack selected and its combat preview up. */
  preview?(): Promise<void>;
  /** Called as soon as an attack's result is on the board. */
  attacked?(): Promise<void>;
}

/** The units on a board, without their IDs (a recruit's ID is random). */
const unitsOf = (state: MatchState) => state.units.map((unit) => `${unit.owner} ${unit.kind} ${unit.x},${unit.y} ${unit.hp}`).sort();

/**
 * Plays one of the current player's actions through the board and the recruit sheet, and waits
 * until the displayed board is the engine's result.
 */
async function playAction(page: Page, before: MatchState, action: Exclude<TurnAction, { type: "end_turn" }>, hooks: PlayHooks) {
  const expected = applyTurnAction(before, action);
  expect(expected.ok, `${action.type} is legal`).toBe(true);
  await clearSelection(page);
  if (action.type === "recruit") {
    await page.locator(".play-actions").getByRole("button", { name: "Recruit" }).click();
    await page.locator(".recruit-option", { hasText: unitDefinitions[action.kind].label }).click();
  } else {
    const actorId = action.type === "move" ? action.unitId : action.type === "attack" ? action.attackerId : action.healerId;
    await tapWhenUncovered(page, before.units.find((unit) => unit.id === actorId)!);
    await expect(page.locator(".play-selected")).toBeVisible();
    if (action.type === "attack" && hooks.preview) {
      await expect.poll(async () => (await labels(page)).some((label) => label.name === "combat")).toBe(true);
      await hooks.preview();
    }
    await tapWhenUncovered(page, action.type === "move" ? action.to : before.units.find((unit) => unit.id === action.targetId)!);
    if (action.type === "attack") await hooks.attacked?.();
  }
  await expect.poll(async () => unitsOf(await displayedBoard(page))).toEqual(unitsOf(expected.state));
}

/**
 * Plays the side to act's turn as the AI planner would (every action but a winning one), one
 * action at a time from the displayed board; returns its attacks. The turn's first attack is
 * previewed through `hooks.preview`.
 */
async function playPlannedTurn(page: Page, difficulty: "easy" | "normal", hooks: PlayHooks = {}) {
  let attacks = 0;
  for (let step = 0; step < 16; step += 1) {
    const state = await displayedBoard(page);
    const action = planAiTurn(state, difficulty).actions[0];
    if (!action || action.type === "end_turn") break;
    const result = applyTurnAction(state, action);
    if (!result.ok || result.state.winner) break;
    await playAction(page, state, action, attacks === 0 ? hooks : { attacked: hooks.attacked });
    if (action.type === "attack") attacks += 1;
  }
  await clearSelection(page);
  return attacks;
}

/**
 * The attack's damage popup rises over the target (for under a second): it is drawn, in its
 * colour. Read as soon as the attack lands.
 */
async function expectDamagePopup(page: Page) {
  const deadline = Date.now() + 5_000;
  let popups: CanvasLabel[] = [];
  while (!popups.length && Date.now() < deadline) popups = (await labels(page)).filter((label) => label.name === "popup");
  expect(popups.length, "a damage popup is on the board").toBeGreaterThan(0);
  for (const popup of popups) {
    expect(popup.coverage, `popup "${popup.text}" has glyphs`).toBeGreaterThan(0.03);
    expect(distance(popup.color!, popup.expected), `popup "${popup.text}" is drawn in ${popup.color}, meant ${popup.expected}`).toBeLessThan(48);
  }
}

async function endTurnTo(page: Page, side: PlayerId, turn: number) {
  await endTurnButton(page).click();
  await expect(turnChip(page)).toContainText(`${PLAYER_NAMES[side]} to act`);
  await expect(turnChip(page)).toContainText(`Turn ${turn}`);
  await expect(endTurnButton(page)).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("selection, panning, and zooming leave the board's resources unchanged", async ({ page }) => {
  await startMatch(page, "hotseat", "Lakewatch");
  const baseline = await settled(page);
  const sun = (await displayedBoard(page)).units.filter((unit) => unit.owner === "sun");

  for (let round = 0; round < 24; round += 1) {
    const unit = sun[round % sun.length];
    await tapTile(page, unit);
    await expect(page.locator(".play-selected")).toBeVisible();
    // Deselect by tapping the unit again, or with Clear.
    if (round % 2) await tapTile(page, unit);
    else await page.locator(".play-actions").getByRole("button", { name: "Clear" }).click();
    await expect(page.locator(".play-selected")).toHaveCount(0);
    if (round % 3 === 0) await zoomAndPan(page);
  }

  const after = await settled(page);
  console.log("selection/pan/zoom", JSON.stringify({ baseline, after }));
  expectSameResources(after, baseline);
  await expectLabelsVisible(page, ["hp"]);
});

test("movement, attacks, combat previews, and damage popups release what they draw", async ({ page }) => {
  test.setTimeout(300_000);
  await startMatch(page, "hotseat", "Meadow Line");
  const start = await settled(page);
  let previewed = false;
  let attacks = 0;
  const hooks: PlayHooks = {
    async preview() {
      if (previewed) return;
      previewed = true;
      // The attacker is selected and its combat preview is up: the same scene, panned, zoomed,
      // and drawn again many times, holds the same resources.
      const preview = await settled(page);
      await expectLabelsVisible(page, ["hp", "combat", "combat-meta"]);
      for (let round = 0; round < 10; round += 1) await zoomAndPan(page);
      expectSameResources(await settled(page), preview);
      await expectLabelsVisible(page, ["hp", "combat", "combat-meta"]);
    },
    async attacked() {
      attacks += 1;
      await expectDamagePopup(page);
    }
  };

  // Both sides play the planner's turns: moves, recruits, heals, and attacks.
  for (let turn = 1; turn <= 12; turn += 1) {
    await playPlannedTurn(page, "normal", hooks);
    expectOwnedResources(await settled(page), start);
    await endTurnTo(page, turn % 2 ? "moon" : "sun", turn + 1);
  }
  expect(previewed, "an attack was previewed").toBe(true);
  expect(attacks, "attacks were made").toBeGreaterThan(3);
  expectOwnedResources(await settled(page), start);
  await expectLabelsVisible(page, ["hp"]);
});

test("leaving and reopening matches releases each board", async ({ page }) => {
  await startMatch(page, "hotseat", "Lakewatch");
  const first = await settled(page);
  await exitMatch(page);
  const launch = await resources(page);
  // Only the shared art (and Pixi's white texture) outlives the board.
  expect(launch).toMatchObject({ apps: 0, canvasTextures: 1, orphanCanvasTextures: 0, glTextures: 0, glBuffers: 0, glGeometries: 0, sceneObjects: 0, sharedTextures: first.sharedTextures });

  for (let round = 0; round < 6; round += 1) {
    await startMatch(page, round % 2 ? "solo" : "hotseat", "Lakewatch");
    expectSameResources(await settled(page), first);
    await expectLabelsVisible(page, ["hp"]);
    // Leave just after a move, while it is still animating.
    await moveSomeUnit(page);
    await exitMatch(page);
    expect(await resources(page)).toEqual(launch);
  }
});

test("an extended solo match past turn 17 keeps its resources and labels", async ({ page }) => {
  test.setTimeout(600_000);
  await startMatch(page, "solo", "Lakewatch");
  const start = await settled(page);
  let attacks = 0;
  let previews = 0;
  const hooks = (turn: number): PlayHooks => ({
    async preview() {
      previews += 1;
      expectOwnedResources(await settled(page), start);
      if (turn >= 15) await expectLabelsVisible(page, ["hp", "combat", "combat-meta"]);
    },
    async attacked() {
      attacks += 1;
      if (turn >= 15) await expectDamagePopup(page);
    }
  });

  // Sun plays the planner's turns through the board; the app's AI plays Moon's.
  for (let turn = 1; ; turn += 2) {
    await playPlannedTurn(page, "easy", hooks(turn));
    expectOwnedResources(await settled(page), start);
    if (turn >= 15) await expectLabelsVisible(page, ["hp"]);
    if (turn >= 23) break;
    await endTurnTo(page, "sun", turn + 2);
    expect((await displayedBoard(page)).winner).toBeNull();
  }

  const end = await settled(page);
  console.log("extended solo", JSON.stringify({ start, end, attacks, previews }));
  expect(attacks, "Sun attacked").toBeGreaterThan(5);
  expect(previews, "attacks were previewed").toBeGreaterThan(3);
});
