import { createMatch, type MatchState, type TurnAction } from "../src/engine";
import { handleTurnSubmission } from "../supabase/functions/match-turn/handler";
import { describe, expect, it } from "vitest";
import { MemoryTurnStore } from "./support/memoryTurnStore";

// Edge Function handler tests against an in-memory store. SQL locking and constraints are
// verified separately by tests/db (npm run test:db).

const SUN = "00000000-0000-4000-8000-000000000001";
const MOON = "00000000-0000-4000-8000-000000000002";
const STRANGER = "00000000-0000-4000-8000-000000000003";
const END: TurnAction[] = [{ type: "end_turn" }];

function setup() {
  const match = createMatch("meadow-line", "online");
  const store = new MemoryTurnStore(match, { [SUN]: "sun", [MOON]: "moon" });
  return { match, store };
}

function body(matchId: string, expectedTurnNumber: number, actions: TurnAction[] = END, submissionId: string = crypto.randomUUID()) {
  return { matchId, submissionId, expectedTurnNumber, actions };
}

function winningSetup() {
  const match = createMatch("meadow-line", "online");
  const attacker = match.units.find((unit) => unit.owner === "sun" && unit.kind === "swordsman")!;
  const defender = match.units.find((unit) => unit.owner === "moon" && unit.kind === "militia")!;
  attacker.x = 3;
  attacker.y = 3;
  defender.x = 4;
  defender.y = 3;
  defender.hp = 1;
  match.units = [attacker, defender];
  const store = new MemoryTurnStore(match, { [SUN]: "sun", [MOON]: "moon" });
  const attack: TurnAction[] = [{ type: "attack", attackerId: attacker.id, targetId: defender.id }];
  return { match, store, attack };
}

describe("match-turn handler: versioning", () => {
  it("rejects an old turn-one end_turn that arrives on turn three", async () => {
    const { match, store } = setup();
    const stale = body(match.id, 1);

    expect((await handleTurnSubmission(body(match.id, 1), SUN, store)).status).toBe(200);
    expect((await handleTurnSubmission(body(match.id, 2), MOON, store)).status).toBe(200);
    expect(store.match.turnNumber).toBe(3);
    expect(store.match.currentPlayer).toBe("sun");

    const result = await handleTurnSubmission(stale, SUN, store);

    expect(result.status).toBe(409);
    expect(result.body.code).toBe("stale");
    expect((result.body.state as MatchState).turnNumber).toBe(3);
    expect(store.match.turnNumber).toBe(3);
    expect(store.turns).toHaveLength(2);
  });

  it("rejects a request whose version check passes early but loses the race to commit", async () => {
    const { match, store } = setup();
    // Another device commits sun's turn while this request is between read and commit.
    store.beforeCommitCheck = async () => {
      store.beforeCommitCheck = null;
      store.match = { ...store.match, turnNumber: 2, currentPlayer: "moon" };
    };

    const result = await handleTurnSubmission(body(match.id, 1), SUN, store);

    expect(result.status).toBe(409);
    expect(result.body.code).toBe("stale");
    expect(store.turns).toHaveLength(0);
  });

  it("requires a UUID submission ID and an expected turn number", async () => {
    const { match, store } = setup();

    const missingId = await handleTurnSubmission({ matchId: match.id, expectedTurnNumber: 1, actions: END }, SUN, store);
    const missingVersion = await handleTurnSubmission({ matchId: match.id, submissionId: crypto.randomUUID(), actions: END }, SUN, store);

    expect(missingId.status).toBe(400);
    expect(missingVersion.status).toBe(400);
    expect(store.commitCalls).toBe(0);
  });
});

describe("match-turn handler: idempotency", () => {
  it("does not advance the game again when an accepted submission is retried", async () => {
    const { match, store } = setup();
    const request = body(match.id, 1);

    const first = await handleTurnSubmission(request, SUN, store);
    const retry = await handleTurnSubmission(request, SUN, store);

    expect(first.body.code).toBe("accepted");
    expect(retry.status).toBe(200);
    expect(retry.body.code).toBe("duplicate");
    expect(store.turns).toHaveLength(1);
    expect(store.match.turnNumber).toBe(2);
  });

  it("deduplicates concurrent identical submissions to one commit", async () => {
    const { match, store } = setup();
    const request = body(match.id, 1);

    const results = await Promise.all([
      handleTurnSubmission(request, SUN, store),
      handleTurnSubmission(request, SUN, store),
      handleTurnSubmission(request, SUN, store)
    ]);

    expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
    expect(results.map((result) => result.body.code).sort()).toEqual(["accepted", "duplicate", "duplicate"]);
    expect(store.turns).toHaveLength(1);
    expect(store.match.turnNumber).toBe(2);
  });

  it("accepts only one of two concurrent different submissions for the same version", async () => {
    const { match, store } = setup();

    const results = await Promise.all([
      handleTurnSubmission(body(match.id, 1), SUN, store),
      handleTurnSubmission(body(match.id, 1), SUN, store)
    ]);

    expect(results.map((result) => result.body.code).sort()).toEqual(["accepted", "stale"]);
    expect(store.turns).toHaveLength(1);
    expect(store.match.turnNumber).toBe(2);
  });

  it("confirms a commit whose response was lost, returning the newer canonical state", async () => {
    const { match, store } = setup();
    const request = body(match.id, 1);

    await handleTurnSubmission(request, SUN, store); // response lost in transit
    await handleTurnSubmission(body(match.id, 2), MOON, store); // opponent plays on
    const retry = await handleTurnSubmission(request, SUN, store);

    expect(retry.status).toBe(200);
    expect(retry.body.code).toBe("duplicate");
    // Never the stored turn-1 resulting state, which would roll the client back.
    expect(retry.body.turnNumber).toBe(3);
    expect((retry.body.state as MatchState).turnNumber).toBe(3);
    expect(store.turns).toHaveLength(2);
  });

  it("rejects reuse of a submission ID with different content", async () => {
    const { match, store } = setup();
    const unit = match.units.find((entry) => entry.owner === "sun")!;
    const submissionId = crypto.randomUUID();

    await handleTurnSubmission(body(match.id, 1, END, submissionId), SUN, store);
    const changedActions = await handleTurnSubmission(
      body(match.id, 1, [{ type: "move", unitId: unit.id, to: { x: unit.x, y: unit.y } }, { type: "end_turn" }], submissionId),
      SUN,
      store
    );
    const changedVersion = await handleTurnSubmission(body(match.id, 3, END, submissionId), SUN, store);

    expect(changedActions.status).toBe(409);
    expect(changedActions.body.code).toBe("submission_conflict");
    expect(changedVersion.body.code).toBe("submission_conflict");
    expect(store.turns).toHaveLength(1);
  });

  it("scopes deduplication to the submitting player", async () => {
    const { match, store } = setup();
    const submissionId = crypto.randomUUID();
    await handleTurnSubmission(body(match.id, 1, END, submissionId), SUN, store);

    // The opponent can read turn rows, but replaying sun's ID must not count as their turn.
    const hijack = await handleTurnSubmission(body(match.id, 1, END, submissionId), MOON, store);

    expect(hijack.status).toBe(409);
    expect(hijack.body.code).toBe("submission_conflict");
    expect(store.match.currentPlayer).toBe("moon");
    expect(store.turns).toHaveLength(1);
  });
});

type StoreOperation = "getSeat" | "getMatch" | "findSubmission" | "commitTurn";

/**
 * Runs `first`, and when it reaches `operation` runs `second` to completion before letting
 * `first` continue. This reproduces a specific interleaving without timers or sleeps.
 */
async function interleave<T>(store: MemoryTurnStore, operation: StoreOperation, first: () => Promise<T>, second: () => Promise<T>) {
  let secondResult: T | undefined;
  store.beforeOperation = async (current) => {
    if (current !== operation) return;
    store.beforeOperation = null;
    secondResult = await second();
  };
  const firstResult = await first();
  expect(secondResult, `second request did not run at ${operation}`).toBeDefined();
  return { first: firstResult, second: secondResult! };
}

const OPERATIONS: StoreOperation[] = ["getSeat", "getMatch", "findSubmission", "commitTurn"];

describe("match-turn handler: concurrent identical requests", () => {
  it.each(OPERATIONS)("reports an identical request as a duplicate when its twin commits before %s", async (operation) => {
    const { match, store } = setup();
    const request = body(match.id, 1);

    const { first, second } = await interleave(
      store,
      operation,
      () => handleTurnSubmission(request, SUN, store),
      () => handleTurnSubmission(request, SUN, store)
    );

    expect(second.body.code).toBe("accepted");
    expect(first.status).toBe(200);
    expect(first.body.code).toBe("duplicate");
    expect((first.body.state as MatchState).turnNumber).toBe(2);
    expect(store.turns).toHaveLength(1);
  });

  it.each(OPERATIONS)("still conflicts on the same ID with different content when the twin commits before %s", async (operation) => {
    const { match, store } = setup();
    const unit = match.units.find((entry) => entry.owner === "sun")!;
    const submissionId = crypto.randomUUID();
    const changed: TurnAction[] = [{ type: "move", unitId: unit.id, to: { x: unit.x, y: unit.y } }, { type: "end_turn" }];

    const { first } = await interleave(
      store,
      operation,
      () => handleTurnSubmission(body(match.id, 1, changed, submissionId), SUN, store),
      () => handleTurnSubmission(body(match.id, 1, END, submissionId), SUN, store)
    );

    // The moved-in-place request is refused either by the engine or by the ID check; it never commits.
    expect(first.status).not.toBe(200);
    expect(store.turns).toHaveLength(1);
    expect(store.turns[0].actions).toEqual(END);
  });

  it.each(OPERATIONS)("still reports a different submission as stale when the other commits before %s", async (operation) => {
    const { match, store } = setup();

    const { first } = await interleave(
      store,
      operation,
      () => handleTurnSubmission(body(match.id, 1), SUN, store),
      () => handleTurnSubmission(body(match.id, 1), SUN, store)
    );

    expect(first.status).toBe(409);
    expect(first.body.code).toBe("stale");
    expect(store.turns).toHaveLength(1);
  });

  it.each(OPERATIONS)("reports an identical terminal win as a duplicate, not finished, when its twin commits before %s", async (operation) => {
    const { match, store, attack } = winningSetup();
    const request = body(match.id, 1, attack);

    const { first } = await interleave(
      store,
      operation,
      () => handleTurnSubmission(request, SUN, store),
      () => handleTurnSubmission(request, SUN, store)
    );

    expect(first.status).toBe(200);
    expect(first.body.code).toBe("duplicate");
    expect(first.body.winner).toBe("sun");
    expect(store.turns).toHaveLength(1);
  });
});

describe("match-turn handler: terminal wins and access", () => {
  it("commits a terminal win without end_turn and deduplicates its retry", async () => {
    const { match, store, attack } = winningSetup();
    const request = body(match.id, 1, attack);

    const first = await handleTurnSubmission(request, SUN, store);
    const retry = await handleTurnSubmission(request, SUN, store);
    const late = await handleTurnSubmission(body(match.id, 1), MOON, store);

    expect(first.body.code).toBe("accepted");
    expect(first.body.winner).toBe("sun");
    expect(first.body.turnNumber).toBe(1);
    expect(retry.body.code).toBe("duplicate");
    expect(retry.body.winner).toBe("sun");
    expect(late.body.code).toBe("finished");
    expect(store.turns).toHaveLength(1);
  });

  it("refuses players without a seat and leaks no state", async () => {
    const { match, store } = setup();

    const result = await handleTurnSubmission(body(match.id, 1), STRANGER, store);

    expect(result.status).toBe(403);
    expect(result.body.code).toBe("forbidden");
    expect(result.body.state).toBeUndefined();
    expect(store.commitCalls).toBe(0);
  });

  it("refuses an out-of-turn submission at the current version", async () => {
    const { match, store } = setup();

    const result = await handleTurnSubmission(body(match.id, 1), MOON, store);

    expect(result.status).toBe(409);
    expect(result.body.code).toBe("not_your_turn");
    expect(store.turns).toHaveLength(0);
  });
});
