import { PLAYER_NAMES, applyTurnActions, createMatch, reachableTiles, type MatchState, type PlayerId, type TurnAction } from "../src/engine";
import { OnlineMatchController } from "../src/app/onlineMatchController";
import { OnlineRequestError, type TurnSubmissionAccepted } from "../src/lib/online";
import { createLocalLockRunner, createOnlineDraftStore, onlineDraftLockName, type LockRunner } from "../src/lib/onlineDraftStore";
import { loadOnlineDraft } from "../src/lib/storage";
import { handleTurnSubmission } from "../supabase/functions/match-turn/handler";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryTurnStore } from "./support/memoryTurnStore";

// The OnlineMatchController that App.tsx renders, driven as several browser tabs that share
// one localStorage, one cross-tab lock manager, and one server (the real Edge Function handler
// on an in-memory store). Interleavings use explicit barriers, never timers.

const SUN = "00000000-0000-4000-8000-000000000001";
const MOON = "00000000-0000-4000-8000-000000000002";
const END: TurnAction = { type: "end_turn" };

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** localStorage stand-in that records written keys so tests decide when storage events fire. */
class MemoryStorage {
  private values = new Map<string, string>();
  readonly changedKeys: string[] = [];
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); this.changedKeys.push(key); }
  removeItem(key: string) { this.values.delete(key); this.changedKeys.push(key); }
  clear() { this.values.clear(); }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = storage;
});

/**
 * A request held at the network: `reached` fires once it is sent, `release` lets it continue,
 * and `fail` makes it fail without reaching the server once released.
 */
interface Hold {
  reached: Deferred;
  release: Deferred;
  fail: boolean;
}

interface Tab {
  controller: OnlineMatchController;
  ui: { board: MatchState | null; message: string | null; busy: boolean };
  network: { offline: boolean; loseResponse: boolean; hold: Hold | null; fetchHolds: Hold[]; submissions: number; fetches: number };
  closed: boolean;
  readonly view: ReturnType<OnlineMatchController["getView"]>;
  refresh(announce?: boolean): Promise<boolean>;
  play(action: TurnAction): Promise<boolean>;
  holdNextSubmission(): Hold;
  /** Holds this tab's next match fetch (refresh) until released; queue several for overlap. */
  holdNextFetch(): Hold;
  /** App's Leave, then Resume of the same match from a fresh server snapshot. */
  reopen(): Promise<unknown>;
  close(): void;
}

function createBrowser(initial: MatchState = createMatch("meadow-line", "online")) {
  const server = new MemoryTurnStore(initial, { [SUN]: "sun", [MOON]: "moon" });
  const matchId = initial.id;
  // One lock manager for every tab, as navigator.locks is shared across an origin.
  const sharedLocks = createLocalLockRunner();
  const lockNames: string[] = [];
  let writeResultGate: Deferred | null = null;
  let writeCheckInterference: (() => void) | null = null;
  const locks: LockRunner = (name, task) => {
    lockNames.push(name);
    const run = sharedLocks(name, task);
    const gate = writeResultGate;
    const interfere = writeCheckInterference;
    writeResultGate = null;
    writeCheckInterference = null;
    // Delays only the caller seeing the result; the write itself already happened under the lock.
    const seen = gate ? run.then(async (result) => { await gate.promise; return result; }) : run;
    return interfere ? seen.then((result) => onInspection(result, interfere)) : seen;
  };
  const tabs: Tab[] = [];

  /** Opens (or reloads) a tab the way App.tsx does: initial draft from storage, then refresh. */
  function openTab(side: PlayerId = "sun"): Tab {
    const userId = side === "sun" ? SUN : MOON;
    const network = { offline: false, loseResponse: false, hold: null as Hold | null, fetchHolds: [] as Hold[], submissions: 0, fetches: 0 };
    const ui = { board: null as MatchState | null, message: null as string | null, busy: false };
    const controller = new OnlineMatchController(
      {
        api: {
          async getMatch(id) {
            network.fetches += 1;
            const hold = network.fetchHolds.shift();
            if (hold) {
              hold.reached.resolve();
              await hold.release.promise;
              if (hold.fail) throw new OnlineRequestError("Failed to fetch");
            } else if (network.offline) {
              throw new OnlineRequestError("Failed to fetch");
            }
            const match = await server.getMatch(id);
            return { id, side, inviteCode: null, state: match!.state };
          },
          async submitTurn(submission) {
            network.submissions += 1;
            const hold = network.hold;
            if (hold) {
              network.hold = null;
              hold.reached.resolve();
              await hold.release.promise;
            }
            if (network.offline || hold?.fail) throw new OnlineRequestError("Failed to fetch");
            const result = await handleTurnSubmission(submission, userId, server);
            if (network.loseResponse) throw new OnlineRequestError("Failed to fetch");
            if (result.status !== 200) {
              const { error, code, state } = result.body as { error: string; code?: string; state?: MatchState };
              throw new OnlineRequestError(error, result.status, code, state);
            }
            return result.body as unknown as TurnSubmissionAccepted;
          }
        },
        drafts: createOnlineDraftStore(locks),
        getUserId: () => userId,
        ui: {
          setBoard: (board) => { ui.board = board; },
          setMessage: (message) => { ui.message = message; },
          setBusy: (busy) => { ui.busy = busy; },
          clearSelection: () => {}
        }
      },
      { session: { matchId, side, inviteCode: null }, draft: loadOnlineDraft(matchId, side), sync: "checking" }
    );
    const tab: Tab = {
      controller,
      ui,
      network,
      closed: false,
      get view() { return controller.getView(); },
      /** App's mount effect, or the Refresh/Retry button. */
      refresh: (announce = false) => controller.refresh(matchId, announce),
      /**
       * App.tsx's playOnlineAction: the engine computes the result from the board shown now,
       * and the controller decides, possibly much later, whether that result is applied.
       */
      play(action) {
        const result = applyTurnActions(ui.board!, [action]);
        if (!result.ok) throw new Error(`illegal test action: ${result.issue?.message}`);
        return controller.recordAction(action, () => { ui.board = result.state; });
      },
      /** Holds this tab's next submission at the network until released. */
      holdNextSubmission() {
        const hold: Hold = { reached: deferred(), release: deferred(), fail: false };
        network.hold = hold;
        return hold;
      },
      holdNextFetch() {
        const hold: Hold = { reached: deferred(), release: deferred(), fail: false };
        network.fetchHolds.push(hold);
        return hold;
      },
      reopen() {
        controller.leave();
        return controller.open({ id: matchId, side, inviteCode: null, state: structuredClone(server.match) });
      },
      close() { tab.closed = true; }
    };
    tabs.push(tab);
    return tab;
  }

  /** Delivers pending `storage` events to every open tab, as the browser would. */
  async function deliverStorageEvents() {
    const keys = storage.changedKeys.splice(0);
    for (const key of keys) {
      for (const tab of tabs.filter((entry) => !entry.closed)) {
        await tab.controller.handleStorageChange(key);
      }
    }
  }

  /** The opponent plays a whole turn directly against the server. */
  async function opponentEndsTurn() {
    const result = await handleTurnSubmission(
      { matchId, submissionId: crypto.randomUUID(), expectedTurnNumber: server.match.turnNumber, actions: [END] },
      server.match.currentPlayer === "sun" ? SUN : MOON,
      server
    );
    expect(result.body.code).toBe("accepted");
  }

  /** Holds the sun seat's draft lock, as another tab mid-write would, until resolved. */
  function holdSeatLock() {
    const held = deferred();
    void sharedLocks(onlineDraftLockName(matchId, "sun"), () => held.promise);
    return held;
  }

  /** The next draft write happens under the lock as usual, but its caller sees the result only on release. */
  function holdNextWriteResult() {
    writeResultGate = deferred();
    return writeResultGate;
  }

  /**
   * Runs `interfere` just after the controller inspects the next write result. It does that in
   * confirmWrite, in the same synchronous run as its final freshness check, so `interfere`
   * (queued as a microtask) runs after that check has passed and before anything the controller
   * defers with an await, which is exactly where an async gap would let an obsolete result in.
   */
  function interfereAfterNextWriteCheck(interfere: () => void) {
    writeCheckInterference = interfere;
  }

  return {
    server, matchId, lockNames, openTab, deliverStorageEvents, opponentEndsTurn, holdSeatLock, holdNextWriteResult, interfereAfterNextWriteCheck,
    stored: () => loadOnlineDraft(matchId, "sun")
  };
}

/** Wraps a write result so the first read of its `ok` field queues `interfere` as a microtask. */
function onInspection<T>(result: T, interfere: () => void): T {
  if (typeof result !== "object" || result === null) return result;
  let armed = true;
  return new Proxy(result, {
    get(target, key, receiver) {
      if (armed && key === "ok") {
        armed = false;
        queueMicrotask(interfere);
      }
      return Reflect.get(target, key, receiver);
    }
  });
}

/** A legal move for an unmoved unit of the side to act; `skip` picks a different unit. */
function legalMove(board: MatchState, skip = 0): TurnAction {
  const units = board.units.filter((unit) => unit.owner === board.currentPlayer && !unit.moved && reachableTiles(board, unit.id).length > 1);
  const unit = units[skip]!;
  const to = reachableTiles(board, unit.id).find((tile) => tile.x !== unit.x || tile.y !== unit.y)!;
  return { type: "move", unitId: unit.id, to };
}

function unitAt(board: MatchState | null, action: TurnAction) {
  if (action.type !== "move") throw new Error("not a move");
  const unit = board?.units.find((entry) => entry.id === action.unitId);
  return unit ? { x: unit.x, y: unit.y } : null;
}

describe("cross-tab drafts: a stale tab cannot clobber another tab's work", () => {
  it("keeps a frozen submission and its ID when a stale tab acts, and confirms it once after reload", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    await a.refresh();
    await b.refresh();
    const move = legalMove(a.ui.board!);
    expect(await a.play(move)).toBe(true);

    // A ends its turn; the request is in flight when B, which has seen none of this, moves.
    const hold = a.holdNextSubmission();
    const sending = a.controller.submit(END);
    await hold.reached.promise;
    const frozen = browser.stored()!;
    expect(frozen.status).toBe("submitting");

    const stale = await b.play(legalMove(b.ui.board!, 1));
    await b.controller.discard();

    expect(stale).toBe(false);
    expect(browser.stored()).toEqual(frozen);
    expect(b.view.draft).toEqual(frozen);
    expect(b.view.canPlay).toBe(false);
    expect(b.ui.message).toContain("already sent from another tab");

    // A's connection drops before the request leaves the device.
    a.network.offline = true;
    hold.release.resolve();
    await sending;
    expect(a.view.sync).toBe("unreachable");
    expect(a.ui.message).toContain("Turn pending");
    expect(browser.stored()).toEqual(frozen);

    // Reload: the stored draft, actions, and submission ID come back and are confirmed once.
    a.close();
    const reloaded = browser.openTab();
    expect(reloaded.view.draft).toEqual(frozen);
    await reloaded.refresh();

    expect(browser.server.turns).toHaveLength(1);
    expect(browser.server.turns[0].submissionId).toBe(frozen.submissionId);
    expect(browser.server.turns[0].actions).toEqual([move, END]);
    expect(browser.stored()).toBeNull();
    expect(reloaded.view.draft).toBeNull();
    expect(reloaded.ui.message).toContain("Turn accepted");
  });

  it("refuses an editing tab that is behind, shows it the other tab's moves, and lets it continue", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    await a.refresh();
    await b.refresh();
    const first = legalMove(a.ui.board!);
    await a.play(first);

    // No storage event reached B yet; its write is refused instead of replacing A's draft.
    const refused = await b.play(legalMove(b.ui.board!, 1));

    expect(refused).toBe(false);
    expect(b.ui.message).toContain("changed in another tab");
    expect(browser.stored()!.actions).toEqual([first]);
    expect(unitAt(b.ui.board, first)).toEqual((first as Extract<TurnAction, { type: "move" }>).to);

    // B is now current and continues; A is the one behind and gets the same treatment.
    const second = legalMove(b.ui.board!, 1);
    expect(await b.play(second)).toBe(true);
    expect(await a.play(legalMove(a.ui.board!, 2))).toBe(false);
    expect(browser.stored()!.actions).toEqual([first, second]);
    expect(a.view.draft).toEqual(browser.stored());
  });

  it("follows another tab's moves through storage events without conflicts", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    await a.refresh();
    await b.refresh();
    const first = legalMove(a.ui.board!);
    await a.play(first);

    await browser.deliverStorageEvents();

    expect(b.view.draft).toEqual(browser.stored());
    expect(unitAt(b.ui.board, first)).toEqual((first as Extract<TurnAction, { type: "move" }>).to);
    expect(await b.play(legalMove(b.ui.board!, 1))).toBe(true);
    expect(browser.stored()!.actions).toHaveLength(2);
  });

  it("serializes writes through the seat's cross-tab lock, so a queued stale write is refused", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    await a.refresh();
    await b.refresh();
    const first = legalMove(a.ui.board!);
    const competing = legalMove(b.ui.board!, 1);

    // Both tabs write while the seat lock is held elsewhere; neither may read-and-write early.
    const lock = browser.holdSeatLock();
    const aWrite = a.play(first);
    const bWrite = b.play(competing);
    await flushTasks();
    expect(browser.stored()).toBeNull();

    lock.resolve();
    const [aResult, bResult] = await Promise.all([aWrite, bWrite]);

    expect(aResult).toBe(true);
    expect(bResult).toBe(false);
    expect(browser.stored()!.actions).toEqual([first]);
    expect(b.view.draft).toEqual(browser.stored());
    expect(new Set(browser.lockNames)).toEqual(new Set([`bannerfront.online-draft:${browser.matchId}:sun`]));
  });
});

describe("cross-tab drafts: recovery when the sending tab closes", () => {
  it.each([
    ["never reached the server", false, "accepted"],
    ["was committed but the reply was lost", true, "duplicate"]
  ] as const)("another tab resends a submission that %s with the same ID", async (_label, reachedServer, code) => {
    const browser = createBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    await a.refresh();
    await b.refresh();
    const move = legalMove(a.ui.board!);
    await a.play(move);

    const hold = a.holdNextSubmission();
    void a.controller.submit(END);
    await hold.reached.promise;
    if (reachedServer) {
      a.network.loseResponse = true;
      hold.release.resolve();
    }
    // A closes with the request unresolved (or its reply lost). Its lock and listeners go away.
    a.close();
    await browser.deliverStorageEvents();
    const frozen = browser.stored()!;

    expect(b.view.draft).toEqual(frozen);
    expect(b.view.canPlay).toBe(false);

    await b.refresh(); // Retry

    expect(browser.server.turns).toHaveLength(1);
    expect(browser.server.turns[0].submissionId).toBe(frozen.submissionId);
    expect(browser.stored()).toBeNull();
    expect(b.view.draft).toBeNull();
    expect(b.ui.message).toContain(code === "duplicate" ? "already been saved" : "Turn accepted.");

    // The opponent replies; B can play the next turn.
    await browser.opponentEndsTurn();
    await b.refresh();
    expect(b.view.canPlay).toBe(true);
  });
});

describe("refresh after another tab settles a submission", () => {
  it("clears an obsolete pending submission and allows play on the player's turn", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    await a.refresh();
    await b.refresh();
    await a.play(legalMove(a.ui.board!));
    a.network.offline = true;
    await a.controller.submit(END);
    expect(a.view.draft?.status).toBe("submitting");
    expect(a.view.sync).toBe("unreachable");

    // B confirms the stored submission and removes it; A receives no storage event.
    await b.refresh();
    expect(browser.stored()).toBeNull();
    await browser.opponentEndsTurn();

    a.network.offline = false;
    await a.refresh(true);

    expect(a.view.draft).toBeNull();
    expect(a.view.sync).toBe("ready");
    expect(a.view.canPlay).toBe(true);
    expect(a.ui.message).toBe("Refreshed: your turn.");
    expect(a.ui.board?.turnNumber).toBe(3);
    expect(await a.play(legalMove(a.ui.board!))).toBe(true);
    expect(a.network.submissions).toBe(1);
    expect(browser.server.turns).toHaveLength(2);
  });

  it("keeps a genuinely uncertain submission through failed refreshes until it is confirmed", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    await a.refresh();
    a.network.offline = true;
    await a.controller.submit(END);
    const frozen = browser.stored()!;

    await a.refresh();
    expect(a.view.draft).toEqual(frozen);
    expect(a.view.sync).toBe("unreachable");

    a.network.offline = false;
    await a.refresh();

    expect(browser.server.turns.map((turn) => turn.submissionId)).toEqual([frozen.submissionId]);
    expect(a.view.draft).toBeNull();
    expect(a.view.sync).toBe("ready");
  });

  it("adopts a newer draft from another tab instead of the settled submission", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    await a.refresh();
    await b.refresh();
    a.network.offline = true;
    await a.controller.submit(END);

    await b.refresh();
    await browser.opponentEndsTurn();
    await b.refresh();
    const next = legalMove(b.ui.board!);
    await b.play(next);
    const newer = browser.stored()!;

    a.network.offline = false;
    await a.refresh();

    expect(browser.stored()).toEqual(newer);
    expect(a.view.draft?.revision).toBe(newer.revision);
    expect(a.view.draft?.actions).toEqual([next]);
    expect(a.view.canPlay).toBe(true);
    expect(a.network.submissions).toBe(1);
  });

  it.each([
    ["fails", true],
    ["arrives as a duplicate", false]
  ] as const)("ignores a late reply that %s after another tab settled the submission and moved on", async (_label, fails) => {
    const browser = createBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    await a.refresh();
    await b.refresh();
    const hold = a.holdNextSubmission();
    const sending = a.controller.submit(END);
    await hold.reached.promise;

    // B takes over the pending submission, confirms it, and starts the next turn's draft.
    await browser.deliverStorageEvents();
    await b.refresh();
    await browser.opponentEndsTurn();
    await b.refresh();
    await b.play(legalMove(b.ui.board!));
    const newer = browser.stored()!;

    hold.fail = fails;
    hold.release.resolve();
    await sending;

    expect(browser.stored()).toEqual(newer);
    expect(browser.server.turns).toHaveLength(2);
    expect(a.view.draft?.revision).toBe(newer.revision);
    expect(a.view.sync).toBe("ready");
    expect(a.ui.message ?? "").not.toContain("pending");
  });
});

describe("terminal wins across tabs", () => {
  function winningMatch() {
    const match = createMatch("meadow-line", "online");
    const attacker = match.units.find((unit) => unit.owner === "sun" && unit.kind === "swordsman")!;
    const defender = match.units.find((unit) => unit.owner === "moon" && unit.kind === "militia")!;
    Object.assign(attacker, { x: 3, y: 3 });
    Object.assign(defender, { x: 4, y: 3, hp: 1 });
    match.units = [attacker, defender];
    return { match, attack: { type: "attack", attackerId: attacker.id, targetId: defender.id } as TurnAction };
  }

  it("keeps a winning attack pending through a stale tab and reload, then confirms it once", async () => {
    const { match, attack } = winningMatch();
    const browser = createBrowser(match);
    const a = browser.openTab();
    const b = browser.openTab();
    await a.refresh();
    await b.refresh();

    a.network.loseResponse = true;
    await a.controller.submit(attack);
    const frozen = browser.stored()!;
    expect(frozen.actions).toEqual([attack]);
    expect(a.ui.board?.winner).toBeNull(); // the board stays pre-attack until confirmed
    expect(browser.server.match.winner).toBe("sun");

    expect(await b.play({ type: "recruit", kind: "militia" })).toBe(false);
    expect(browser.stored()).toEqual(frozen);

    a.close();
    const reloaded = browser.openTab();
    await reloaded.refresh();

    expect(reloaded.ui.board?.winner).toBe("sun");
    expect(reloaded.ui.message).toContain("already been saved");
    expect(reloaded.view.canPlay).toBe(false);
    expect(browser.server.turns).toHaveLength(1);
    expect(browser.stored()).toBeNull();

    await b.refresh();
    expect(b.view.draft).toBeNull();
    expect(b.ui.board?.winner).toBe("sun");
  });

  it("announces the winner on Refresh instead of waiting for the opponent", async () => {
    const { match, attack } = winningMatch();
    const browser = createBrowser(match);
    const a = browser.openTab();
    await a.refresh();
    await a.controller.submit(attack);
    expect(browser.server.match.winner).toBe("sun");

    await a.refresh(true);
    expect(a.ui.message).toBe(`Refreshed: ${PLAYER_NAMES.sun} won.`);
    expect(a.view.canPlay).toBe(false);
  });
});

describe("freshness: queued local actions", () => {
  /** A is still showing turn 1 while the server, through tab B and the opponent, reached turn 3. */
  async function behindAtTurnThree() {
    const browser = createBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    await a.refresh();
    await b.refresh();
    await b.controller.submit(END);
    await browser.opponentEndsTurn();
    expect(browser.server.match.turnNumber).toBe(3);
    expect(a.ui.board?.turnNumber).toBe(1);
    expect(a.view.canPlay).toBe(true); // A has not heard of any of it yet
    return { browser, a };
  }

  it("drops a turn-one move that was waiting for the draft lock when Refresh adopts turn three", async () => {
    const { browser, a } = await behindAtTurnThree();
    const move = legalMove(a.ui.board!);
    const startedAt = unitAt(a.ui.board, move);

    const lock = browser.holdSeatLock();
    const queued = a.play(move);
    await flushTasks();
    expect(a.controller.isWriting).toBe(true);

    expect(await a.refresh(true)).toBe(true);
    expect(a.ui.board?.turnNumber).toBe(3);

    lock.resolve();
    expect(await queued).toBe(false);

    expect(browser.stored()).toBeNull();
    expect(a.view.draft).toBeNull();
    expect(a.ui.board?.turnNumber).toBe(3);
    expect(unitAt(a.ui.board, move)).toEqual(startedAt);
    expect(a.view.canPlay).toBe(true);
    expect(a.ui.message).toContain("board was updated before this was saved, so your last action was not applied");
    // The fresh board is fully playable afterwards.
    expect(await a.play(legalMove(a.ui.board!))).toBe(true);
    expect(browser.stored()?.baseTurnNumber).toBe(3);
  });

  it("still applies a queued move when Refresh finds the same turn", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    await a.refresh();
    const move = legalMove(a.ui.board!);

    const lock = browser.holdSeatLock();
    const queued = a.play(move);
    await flushTasks();
    expect(await a.refresh()).toBe(true);
    lock.resolve();

    expect(await queued).toBe(true);
    expect(browser.stored()?.actions).toEqual([move]);
    expect(unitAt(a.ui.board, move)).toEqual((move as Extract<TurnAction, { type: "move" }>).to);
  });

  it("does not show a turn-one move whose write landed just before Refresh adopted turn three", async () => {
    const { browser, a } = await behindAtTurnThree();
    const move = legalMove(a.ui.board!);
    const startedAt = unitAt(a.ui.board, move);

    const result = browser.holdNextWriteResult();
    const queued = a.play(move);
    await flushTasks();
    expect(browser.stored()?.actions).toEqual([move]); // stored, result not yet back

    await a.refresh();
    result.resolve();
    expect(await queued).toBe(false);

    // Refresh saw the written draft and discarded it; the engine result is never applied.
    expect(browser.stored()).toBeNull();
    expect(a.ui.board?.turnNumber).toBe(3);
    expect(unitAt(a.ui.board, move)).toEqual(startedAt);
    expect(a.ui.message).toContain("discarded because the match is now on turn 3");
    expect(a.view.canPlay).toBe(true);
  });

  it("does not send a turn-one End Turn that was waiting for the lock when Refresh adopts turn three", async () => {
    const { browser, a } = await behindAtTurnThree();

    const lock = browser.holdSeatLock();
    const queued = a.controller.submit(END);
    await flushTasks();
    await a.refresh();
    lock.resolve();
    await queued;

    expect(a.network.submissions).toBe(0);
    expect(browser.stored()).toBeNull();
    expect(browser.server.turns).toHaveLength(2);
    expect(a.view.canPlay).toBe(true);
    expect(a.ui.message).toContain("your turn was not sent");
  });

  it.each([
    ["a move", "move"],
    ["End Turn", "submit"],
    ["Undo Turn", "undo"]
  ] as const)("drops %s queued before leaving and reopening the same match", async (_label, kind) => {
    const browser = createBrowser();
    const a = browser.openTab();
    await a.refresh();
    const kept = legalMove(a.ui.board!, 1);
    if (kind === "undo") {
      await a.play(kept);
    }
    const before = browser.stored();
    const move = legalMove(a.ui.board!);
    const startedAt = unitAt(a.ui.board, move);

    const lock = browser.holdSeatLock();
    const queued = kind === "move" ? a.play(move) : kind === "submit" ? a.controller.submit(END) : a.controller.discard();
    await flushTasks();
    await a.reopen();
    const reopenedBoard = a.ui.board;
    const message = a.ui.message;
    lock.resolve();
    await queued;

    // Same canonical turn and same stored draft, but a different visit: nothing lands.
    expect(browser.stored()).toEqual(before);
    expect(a.view.draft).toEqual(before);
    expect(a.ui.board).toBe(reopenedBoard);
    expect(unitAt(a.ui.board, move)).toEqual(startedAt);
    expect(a.ui.message).toBe(message);
    expect(a.network.submissions).toBe(0);
    expect(a.view.canPlay).toBe(true);
    if (kind === "undo") {
      expect(unitAt(a.ui.board, kept)).toEqual((kept as Extract<TurnAction, { type: "move" }>).to);
    }
  });
});

describe("freshness: overlapping sync operations", () => {
  it("ignores an older refresh failure that arrives after a newer refresh succeeded", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    await a.refresh();
    const older = a.holdNextFetch();
    const first = a.refresh();
    await older.reached.promise;

    expect(await a.refresh()).toBe(true);
    expect(a.view.sync).toBe("ready");

    older.fail = true;
    older.release.resolve();
    expect(await first).toBe(false);

    expect(a.view.sync).toBe("ready");
    expect(a.view.canPlay).toBe(true);
    expect(a.ui.busy).toBe(false);
    expect(a.ui.message ?? "").not.toContain("Could not sync");
    expect(await a.play(legalMove(a.ui.board!))).toBe(true);
  });

  it("ignores an older refresh success that arrives after a newer refresh failed", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    await a.refresh();
    const older = a.holdNextFetch();
    const first = a.refresh();
    await older.reached.promise;

    a.network.offline = true;
    expect(await a.refresh()).toBe(false);
    a.network.offline = false;
    older.release.resolve();
    expect(await first).toBe(false);

    expect(a.view.sync).toBe("unreachable");
    expect(a.view.canPlay).toBe(false);
    expect(a.ui.message).toContain("Could not sync");
  });

  it("does not let an older refresh's cleanup clear the busy state of a newer one", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    await a.refresh();
    const olderFetch = a.holdNextFetch();
    const newerFetch = a.holdNextFetch();
    const older = a.refresh();
    await olderFetch.reached.promise;
    const newer = a.refresh();
    await newerFetch.reached.promise;

    olderFetch.release.resolve();
    await older;
    expect(a.ui.busy).toBe(true);
    expect(a.view.sync).toBe("checking");
    expect(a.view.canPlay).toBe(false);

    newerFetch.release.resolve();
    expect(await newer).toBe(true);
    expect(a.ui.busy).toBe(false);
    expect(a.view.sync).toBe("ready");
  });

  it("keeps unsent moves through a genuine current failure and resumes them on retry", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    await a.refresh();
    const move = legalMove(a.ui.board!);
    await a.play(move);
    const draft = browser.stored()!;

    const failing = a.holdNextFetch();
    failing.fail = true;
    const attempt = a.refresh();
    await failing.reached.promise;
    failing.release.resolve();
    expect(await attempt).toBe(false);

    expect(a.view.sync).toBe("unreachable");
    expect(a.ui.busy).toBe(false);
    expect(a.ui.message).toContain("1 unsent move(s) are saved");
    expect(browser.stored()).toEqual(draft);
    expect(a.view.draft).toEqual(draft);
    expect(await a.play(legalMove(a.ui.board!, 1))).toBe(false);

    expect(await a.refresh(true)).toBe(true);
    expect(a.ui.message).toBe("Refreshed: your 1 unsent move(s) are kept until End Turn.");
    expect(unitAt(a.ui.board, move)).toEqual((move as Extract<TurnAction, { type: "move" }>).to);
    expect(a.view.canPlay).toBe(true);
    await a.controller.submit(END);
    expect(browser.server.turns.map((turn) => turn.actions)).toEqual([[move, END]]);
  });

  it("lets the in-flight submission's answer settle the board instead of racing it with a refresh", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    await a.refresh();
    const hold = a.holdNextSubmission();
    const sending = a.controller.submit(END);
    await hold.reached.promise;
    const fetches = a.network.fetches;

    expect(await a.refresh()).toBe(false);
    expect(a.network.fetches).toBe(fetches);
    expect(a.view.sync).toBe("checking");
    expect(a.ui.busy).toBe(true);

    hold.release.resolve();
    await sending;
    expect(a.view.sync).toBe("ready");
    expect(a.ui.busy).toBe(false);
    expect(a.ui.board?.turnNumber).toBe(2);
    expect(a.ui.message).toBe("Turn accepted. Waiting for opponent.");
  });

  it("hands an in-flight submission's answer to the reopened match instead of the left one", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    await a.refresh();
    const hold = a.holdNextSubmission();
    const sending = a.controller.submit(END);
    await hold.reached.promise;

    const reopening = a.reopen();
    await flushTasks();
    // The reopened board resends the stored submission, sharing the request already on the network.
    expect(a.network.submissions).toBe(1);
    expect(a.view.draft?.status).toBe("submitting");

    hold.release.resolve();
    await Promise.all([sending, reopening]);

    expect(browser.server.turns).toHaveLength(1);
    expect(browser.stored()).toBeNull();
    expect(a.view.draft).toBeNull();
    expect(a.view.sync).toBe("ready");
    expect(a.ui.busy).toBe(false);
    expect(a.ui.board?.turnNumber).toBe(2);
    expect(a.ui.message).toBe("Turn accepted. Waiting for opponent.");
  });

  it.each([
    ["leaving", false],
    ["leaving and reopening", true]
  ] as const)("ignores a refresh failure that arrives after %s the match", async (_label, reopen) => {
    const browser = createBrowser();
    const a = browser.openTab();
    await a.refresh();
    const older = a.holdNextFetch();
    older.fail = true;
    const first = a.refresh();
    await older.reached.promise;

    if (reopen) {
      await a.reopen();
    } else {
      a.controller.leave();
      a.ui.message = null; // App's leaveMatch clears the message
    }
    older.release.resolve();
    expect(await first).toBe(false);

    expect(a.view.sync).toBe("ready");
    expect(a.view.canPlay).toBe(reopen);
    expect(a.ui.busy).toBe(false);
    expect(a.ui.message ?? "").not.toContain("Could not sync");
  });
});

describe("freshness: no gap between the final check and applying the result", () => {
  // Each operation is interrupted right after confirmWrite's final freshness check. With no
  // await between that check and the state change, the action takes effect in the context it
  // was checked against, before the interruption; nothing from it lands afterwards.
  type Kind = "move" | "submit" | "undo";

  function start(a: Tab, kind: Kind, move: TurnAction) {
    return kind === "move" ? a.play(move) : kind === "submit" ? a.controller.submit(END) : a.controller.discard();
  }

  /** App's leaveMatch: the controller leaves and the screen drops the board and message. */
  function leaveLikeApp(a: Tab) {
    a.controller.leave();
    a.ui.board = null;
    a.ui.message = null;
  }

  function snapshotOf(state: MatchState) {
    return { id: state.id, side: "sun" as const, inviteCode: null, state: structuredClone(state) };
  }

  it.each([
    ["a move", "move"],
    ["End Turn", "submit"],
    ["Undo Turn", "undo"]
  ] as const)("keeps %s on Meadow Line out of Ashen Ford, opened right after its final check", async (_label, kind) => {
    const browser = createBrowser();
    const a = browser.openTab();
    await a.refresh();
    // Sun has one unsent move on Ashen Ford.
    const ashen = createMatch("ashen-ford", "online");
    leaveLikeApp(a);
    await a.controller.open(snapshotOf(ashen));
    expect(await a.play(legalMove(a.ui.board!))).toBe(true);
    const ashenDraft = loadOnlineDraft(ashen.id, "sun")!;
    leaveLikeApp(a);
    await a.reopen();
    if (kind === "undo") {
      await a.play(legalMove(a.ui.board!, 1));
    }
    const move = legalMove(a.ui.board!);

    let switching: Promise<unknown> = Promise.resolve();
    let shown: { board: MatchState | null; message: string | null } | null = null;
    browser.interfereAfterNextWriteCheck(() => {
      leaveLikeApp(a);
      switching = a.controller.open(snapshotOf(ashen));
      shown = { board: a.ui.board, message: a.ui.message };
    });
    const old = start(a, kind, move);
    await Promise.all([old, switching]);
    await flushTasks();

    // Ashen Ford's board, draft, and status are exactly what opening it produced.
    expect(shown).not.toBeNull();
    expect(a.view.session?.matchId).toBe(ashen.id);
    expect(a.ui.board).toBe(shown!.board);
    expect(a.ui.message).toBe(shown!.message);
    expect(a.view.draft).toEqual(ashenDraft);
    expect(loadOnlineDraft(ashen.id, "sun")).toEqual(ashenDraft);
    const ashenMove = ashenDraft.actions[0] as Extract<TurnAction, { type: "move" }>;
    expect(unitAt(a.ui.board, ashenMove)).toEqual(ashenMove.to);
    expect(a.view.sync).toBe("ready");
    expect(a.view.canPlay).toBe(true);
    expect(a.ui.busy).toBe(false);

    // The action took effect on Meadow Line only, where it was checked.
    if (kind === "move") {
      expect(await old).toBe(true);
      expect(browser.stored()?.actions).toEqual([move]);
    } else if (kind === "submit") {
      // Sent while Meadow Line was current; its answer settles storage but is not shown on Ashen Ford.
      expect(a.network.submissions).toBe(1);
      expect(browser.server.match.turnNumber).toBe(2);
      expect(browser.stored()).toBeNull();
    } else {
      expect(browser.stored()).toBeNull();
    }
    if (kind !== "submit") {
      expect(a.network.submissions).toBe(0);
    }
  });

  it.each([
    ["a move", "move"],
    ["End Turn", "submit"],
    ["Undo Turn", "undo"]
  ] as const)("does not let %s change the same match after it is left and reopened right after its final check", async (_label, kind) => {
    const browser = createBrowser();
    const a = browser.openTab();
    await a.refresh();
    if (kind === "undo") {
      await a.play(legalMove(a.ui.board!, 1));
    }
    const move = legalMove(a.ui.board!);
    const hold = kind === "submit" ? a.holdNextSubmission() : null;

    let reopening: Promise<unknown> = Promise.resolve();
    let shown: { board: MatchState | null; message: string | null; draft: unknown } | null = null;
    browser.interfereAfterNextWriteCheck(() => {
      leaveLikeApp(a);
      reopening = a.controller.open(snapshotOf(browser.server.match));
      shown = { board: a.ui.board, message: a.ui.message, draft: a.view.draft };
    });
    const old = start(a, kind, move);
    await flushTasks();

    // The reopened visit rebuilt everything from storage; the old operation added nothing after it.
    expect(shown).not.toBeNull();
    expect(a.ui.board).toBe(shown!.board);
    expect(a.ui.message).toBe(shown!.message);
    expect(a.view.draft).toEqual(shown!.draft);
    expect(a.view.draft).toEqual(browser.stored());

    hold?.release.resolve();
    await Promise.all([old, reopening]);
    if (kind === "move") {
      // Stored before the reopen, so the reopened visit resumed it.
      expect(browser.stored()?.actions).toEqual([move]);
      expect(unitAt(a.ui.board, move)).toEqual((move as Extract<TurnAction, { type: "move" }>).to);
      expect(a.ui.board).toBe(shown!.board);
    } else if (kind === "submit") {
      // Sent before the reopen; the reopened visit joined that request instead of sending again.
      expect(a.network.submissions).toBe(1);
      expect(browser.server.match.turnNumber).toBe(2);
      expect(a.ui.message).toBe("Turn accepted. Waiting for opponent.");
    } else {
      expect(browser.stored()).toBeNull();
      expect(a.ui.message).toBeNull();
    }
    if (kind !== "submit") {
      expect(a.network.submissions).toBe(0);
      expect(a.view.canPlay).toBe(true);
    }
    expect(a.view.sync).toBe("ready");
    expect(a.ui.busy).toBe(false);
  });

  it("still applies a current move when an unrelated operation runs at the same point", async () => {
    const browser = createBrowser();
    const a = browser.openTab();
    await a.refresh();
    const move = legalMove(a.ui.board!);

    let refreshing: Promise<boolean> = Promise.resolve(true);
    browser.interfereAfterNextWriteCheck(() => {
      refreshing = a.refresh(); // same turn: the move stays current
    });
    expect(await a.play(move)).toBe(true);
    expect(await refreshing).toBe(true);

    expect(browser.stored()?.actions).toEqual([move]);
    expect(a.view.draft).toEqual(browser.stored());
    expect(unitAt(a.ui.board, move)).toEqual((move as Extract<TurnAction, { type: "move" }>).to);
    expect(a.view.canPlay).toBe(true);
  });
});

/** Lets every queued promise callback and pending task run (no timers involved). */
function flushTasks() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}
