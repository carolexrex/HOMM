import { applyTurnActions, createMatch, moveUnit, reachableTiles, type MatchState, type TurnAction } from "../src/engine";
import { OnlineRequestError } from "../src/lib/online";
import {
  appendDraftAction,
  classifySubmitError,
  draftBoard,
  isOlderMatchState,
  markSubmitting,
  reconcileDraft,
  startDraft
} from "../src/lib/onlineDraft";
import { createLocalLockRunner, createOnlineDraftStore, onlineDraftLockName } from "../src/lib/onlineDraftStore";
import { loadOnlineDraft, saveOnlineDraft } from "../src/lib/storage";
import { beforeEach, describe, expect, it } from "vitest";

// Pure draft helpers and the locked compare-and-set store. The orchestration that App.tsx
// runs on top of them is tested across simulated tabs in online-controller.test.ts.

const SUN = "00000000-0000-4000-8000-000000000001";
const MOON = "00000000-0000-4000-8000-000000000002";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

function firstMove(state: MatchState): TurnAction {
  const unit = state.units.find((entry) => entry.owner === state.currentPlayer && reachableTiles(state, entry.id).length > 1)!;
  const to = reachableTiles(state, unit.id).find((tile) => tile.x !== unit.x || tile.y !== unit.y)!;
  return { type: "move", unitId: unit.id, to };
}

function draftWithMove(canonical: MatchState) {
  const action = firstMove(canonical);
  const local = moveUnit(canonical, (action as Extract<TurnAction, { type: "move" }>).unitId, (action as Extract<TurnAction, { type: "move" }>).to);
  expect(local.ok).toBe(true);
  const draft = appendDraftAction(startDraft(canonical, canonical.id, "sun", SUN), action);
  saveOnlineDraft(draft);
  return { draft, action, local: local.state };
}

describe("online drafts: reload", () => {
  it("restores queued moves after a reload mid-draft", () => {
    const canonical = createMatch("meadow-line", "online");
    const { action, local } = draftWithMove(canonical);

    // Reload: everything is rebuilt from storage, then reconciled with the server state.
    const stored = loadOnlineDraft(canonical.id, "sun")!;
    const offlineBoard = draftBoard(stored)!;
    const reconciled = reconcileDraft(stored, structuredClone(canonical), { matchId: canonical.id, side: "sun", userId: SUN });

    expect(stored.actions).toEqual([action]);
    expect(stored.baseTurnNumber).toBe(1);
    expect(offlineBoard.units).toEqual(local.units);
    expect(reconciled.kind).toBe("resume");
    if (reconciled.kind === "resume") {
      expect(reconciled.board.units).toEqual(local.units);
      expect(reconciled.draft.actions).toEqual([action]);
    }
  });

  it("discards an unsent draft with an explanation when the match moved on", () => {
    const canonical = createMatch("meadow-line", "online");
    const { draft } = draftWithMove(canonical);
    const advanced = applyTurnActions(canonical, [{ type: "end_turn" }, { type: "end_turn" }]).state;

    const reconciled = reconcileDraft(draft, advanced, { matchId: canonical.id, side: "sun", userId: SUN });

    expect(reconciled.kind).toBe("discard");
    if (reconciled.kind === "discard") expect(reconciled.reason).toContain("turn 3");
  });

  it("discards a draft belonging to another player on this device", () => {
    const canonical = createMatch("meadow-line", "online");
    const { draft } = draftWithMove(canonical);

    const reconciled = reconcileDraft(draft, canonical, { matchId: canonical.id, side: "sun", userId: MOON });

    expect(reconciled.kind).toBe("discard");
  });

  it("always resends a submitted draft, keeping its submission ID", () => {
    const canonical = createMatch("meadow-line", "online");
    const { draft } = draftWithMove(canonical);
    const submitting = markSubmitting(draft, { type: "end_turn" });

    const reconciled = reconcileDraft(submitting, canonical, { matchId: canonical.id, side: "sun", userId: SUN });

    expect(markSubmitting(submitting).submissionId).toBe(submitting.submissionId);
    expect(() => appendDraftAction(submitting, { type: "end_turn" })).toThrow();
    expect(reconciled).toEqual({ kind: "resend", draft: submitting });
    // The pending board is the one the player saw when committing, not the unconfirmed result.
    expect(draftBoard(submitting)!.turnNumber).toBe(1);
  });
});

describe("online drafts: error classification", () => {
  it("classifies only definitive HTTP answers as settled", () => {
    expect(classifySubmitError(new Error("boom")).kind).toBe("uncertain");
    expect(classifySubmitError(new OnlineRequestError("network")).kind).toBe("uncertain");
    expect(classifySubmitError(new OnlineRequestError("server", 500, "server_error")).kind).toBe("uncertain");
    expect(classifySubmitError(new OnlineRequestError("auth", 401, "unauthorized")).kind).toBe("uncertain");
    expect(classifySubmitError(new OnlineRequestError("illegal", 400, "rejected"))).toMatchObject({ kind: "settled", reason: "rejected" });
    expect(classifySubmitError(new OnlineRequestError("seat", 403, "forbidden"))).toMatchObject({ kind: "settled", reason: "forbidden" });
    expect(classifySubmitError(new OnlineRequestError("done", 409, "finished"))).toMatchObject({ kind: "settled", reason: "stale" });
  });
});

describe("online drafts: locked compare-and-set store", () => {
  const store = createOnlineDraftStore(createLocalLockRunner());

  it("only writes when the caller holds the latest revision", async () => {
    const canonical = createMatch("meadow-line", "online");
    const empty = startDraft(canonical, canonical.id, "sun", SUN);

    const first = await store.replace(null, appendDraftAction(empty, firstMove(canonical)));
    const behind = await store.replace(null, appendDraftAction(empty, { type: "recruit", kind: "militia" }));

    expect(first.ok).toBe(true);
    expect(behind).toEqual({ ok: false, reason: "conflict", current: loadOnlineDraft(canonical.id, "sun") });
    expect(loadOnlineDraft(canonical.id, "sun")?.actions).toEqual([firstMove(canonical)]);
  });

  it("never replaces a frozen submission, even for a tab holding its revision", async () => {
    const canonical = createMatch("meadow-line", "online");
    const written = await store.replace(null, markSubmitting(startDraft(canonical, canonical.id, "sun", SUN), { type: "end_turn" }));
    const frozen = written.ok ? written.draft! : null;

    const overwrite = await store.replace(frozen, startDraft(canonical, canonical.id, "sun", SUN));

    expect(overwrite.ok).toBe(false);
    expect(loadOnlineDraft(canonical.id, "sun")).toEqual(frozen);
  });

  it("does not let a reply for an older submission remove a newer draft", async () => {
    const canonical = createMatch("meadow-line", "online");
    const sent = await store.replace(null, markSubmitting(startDraft(canonical, canonical.id, "sun", SUN), { type: "end_turn" }));
    const older = sent.ok ? sent.draft! : null;
    // Another tab settles the older submission and starts the next turn's draft.
    await store.remove(older!);
    const newer = await store.replace(null, { ...startDraft(canonical, canonical.id, "sun", SUN), actions: [firstMove(canonical)] });

    const late = await store.remove(older!);

    expect(late.ok).toBe(false);
    expect(loadOnlineDraft(canonical.id, "sun")).toEqual(newer.ok ? newer.draft : null);
  });

  it("checks the caller's freshness inside the lock, after waiting for it", async () => {
    const canonical = createMatch("meadow-line", "online");
    const lock = createLocalLockRunner();
    const guarded = createOnlineDraftStore(lock);
    let releaseLock!: () => void;
    void lock(onlineDraftLockName(canonical.id, "sun"), () => new Promise<void>((resolve) => { releaseLock = resolve; }));
    let current = true;

    const write = guarded.replace(null, startDraft(canonical, canonical.id, "sun", SUN), () => current);
    await Promise.resolve();
    current = false; // the tab moved on while the write was queued
    releaseLock();

    expect(await write).toEqual({ ok: false, reason: "obsolete", current: null });
    expect(loadOnlineDraft(canonical.id, "sun")).toBeNull();
  });

  it("keeps drafts for different matches and seats independent", async () => {
    const first = createMatch("meadow-line", "online");
    const second = createMatch("meadow-line", "online");
    const a = await store.replace(null, startDraft(first, first.id, "sun", SUN));
    await store.replace(null, startDraft(second, second.id, "moon", SUN));
    await store.replace(null, startDraft(first, first.id, "moon", MOON));

    await store.remove(a.ok ? a.draft! : startDraft(first, first.id, "sun", SUN));

    expect(loadOnlineDraft(first.id, "sun")).toBeNull();
    expect(loadOnlineDraft(first.id, "moon")?.side).toBe("moon");
    expect(loadOnlineDraft(second.id, "moon")?.side).toBe("moon");
    expect(onlineDraftLockName(first.id, "sun")).not.toBe(onlineDraftLockName(first.id, "moon"));
  });

  it("orders canonical states so an obsolete snapshot never replaces a newer one", () => {
    const base = createMatch("meadow-line", "online");
    const turn3 = applyTurnActions(base, [{ type: "end_turn" }, { type: "end_turn" }]).state;
    const won = { ...turn3, winner: "sun" as const };

    expect(isOlderMatchState(base, turn3)).toBe(true);
    expect(isOlderMatchState(turn3, base)).toBe(false);
    expect(isOlderMatchState(turn3, won)).toBe(true);
    expect(isOlderMatchState(won, turn3)).toBe(false);
    expect(isOlderMatchState(turn3, turn3)).toBe(false);
  });
});
