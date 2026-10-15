import { expect, test, type Page } from "@playwright/test";
import { PLAYER_NAMES } from "../src/engine";
import {
  accessToken,
  createFromLobby,
  createOnlineMatch,
  displayedBoard,
  endTurnButton,
  exitMatch,
  expectPlayable,
  joinOnlineMatch,
  lobbyCard,
  message,
  moveSomeUnit,
  onlineSession,
  openLobby,
  openMenu,
  refreshLobby,
  openApp,
  resumeFromLobby,
  status,
  storedDraft,
  syncButton,
  tapTile,
  turnChip,
  undoTurn,
  unitPositions
} from "./support/app";
import { closePlayers, expectBoardMatchesServer, newPlayer, startDuel } from "./support/duel";
import { matchRow, playerClient, turnRows } from "./support/server";
import { TurnGate } from "./support/turnGate";

// Two-player online flows through the rendered app, against the local Supabase stack: real
// anonymous auth, the deployed-shape Edge Functions, and the database's RLS policies. Players and
// tabs: e2e/support/duel.ts.

test.afterEach(closePlayers);

test("create, invite, join, list, resume, and both players submit turns", async ({ browser }) => {
  const { sun, moon, matchId, inviteCode } = await startDuel(browser);
  await expect(turnChip(sun)).toContainText(`${PLAYER_NAMES.sun} to act`);
  await expect(turnChip(sun)).toContainText("Turn 1");

  // Moon is seated but cannot act on Sun's turn.
  await endTurnButton(moon).click();
  await expect(message(moon)).toHaveText("It is not your turn.");

  // The lobby lists the match for Moon, who leaves and later resumes it.
  await exitMatch(moon);
  await expect(lobbyCard(moon, inviteCode)).toContainText("side moon / turn 1");
  await expect(lobbyCard(moon, inviteCode)).toContainText("Waiting for opponent");

  // Sun moves and ends the turn.
  const sunMove = await moveSomeUnit(sun);
  await expect(status(sun)).toHaveText("1 unsent move(s), sent at End Turn");
  await endTurnButton(sun).click();
  await expect(message(sun)).toHaveText("Turn accepted. Waiting for opponent.");
  await expect(status(sun)).toHaveCount(0);
  expect(await storedDraft(sun, matchId, "sun")).toBeNull();
  let rows = await turnRows(matchId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ player_side: "sun", actions: [sunMove, { type: "end_turn" }] });
  expect(rows[0].submission_id).toMatch(/^[0-9a-f-]{36}$/);

  // Moon resumes from the lobby on its turn and sees Sun's move.
  await resumeFromLobby(moon, inviteCode);
  await expectPlayable(moon);
  await expect(turnChip(moon)).toContainText(`${PLAYER_NAMES.moon} to act`);
  await expectBoardMatchesServer(moon, matchId);
  expect((await displayedBoard(moon)).units.find((unit) => unit.id === sunMove.unitId)).toMatchObject({ ...sunMove.to });

  const moonMove = await moveSomeUnit(moon);
  await endTurnButton(moon).click();
  await expect(message(moon)).toHaveText("Turn accepted. Waiting for opponent.");
  rows = await turnRows(matchId);
  expect(rows.map((row) => row.player_side)).toEqual(["sun", "moon"]);
  expect(rows[1].actions).toEqual([moonMove, { type: "end_turn" }]);

  // Sun refreshes into its next turn with Moon's move on the board.
  await syncButton(sun).click();
  await expect(message(sun)).toHaveText("Refreshed: your turn.");
  await expectPlayable(sun);
  const server = await expectBoardMatchesServer(sun, matchId);
  expect(server).toMatchObject({ turn_number: 3, current_player: "sun" });
  expect((await displayedBoard(sun)).units.find((unit) => unit.id === moonMove.unitId)).toMatchObject({ ...moonMove.to });
});

test("reload restores unsent moves, and Undo Turn restores the canonical board", async ({ browser }) => {
  const { sun, matchId } = await startDuel(browser);
  const canonical = unitPositions((await matchRow(matchId)).state);

  const first = await moveSomeUnit(sun);
  const second = await moveSomeUnit(sun, [first.unitId]);
  await expect(status(sun)).toHaveText("2 unsent move(s), sent at End Turn");
  const planned = unitPositions(await displayedBoard(sun));

  await sun.reload();
  await expectPlayable(sun);
  await expect(status(sun)).toHaveText("2 unsent move(s), sent at End Turn");
  await expect.poll(async () => unitPositions(await displayedBoard(sun))).toEqual(planned);
  expect((await storedDraft(sun, matchId, "sun"))?.actions).toEqual([first, second]);
  expect(await turnRows(matchId)).toHaveLength(0);

  await undoTurn(sun);
  await expect(message(sun)).toHaveText("Discarded your unsent moves for this turn.");
  await expect(status(sun)).toHaveCount(0);
  await expect.poll(async () => unitPositions(await displayedBoard(sun))).toEqual(canonical);
  expect(await storedDraft(sun, matchId, "sun")).toBeNull();

  // Nothing comes back after another reload, and the match is still playable.
  await sun.reload();
  await expectPlayable(sun);
  await expect(status(sun)).toHaveCount(0);
  await expect.poll(async () => unitPositions(await displayedBoard(sun))).toEqual(canonical);
  await moveSomeUnit(sun);
});

test("a response lost after the server committed is retried with the same ID and stored once", async ({ browser }) => {
  const { sun, moon, matchId } = await startDuel(browser);
  const move = await moveSomeUnit(sun);
  const gate = await TurnGate.install(sun);

  await endTurnButton(sun).click();
  const first = await gate.next();
  expect(await first.commitAndLoseResponse()).toEqual({ status: 200, code: "accepted" });

  // The server has the turn, but the player only knows the request failed.
  await expect(status(sun)).toHaveText("Turn pending, not confirmed");
  await expect(message(sun)).toContainText("Turn pending:");
  await expect(syncButton(sun)).toHaveText("Retry");
  const frozen = await storedDraft(sun, matchId, "sun");
  expect(frozen).toMatchObject({ status: "submitting", submissionId: first.body.submissionId });
  expect(await turnRows(matchId)).toHaveLength(1);

  await syncButton(sun).click();
  const retry = await gate.next();
  expect(retry.body).toEqual(first.body);
  expect(await retry.release()).toEqual({ status: 200, code: "duplicate" });

  await expect(message(sun)).toHaveText("Turn accepted (it had already been saved before the connection dropped). Waiting for opponent.");
  await expect(status(sun)).toHaveCount(0);
  await expect(syncButton(sun)).toHaveText("Refresh");
  expect(await storedDraft(sun, matchId, "sun")).toBeNull();
  expect(gate.sent.map((body) => body.submissionId)).toEqual([first.body.submissionId, first.body.submissionId]);
  const rows = await turnRows(matchId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ submission_id: first.body.submissionId, player_side: "sun", actions: [move, { type: "end_turn" }] });

  // The opponent gets exactly that one turn.
  await syncButton(moon).click();
  await expect(message(moon)).toHaveText("Refreshed: your turn.");
  await expectBoardMatchesServer(moon, matchId);
});

test("tabs of one profile preserve a frozen submission and recover it after the sending tab closes", async ({ browser }) => {
  const { sun: tab1, matchId } = await startDuel(browser);
  const tab2 = await tab1.context().newPage();
  await tab2.goto("/");
  await expectPlayable(tab2);
  expect((await onlineSession(tab2))?.matchId).toBe(matchId);

  // A move in one tab shows up in the other through the shared draft.
  const move = await moveSomeUnit(tab1);
  await expect(status(tab2)).toHaveText("1 unsent move(s), sent at End Turn");
  await expect(message(tab2)).toHaveText("Updated with moves made in another tab.");
  await expect.poll(async () => (await displayedBoard(tab2)).units.find((unit) => unit.id === move.unitId)).toMatchObject({ ...move.to });

  // Tab 1 ends the turn. The server commits it, but tab 1 never hears back.
  const gate1 = await TurnGate.install(tab1);
  await endTurnButton(tab1).click();
  const sent = await gate1.next();
  const frozen = await storedDraft(tab2, matchId, "sun");
  expect(frozen).toMatchObject({ status: "submitting", submissionId: sent.body.submissionId });
  expect(await sent.commitAndHold()).toEqual({ status: 200, code: "accepted" });

  // Tab 2 follows the frozen turn and refuses to change it.
  await expect(status(tab2)).toHaveText("Turn pending, not confirmed");
  await expect(syncButton(tab2)).toHaveText("Retry");
  const pendingBoard = unitPositions(await displayedBoard(tab2));
  const other = (await displayedBoard(tab2)).units.find((unit) => unit.owner === "sun" && unit.id !== move.unitId)!;
  await tapTile(tab2, other);
  await expect(message(tab2)).toHaveText("Your turn is pending. Tap Retry to confirm it with the server.");
  expect(unitPositions(await displayedBoard(tab2))).toEqual(pendingBoard);
  expect(await storedDraft(tab2, matchId, "sun")).toEqual(frozen);

  // Close the sending tab with its request unanswered, then reload the survivor.
  await tab1.unrouteAll({ behavior: "ignoreErrors" });
  await tab1.close();
  const gate2 = await TurnGate.install(tab2);
  await tab2.reload();
  const resent = await gate2.next();
  expect(resent.body).toEqual(sent.body);
  await expect(status(tab2)).toHaveText("Sending turn...");
  expect(await resent.commitAndLoseResponse()).toEqual({ status: 200, code: "duplicate" });
  await expect(status(tab2)).toHaveText("Turn pending, not confirmed");
  await expect(syncButton(tab2)).toHaveText("Retry");
  expect(await storedDraft(tab2, matchId, "sun")).toEqual(frozen);

  // Retry finishes it with the same submission ID.
  await syncButton(tab2).click();
  const retry = await gate2.next();
  expect(retry.body).toEqual(sent.body);
  expect(await retry.release()).toEqual({ status: 200, code: "duplicate" });
  await expect(message(tab2)).toHaveText("Turn accepted (it had already been saved before the connection dropped). Waiting for opponent.");
  expect(await storedDraft(tab2, matchId, "sun")).toBeNull();
  const rows = await turnRows(matchId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ submission_id: sent.body.submissionId, actions: [move, { type: "end_turn" }] });
});

test("switching matches while a submission is on the network keeps the newly opened board", async ({ browser }) => {
  const sun = await newPlayer(browser);
  await openApp(sun);
  const ashen = await createOnlineMatch(sun, "Ashen Ford");
  await exitMatch(sun);
  const meadow = await createFromLobby(sun, "Meadow Line");

  await moveSomeUnit(sun);
  const gate = await TurnGate.install(sun);
  await endTurnButton(sun).click();
  const held = await gate.next();
  await expect(status(sun)).toHaveText("Sending turn...");

  // Leave mid-request and open the other match, then play a move there.
  await exitMatch(sun);
  await resumeFromLobby(sun, ashen.inviteCode);
  await expectPlayable(sun);
  expect((await onlineSession(sun))?.matchId).toBe(ashen.matchId);
  const ashenMove = await moveSomeUnit(sun);
  const ashenBoard = await displayedBoard(sun);
  const ashenDraft = await storedDraft(sun, ashen.matchId, "sun");
  const shownMessage = await message(sun).count() ? await message(sun).innerText() : null;
  expect(ashenBoard.mapId).toBe("ashen-ford");

  // The Meadow Line answer arrives now. It settles that match's draft and nothing else.
  expect(await held.release()).toEqual({ status: 200, code: "accepted" });
  await expect.poll(() => storedDraft(sun, meadow.matchId, "sun")).toBeNull();

  expect(await displayedBoard(sun)).toEqual(ashenBoard);
  expect((await onlineSession(sun))?.matchId).toBe(ashen.matchId);
  expect(await storedDraft(sun, ashen.matchId, "sun")).toEqual(ashenDraft);
  await expect(status(sun)).toHaveText("1 unsent move(s), sent at End Turn");
  if (shownMessage === null) await expect(message(sun)).toHaveCount(0);
  else await expect(message(sun)).toHaveText(shownMessage);
  await expectPlayable(sun);
  await moveSomeUnit(sun, [ashenMove.unitId]);

  expect(await turnRows(meadow.matchId)).toHaveLength(1);
  expect(await turnRows(ashen.matchId)).toHaveLength(0);
  expect(gate.sent).toHaveLength(1);

  // Reopening Meadow Line shows the accepted turn.
  await exitMatch(sun);
  await resumeFromLobby(sun, meadow.inviteCode);
  await expect(turnChip(sun)).toContainText("Turn 2");
  await expectBoardMatchesServer(sun, meadow.matchId);
});

test("reopening the same match while its submission is on the network confirms it once", async ({ browser }) => {
  const sun = await newPlayer(browser);
  await openApp(sun);
  const meadow = await createOnlineMatch(sun);
  await moveSomeUnit(sun);
  const gate = await TurnGate.install(sun);
  await endTurnButton(sun).click();
  const held = await gate.next();

  await exitMatch(sun);
  await resumeFromLobby(sun, meadow.inviteCode);
  await expect(status(sun)).toHaveText("Sending turn...");
  expect(await held.release()).toEqual({ status: 200, code: "accepted" });

  await expect(message(sun)).toHaveText("Turn accepted. Waiting for opponent.");
  await expect(turnChip(sun)).toContainText("Turn 2");
  await expectBoardMatchesServer(sun, meadow.matchId);
  expect(gate.sent).toHaveLength(1);
  expect(await turnRows(meadow.matchId)).toHaveLength(1);
});

test("a lobby list that answers after a match was created does not erase its invite code", async ({ browser }) => {
  const sun = await newPlayer(browser);
  await openApp(sun);
  // Hold the lobby list that opening the online lobby requests.
  let releaseList!: () => void;
  const listReleased = new Promise<void>((resolve) => { releaseList = resolve; });
  let listHeld!: () => void;
  const listArrived = new Promise<void>((resolve) => { listHeld = resolve; });
  await sun.route("**/functions/v1/matches", async (route) => {
    if (route.request().method() === "POST" && (route.request().postDataJSON() as { action?: string }).action === "list") {
      listHeld();
      await listReleased;
    }
    await route.continue();
  });

  const listResponse = sun.waitForResponse((response) => response.url().endsWith("/functions/v1/matches") && response.request().postDataJSON()?.action === "list");
  await openLobby(sun);
  await listArrived;
  const { inviteCode } = await createFromLobby(sun);
  await expect(message(sun)).toHaveText(`Online match created. Invite code: ${inviteCode}`);

  releaseList();
  await (await listResponse).finished();
  // A rendered interaction after the answer is processed: any update it caused is on screen now.
  await openMenu(sun);
  await expect(message(sun)).toHaveText(`Online match created. Invite code: ${inviteCode}`);
});

test("Create during the lobby's first sign-in waits for it, so the new match belongs to the player", async ({ browser }) => {
  const sun = await newPlayer(browser);
  await openApp(sun);
  const signUps: Array<() => void> = [];
  await sun.route("**/auth/v1/signup", async (route) => {
    await new Promise<void>((release) => signUps.push(release));
    await route.continue();
  });

  // Opening the lobby signs in (it loads the match list); hold that sign-in and tap Create.
  await openLobby(sun);
  await expect.poll(() => signUps.length).toBe(1);
  await sun.getByRole("button", { name: "Create Online Match" }).click();

  // Create must wait for the sign-in in progress (src/lib/online.ts SIGN_IN_LOCK), not start a second one.
  const progress = async () => signUps.length > 1
    ? "started a second sign-up"
    : (await sun.evaluate(async () => Boolean((await navigator.locks.query()).pending?.some((lock) => lock.name === "bannerfront.sign-in"))))
      ? "waiting for the first sign-in"
      : "not there yet";
  await expect.poll(progress).not.toBe("not there yet");
  expect(await progress()).toBe("waiting for the first sign-in");
  signUps[0]();

  await expect(message(sun)).toContainText("Online match created. Invite code:");
  expect(signUps).toHaveLength(1);
  const session = await onlineSession(sun);
  const seats = await playerClient(await accessToken(sun)).from("match_players").select("side").eq("match_id", session!.matchId);
  expect(seats.data).toEqual([{ side: "sun" }]);
  await syncButton(sun).click();
  await expect(message(sun)).toHaveText("Refreshed: your turn.");
  await moveSomeUnit(sun);
});

test("leaving an online match after a reload returns to the online lobby", async ({ browser }) => {
  const { moon, inviteCode } = await startDuel(browser);
  await moon.reload();
  await expect(syncButton(moon)).toBeEnabled();
  await expect(status(moon)).toHaveCount(0);

  await openMenu(moon);
  await moon.locator(".play-menu").getByRole("button", { name: "Exit Match" }).click();
  await expect(moon.getByText("Online Lobby")).toBeVisible();
  await expect(lobbyCard(moon, inviteCode)).toContainText("side moon / turn 1");
});

test("a third player cannot see, join, read, or play another player's match", async ({ browser }) => {
  const { sun, matchId, inviteCode } = await startDuel(browser);
  const stranger = await newPlayer(browser);
  await openApp(stranger);

  // The UI offers nothing: no listed match, and the invite is full.
  await joinOnlineMatch(stranger, inviteCode);
  await expect(stranger.locator(".footer-note.danger")).toHaveText("Match is already full.");
  await refreshLobby(stranger);
  await expect(stranger.locator(".online-match-list")).toContainText("Create a match or join one with an invite code.");
  await expect(stranger.locator(".online-match-card")).toHaveCount(0);

  // Direct calls with the stranger's own session are refused by the functions and by RLS.
  const client = playerClient(await accessToken(stranger));
  const get = await client.functions.invoke("matches", { body: { action: "get", matchId } });
  expect((get.error as { context?: Response } | null)?.context?.status).toBe(403);
  const submit = await client.functions.invoke("match-turn", {
    body: { matchId, submissionId: crypto.randomUUID(), expectedTurnNumber: 1, actions: [{ type: "end_turn" }] }
  });
  const submitResponse = (submit.error as { context?: Response } | null)?.context;
  expect(submitResponse?.status).toBe(403);
  expect(await submitResponse?.json()).toMatchObject({ code: "forbidden" });

  for (const table of ["matches", "match_players", "turns"]) {
    const read = await client.from(table).select("*").eq(table === "matches" ? "id" : "match_id", matchId);
    expect({ table, error: read.error, rows: read.data }).toEqual({ table, error: null, rows: [] });
  }
  const insert = await client.from("turns").insert({ match_id: matchId, turn_number: 1, player_side: "moon", actions: [], resulting_state: {} });
  expect(insert.error?.code).toBe("42501");
  const update = await client.from("matches").update({ winner: "moon" }).eq("id", matchId).select();
  expect(update.error?.code).toBe("42501");
  const commit = await client.rpc("commit_match_turn_v2", {
    p_match_id: matchId,
    p_user_id: (await client.auth.getUser()).data.user?.id,
    p_submission_id: crypto.randomUUID(),
    p_expected_turn_number: 1,
    p_actions: [],
    p_resulting_state: {},
    p_next_current_player: "moon",
    p_next_turn_number: 2,
    p_winner: "moon"
  });
  expect(commit.error?.code).toBe("42501");

  // The seated player can read the same rows, so the empty results above are the policy at work.
  const owner = playerClient(await accessToken(sun));
  const own = await owner.from("matches").select("id").eq("id", matchId);
  expect(own.data).toEqual([{ id: matchId }]);

  expect(await turnRows(matchId)).toHaveLength(0);
  expect(await matchRow(matchId)).toMatchObject({ turn_number: 1, current_player: "sun", winner: null });
  await expectPlayable(sun);
});
