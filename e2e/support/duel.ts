import { expect, type Browser, type Page } from "@playwright/test";
import { createOnlineMatch, displayedBoard, joinOnlineMatch, message, openApp, unitPositions } from "./app";
import { matchRow } from "./server";

// Each browser context is an independent player (own localStorage, own Supabase session); pages
// in one context are tabs of the same profile, sharing localStorage and Web Locks.

const pages: Page[] = [];

export async function newPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  pages.push(page);
  return page;
}

/** Closes every player opened by the test; register it with `test.afterEach`. */
export async function closePlayers() {
  for (const page of pages.splice(0)) await page.context().close();
}

/** Sun creates a match and Moon joins it; both end on the board. */
export async function startDuel(browser: Browser, mapName?: string) {
  const sun = await newPlayer(browser);
  const moon = await newPlayer(browser);
  await openApp(sun);
  const match = await createOnlineMatch(sun, mapName);
  await openApp(moon);
  await joinOnlineMatch(moon, match.inviteCode);
  await expect(message(moon)).toHaveText(`Joined match ${match.inviteCode} as moon.`);
  return { sun, moon, ...match };
}

export async function expectBoardMatchesServer(page: Page, matchId: string) {
  const server = await matchRow(matchId);
  await expect.poll(async () => {
    const board = await displayedBoard(page);
    return { turn: board.turnNumber, player: board.currentPlayer, winner: board.winner, units: unitPositions(board) };
  }).toEqual({ turn: server.turn_number, player: server.current_player, winner: server.winner, units: unitPositions(server.state) });
  return server;
}
