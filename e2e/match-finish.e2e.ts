import { expect, test, type Browser, type Page } from "@playwright/test";
import { PLAYER_NAMES, type MatchState, type PlayerId, type TurnAction } from "../src/engine";
import type { TurnSubmission } from "../src/lib/online";
import {
  accessToken,
  displayedBoard,
  endTurnButton,
  exitMatch,
  expectPlayable,
  lobbyCard,
  message,
  playAction,
  resumeFromLobby,
  status,
  storedDraft,
  syncButton,
  tapAction,
  unitPositions
} from "./support/app";
import { closePlayers, expectBoardMatchesServer, startDuel } from "./support/duel";
import { nextPressingAction, wins, type PressingAction } from "./support/finisher";
import { matchRow, playerClient, turnRows } from "./support/server";
import { TurnGate } from "./support/turnGate";

// Online matches played to the end through the rendered app, against the local Supabase stack.
// Both players take every action by tapping the board; the read-only planner in
// support/finisher.ts only chooses which legal action to tap. Nothing sets a winner directly.

test.afterEach(closePlayers);

// Each test plays a whole match (about ten turns of taps).
test.describe.configure({ timeout: 240_000 });

const MAX_TURNS = 30;

interface Brink {
  sun: Page;
  moon: Page;
  matchId: string;
  inviteCode: string;
  /** The player about to win, their opponent, and the victor's side. */
  victor: Page;
  loser: Page;
  side: PlayerId;
  turnNumber: number;
  /** The victor's board before the winning action, and the actions already played this turn. */
  before: MatchState;
  played: TurnAction[];
  winning: PressingAction;
}

/**
 * Plays Meadow Line turn by turn, each player on their own turn, until the next chosen action
 * wins. Every non-winning turn is ended with End Turn and checked against the stored row.
 */
async function playToTheWinningAction(browser: Browser): Promise<Brink> {
  const duel = await startDuel(browser);
  const players: Record<PlayerId, Page> = { sun: duel.sun, moon: duel.moon };
  for (let turns = 0; turns < MAX_TURNS; turns += 1) {
    const server = await matchRow(duel.matchId);
    const side = server.current_player as PlayerId;
    const page = players[side];
    if ((await displayedBoard(page)).turnNumber !== server.turn_number) {
      await syncButton(page).click();
      await expect(message(page)).toHaveText("Refreshed: your turn.");
    }
    await expectPlayable(page);
    await expectBoardMatchesServer(page, duel.matchId);

    const played: TurnAction[] = [];
    for (;;) {
      const board = await displayedBoard(page);
      const action = nextPressingAction(board);
      if (!action) break;
      if (wins(board, action)) {
        const loser = players[side === "sun" ? "moon" : "sun"];
        return { ...duel, victor: page, loser, side, turnNumber: server.turn_number, before: board, played, winning: action };
      }
      await playAction(page, action);
      played.push(action);
    }

    await endTurnButton(page).click();
    await expect(message(page)).toHaveText("Turn accepted. Waiting for opponent.");
    const rows = await turnRows(duel.matchId);
    expect(rows).toHaveLength(server.turn_number);
    expect(rows.at(-1)).toMatchObject({ turn_number: server.turn_number, player_side: side, actions: [...played, { type: "end_turn" }], winner: null });
  }
  throw new Error(`No winning action within ${MAX_TURNS} turns.`);
}

/** The confirmed victory: the panel, the disabled End Turn, no pending status, and the board. */
async function expectVictory(page: Page, side: PlayerId) {
  await expect(status(page)).toHaveCount(0);
  await expect(page.locator(".play-victory h3")).toHaveText(`${PLAYER_NAMES[side]} win`);
  await expect(page.locator(".play-actions").getByRole("button", { name: `${PLAYER_NAMES[side]} won` })).toBeDisabled();
  await expect(endTurnButton(page)).toHaveCount(0);
  expect((await displayedBoard(page)).winner).toBe(side);
}

/** Calls `match-turn` the way the app does, with the player's own session (not the service role). */
async function submitAs(page: Page, body: TurnSubmission) {
  const result = await playerClient(await accessToken(page)).functions.invoke("match-turn", { body });
  if (!result.error) return { status: 200, body: result.data as Record<string, unknown> };
  const response = (result.error as { context?: Response }).context!;
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** The server holds the finished match: the winner, the winning turn, and one winning row. */
async function expectFinishedOnServer(brink: Brink, submissionId: string, actions: TurnAction[]) {
  const finished = await matchRow(brink.matchId);
  expect(finished).toMatchObject({ winner: brink.side, turn_number: brink.turnNumber, current_player: brink.side });
  expect(finished.state.winner).toBe(brink.side);
  expect(finished.state.units.every((unit) => unit.owner === brink.side)).toBe(true);
  const rows = await turnRows(brink.matchId);
  expect(rows).toHaveLength(brink.turnNumber);
  expect(rows.filter((row) => row.winner !== null)).toEqual([
    expect.objectContaining({ turn_number: brink.turnNumber, player_side: brink.side, submission_id: submissionId, actions, winner: brink.side })
  ]);
  expect(rows.filter((row) => row.submission_id === submissionId)).toHaveLength(1);
  return { finished, rows };
}

test("the winning attack commits without End Turn, both players see the victory, and the finished match is final", async ({ browser }) => {
  const brink = await playToTheWinningAction(browser);
  const { victor, loser, side, matchId, inviteCode } = brink;
  const winner = PLAYER_NAMES[side];

  // The winning tap sends the turn by itself; the barrier holds it on the way to the server.
  const gate = await TurnGate.install(victor);
  await tapAction(victor, brink.winning);
  const held = await gate.next();
  const actions = [...brink.played, brink.winning];
  expect(held.body).toMatchObject({ matchId, expectedTurnNumber: brink.turnNumber, actions });
  expect(actions.some((action) => action.type === "end_turn")).toBe(false);
  await expect(status(victor)).toHaveText("Sending turn...");
  expect(await storedDraft(victor, matchId, side)).toMatchObject({ status: "submitting", submissionId: held.body.submissionId, actions });
  // Not confirmed yet: the board stays as it was before the attack, and nothing is committed.
  expect(unitPositions(await displayedBoard(victor))).toEqual(unitPositions(brink.before));
  expect((await displayedBoard(victor)).winner).toBeNull();
  expect(await turnRows(matchId)).toHaveLength(brink.turnNumber - 1);

  expect(await held.release()).toEqual({ status: 200, code: "accepted" });
  await expect(message(victor)).toHaveText(`Turn accepted. ${winner} won.`);
  await expectVictory(victor, side);
  expect(await storedDraft(victor, matchId, side)).toBeNull();
  expect(gate.sent).toHaveLength(1);
  const { finished, rows } = await expectFinishedOnServer(brink, held.body.submissionId, actions);
  await expectBoardMatchesServer(victor, matchId);

  // Both players see the confirmed victory after refreshing.
  for (const page of [loser, victor]) {
    await syncButton(page).click();
    await expect(message(page)).toHaveText(`Refreshed: ${winner} won.`);
    await expectVictory(page, side);
    await expectBoardMatchesServer(page, matchId);
  }

  // A reload keeps the finished match, and so does resuming it from the lobby.
  for (const page of [victor, loser]) {
    await page.reload();
    await expectVictory(page, side);
    await expectBoardMatchesServer(page, matchId);
  }
  await exitMatch(loser);
  await expect(lobbyCard(loser, inviteCode)).toContainText(`Winner: ${side}`);
  await resumeFromLobby(loser, inviteCode);
  await expectVictory(loser, side);
  await expectBoardMatchesServer(loser, matchId);

  // Retrying the winning submission is a duplicate; it adds no row.
  const retry = await submitAs(victor, held.body);
  expect(retry).toMatchObject({ status: 200, body: { code: "duplicate", winner: side, turnNumber: brink.turnNumber } });
  expect(retry.body.state).toEqual(finished.state);

  // Further submissions are refused, from either player, and so are direct writes.
  const another = (expectedTurnNumber: number): TurnSubmission => ({
    matchId,
    submissionId: crypto.randomUUID(),
    expectedTurnNumber,
    actions: [{ type: "end_turn" }]
  });
  for (const [page, body] of [
    [victor, another(brink.turnNumber)],
    [loser, another(brink.turnNumber)],
    [loser, another(brink.turnNumber + 1)]
  ] as const) {
    const refused = await submitAs(page, body);
    expect(refused).toMatchObject({ status: 409, body: { code: "finished" } });
    expect(refused.body.state).toEqual(finished.state);
  }
  // The loser cannot claim the winner's submission ID.
  expect(await submitAs(loser, held.body)).toMatchObject({ status: 409, body: { code: "submission_conflict" } });
  const loserClient = playerClient(await accessToken(loser));
  const overwrite = await loserClient.from("matches").update({ winner: side === "sun" ? "moon" : "sun" }).eq("id", matchId).select();
  expect(overwrite.error?.code).toBe("42501");
  const insert = await loserClient.from("turns").insert({ match_id: matchId, turn_number: brink.turnNumber + 1, player_side: side === "sun" ? "moon" : "sun", actions: [], resulting_state: {} });
  expect(insert.error?.code).toBe("42501");

  expect(await matchRow(matchId)).toEqual(finished);
  expect(await turnRows(matchId)).toEqual(rows);
  for (const page of [victor, loser]) {
    await syncButton(page).click();
    await expect(message(page)).toHaveText(`Refreshed: ${winner} won.`);
    await expectVictory(page, side);
  }
});

test("a winning submission whose response is lost is retried with the same ID and stored once", async ({ browser }) => {
  const brink = await playToTheWinningAction(browser);
  const { victor, loser, side, matchId } = brink;
  const winner = PLAYER_NAMES[side];
  const actions = [...brink.played, brink.winning];

  const gate = await TurnGate.install(victor);
  await tapAction(victor, brink.winning);
  const first = await gate.next();
  expect(await first.commitAndLoseResponse()).toEqual({ status: 200, code: "accepted" });

  // The server has the win; the victor only knows the request failed.
  await expect(status(victor)).toHaveText("Turn pending, not confirmed");
  await expect(syncButton(victor)).toHaveText("Retry");
  expect(unitPositions(await displayedBoard(victor))).toEqual(unitPositions(brink.before));
  expect(await storedDraft(victor, matchId, side)).toMatchObject({ status: "submitting", submissionId: first.body.submissionId, actions });
  await expectFinishedOnServer(brink, first.body.submissionId, actions);

  // The opponent already sees the win.
  await syncButton(loser).click();
  await expect(message(loser)).toHaveText(`Refreshed: ${winner} won.`);
  await expectVictory(loser, side);

  // A reload keeps the pending win, and Retry resends it with the same ID.
  await victor.reload();
  const resent = await gate.next();
  expect(resent.body).toEqual(first.body);
  expect(await resent.commitAndLoseResponse()).toEqual({ status: 200, code: "duplicate" });
  await expect(status(victor)).toHaveText("Turn pending, not confirmed");
  await expect(syncButton(victor)).toHaveText("Retry");

  await syncButton(victor).click();
  const retry = await gate.next();
  expect(retry.body).toEqual(first.body);
  expect(await retry.release()).toEqual({ status: 200, code: "duplicate" });
  await expect(message(victor)).toHaveText(`Turn accepted (it had already been saved before the connection dropped). ${winner} won.`);
  await expectVictory(victor, side);
  expect(await storedDraft(victor, matchId, side)).toBeNull();
  expect(gate.sent.map((body) => body.submissionId)).toEqual(Array(3).fill(first.body.submissionId));
  await expectFinishedOnServer(brink, first.body.submissionId, actions);
  await expectBoardMatchesServer(victor, matchId);

  await victor.reload();
  await expectVictory(victor, side);
  expect(gate.sent).toHaveLength(3);
});
