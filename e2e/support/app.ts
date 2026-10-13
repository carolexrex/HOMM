import { expect, type Page, type Response } from "@playwright/test";
import { reachableTiles, type Coord, type MatchState, type PlayerId, type TurnAction } from "../../src/engine";
import { centerPan, clamp, projectCell } from "../../src/components/canvas/geometry";
import { MAX_ZOOM, MIN_ZOOM, NATURAL_CELL, VIEWPORT_PADDING, type Layout } from "../../src/components/canvas/types";
import type { OnlineDraft } from "../../src/lib/onlineDraft";
import type { OnlineSession } from "../../src/lib/storage";

/**
 * Drives the rendered app the way a player does: buttons, the invite field, and clicks on the
 * board canvas. localStorage is only read, to learn what the app displays and stored.
 */

export async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Launch A Match" })).toBeVisible();
}

const lobbyRefresh = (page: Page) => page.locator(".online-lobby-panel").getByRole("button", { name: /^(Refresh|Refreshing\.\.\.)$/ });

function isLobbyList(response: Response) {
  return response.url().endsWith("/functions/v1/matches") && (response.request().postDataJSON() as { action?: string } | null)?.action === "list";
}

/**
 * Runs `action`, which makes the lobby load its match list, and waits until the list has
 * loaded. Lobby buttons are disabled while it loads, and a click that lands just as they
 * become disabled is dropped, so tests do not click into that window.
 */
async function settleLobby(page: Page, action: () => Promise<void>) {
  const listed = page.waitForResponse(isLobbyList);
  await action();
  await listed;
  await expect(lobbyRefresh(page)).toHaveText("Refresh");
  await expect(lobbyRefresh(page)).toBeEnabled();
}

/** Opens the online lobby, which loads the player's matches (signing in on first use). */
export async function chooseOnline(page: Page) {
  await settleLobby(page, () => openLobby(page));
}

/** Opens the online lobby without waiting for its match list. */
export async function openLobby(page: Page) {
  await page.getByRole("button", { name: /Async online/ }).click();
  await expect(page.getByText("Online Lobby")).toBeVisible();
}

export const status = (page: Page) => page.locator(".play-online-status");
export const message = (page: Page) => page.locator(".play-message");
export const endTurnButton = (page: Page) => page.locator(".play-actions").getByRole("button", { name: "End Turn" });
export const syncButton = (page: Page) => page.locator(".play-actions").getByRole("button", { name: /^(Refresh|Retry)$/ });
export const turnChip = (page: Page) => page.locator(".play-chip-faction");

/** Creates an online match from the launch screen; returns its ID and invite code. */
export async function createOnlineMatch(page: Page, mapName = "Meadow Line") {
  await chooseOnline(page);
  return createFromLobby(page, mapName);
}

/** Creates an online match from the already open lobby. */
export async function createFromLobby(page: Page, mapName = "Meadow Line") {
  await page.locator(".launch-map-list").getByRole("button", { name: new RegExp(`^${mapName}`) }).click();
  await page.getByRole("button", { name: "Create Online Match" }).click();
  await expect(message(page)).toContainText("Online match created. Invite code:");
  const inviteCode = (await message(page).innerText()).match(/Invite code: ([A-Z0-9]+)/)![1];
  const session = await onlineSession(page);
  expect(session).toMatchObject({ side: "sun", inviteCode });
  await expectPlayable(page);
  return { matchId: session!.matchId, inviteCode };
}

export async function joinOnlineMatch(page: Page, inviteCode: string) {
  await chooseOnline(page);
  await page.getByPlaceholder("Invite code").fill(inviteCode);
  await page.getByRole("button", { name: "Join Match" }).click();
}

export function lobbyCard(page: Page, inviteCode: string) {
  return page.locator(".online-match-card").filter({ hasText: `Code ${inviteCode} /` });
}

export async function refreshLobby(page: Page) {
  await settleLobby(page, () => lobbyRefresh(page).click());
}

export async function resumeFromLobby(page: Page, inviteCode: string) {
  await refreshLobby(page);
  const card = lobbyCard(page, inviteCode);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Resume" }).click();
}

export async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Open match menu" }).click();
  await expect(page.locator(".play-menu")).toBeVisible();
}

/** Leaves the match for the online lobby, which reloads its match list. */
export async function exitMatch(page: Page) {
  await openMenu(page);
  await settleLobby(page, async () => {
    await page.locator(".play-menu").getByRole("button", { name: "Exit Match" }).click();
    await expect(page.getByRole("heading", { name: "Launch A Match" })).toBeVisible();
  });
}

export async function undoTurn(page: Page) {
  await openMenu(page);
  await page.locator(".play-menu").getByRole("button", { name: "Undo Turn" }).click();
}

/** The board the app displays; App.tsx mirrors it into localStorage on every change. */
export async function displayedBoard(page: Page): Promise<MatchState> {
  const raw = await page.evaluate(() => localStorage.getItem("bannerfront.active-match"));
  expect(raw, "the app has an active match").toBeTruthy();
  return JSON.parse(raw!) as MatchState;
}

export async function onlineSession(page: Page): Promise<OnlineSession | null> {
  const raw = await page.evaluate(() => localStorage.getItem("bannerfront.online-session"));
  return raw ? (JSON.parse(raw) as OnlineSession) : null;
}

export async function storedDraft(page: Page, matchId: string, side: PlayerId): Promise<OnlineDraft | null> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), `bannerfront.online-draft:${matchId}:${side}`);
  return raw ? (JSON.parse(raw) as OnlineDraft) : null;
}

/** The signed-in player's Supabase access token, as supabase-js stored it. */
export async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)!;
      if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
        return (JSON.parse(localStorage.getItem(key)!) as { access_token?: string }).access_token ?? null;
      }
    }
    return null;
  });
  expect(token, "an anonymous Supabase session").toBeTruthy();
  return token!;
}

/** Synced with the server, the player's turn, and nothing in progress. */
export async function expectPlayable(page: Page) {
  await expect(page.locator(".play-online-status", { hasText: /Syncing|Sending|pending|Offline/ })).toHaveCount(0);
  await expect(endTurnButton(page)).toBeEnabled();
}

export function unitPositions(state: MatchState) {
  return Object.fromEntries(state.units.map((unit) => [unit.id, { x: unit.x, y: unit.y, hp: unit.hp }]));
}

interface CanvasBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Screen point of a cell's centre, using the canvas's own layout and fit-zoom math. */
async function cellPoint(page: Page, state: MatchState, coord: Coord) {
  const box = await page.evaluate((): CanvasBox => {
    const wrap = document.querySelector<HTMLElement>(".canvas-wrap")!;
    const rect = wrap.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: wrap.clientWidth, height: wrap.clientHeight };
  });
  const cols = state.board[0].length;
  const rows = state.board.length;
  const boardWidth = cols * NATURAL_CELL;
  const boardHeight = rows * NATURAL_CELL;
  const fitZoom = clamp(Math.min((box.width - VIEWPORT_PADDING * 2) / boardWidth, (box.height - VIEWPORT_PADDING * 2) / boardHeight), MIN_ZOOM, MAX_ZOOM);
  const layout: Layout = { cols, rows, width: box.width, height: box.height, boardWidth, boardHeight, fitZoom, step: NATURAL_CELL };
  const cell = projectCell(coord, layout, centerPan(fitZoom, layout), fitZoom);
  return { x: box.left + cell.centerX, y: box.top + cell.centerY };
}

/** Whether a click on the cell reaches the board (no panel or overlay covers it). */
async function tappable(page: Page, state: MatchState, coord: Coord) {
  const point = await cellPoint(page, state, coord);
  return page.evaluate(({ x, y }) => {
    const layer = document.querySelector(".canvas-wrap")?.children[1];
    return Boolean(layer) && document.elementFromPoint(x, y) === layer;
  }, point);
}

export async function tapTile(page: Page, coord: Coord) {
  const state = await displayedBoard(page);
  expect(await tappable(page, state, coord), `cell ${coord.x},${coord.y} is not covered`).toBe(true);
  const point = await cellPoint(page, state, coord);
  await page.mouse.click(point.x, point.y);
}

/**
 * Moves one of the current player's unmoved units to a reachable empty tile by tapping the
 * board, and waits until the draft stores it. Returns the move.
 */
export async function moveSomeUnit(page: Page, skip: string[] = []): Promise<Extract<TurnAction, { type: "move" }>> {
  const state = await displayedBoard(page);
  const session = await onlineSession(page);
  const before = session ? (await storedDraft(page, session.matchId, session.side))?.actions.length ?? 0 : 0;
  const occupied = new Set(state.units.map((unit) => `${unit.x},${unit.y}`));
  const candidates = state.units.filter((unit) => unit.owner === state.currentPlayer && !unit.moved && !skip.includes(unit.id));
  for (const unit of candidates) {
    const destinations = reachableTiles(state, unit.id).filter((tile) => !occupied.has(`${tile.x},${tile.y}`));
    if (!destinations.length || !(await tappable(page, state, unit))) continue;
    await tapTile(page, unit);
    await expect(page.locator(".play-selected")).toBeVisible();
    for (const to of destinations) {
      if (!(await tappable(page, state, to))) continue;
      await tapTile(page, to);
      if (session) {
        await expect.poll(async () => (await storedDraft(page, session.matchId, session.side))?.actions.length ?? 0).toBe(before + 1);
      }
      await expect.poll(async () => (await displayedBoard(page)).units.find((entry) => entry.id === unit.id)).toMatchObject({ x: to.x, y: to.y });
      return { type: "move", unitId: unit.id, to: { x: to.x, y: to.y } };
    }
    await page.locator(".play-actions").getByRole("button", { name: "Clear" }).click();
  }
  throw new Error("No unit could be moved to an uncovered tile.");
}
