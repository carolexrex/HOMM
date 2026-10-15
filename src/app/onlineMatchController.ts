import type { MatchState, PlayerId, TurnAction } from "../engine";
import type { TurnSubmission, TurnSubmissionAccepted } from "../lib/online";
import {
  appendDraftAction,
  draftBoard,
  isOlderMatchState,
  markSubmitting,
  reconcileDraft,
  startDraft,
  submitDraft,
  type DraftReconciliation,
  type OnlineDraft,
  type SubmitDraftResult
} from "../lib/onlineDraft";
import type { DraftWriteResult, OnlineDraftStore } from "../lib/onlineDraftStore";
import { onlineDraftKey, type OnlineSession } from "../lib/storage";

/** Online board sync gate: moves and commits are only allowed while "ready". */
export type OnlineSync = "checking" | "ready" | "unreachable";

export interface ServerSnapshot {
  id: string;
  side: PlayerId;
  inviteCode?: string | null;
  state: MatchState;
}

export interface OnlineView {
  session: OnlineSession | null;
  /** In-memory copy of the stored draft for the session's seat; storage is authoritative. */
  draft: OnlineDraft | null;
  sync: OnlineSync;
  /** Synced, the player's turn, the match is open, and no submission is frozen. */
  canPlay: boolean;
}

export interface OnlineMatchControllerDeps {
  api: {
    getMatch(matchId: string): Promise<ServerSnapshot>;
    submitTurn(submission: TurnSubmission): Promise<TurnSubmissionAccepted>;
  };
  drafts: OnlineDraftStore;
  getUserId(): string | null;
  ui: {
    setBoard(board: MatchState): void;
    setMessage(message: string | null): void;
    setBusy(busy: boolean): void;
    clearSelection(): void;
  };
}

const pendingMessage = "It is saved on this device and will be resent safely when you tap Retry.";

/** What a local action was computed from. Its result is only stored and shown while all of it still holds. */
interface ActionContext {
  epoch: number;
  canonical: string | null;
  draftRevision: string | null;
}

/**
 * How a local action's locked write ended. `apply`: the result is fresh and the caller must
 * apply it now, in the same synchronous run as the check. Otherwise nothing may be applied;
 * `settled` completes once the outcome is handled (e.g. after adopting another tab's draft).
 */
type Confirmation = { apply: true; draft: OnlineDraft | null } | { apply: false; settled: Promise<void> };

/** A submission request on the network, shared by every operation that sends the same ID. */
interface Flight {
  submissionId: string;
  /** Sync ticket of the operation that will handle the answer. */
  owner: number;
  result: Promise<SubmitDraftResult>;
}

/**
 * Orchestrates one online match seat for one tab: syncing canonical state, recording and
 * submitting the draft, and following drafts written by other tabs. App.tsx renders its view.
 *
 * Invariants:
 * - The stored draft is the source of truth. After every reconciliation the in-memory draft is
 *   exactly what storage holds, so an obsolete pending submission cannot keep blocking play.
 * - Draft writes are compare-and-set under a cross-tab lock (see onlineDraftStore.ts). A tab
 *   that is behind is refused and adopts the stored draft, telling the player why.
 * - Canonical state never moves backwards, and a reply only removes the exact draft revision it
 *   was sent for.
 *
 * Freshness (every asynchronous result is checked before it changes anything):
 * - Local actions (move, heal, recruit, attack, End Turn, Undo Turn) capture the seat `epoch`,
 *   the canonical version, and the draft revision they were computed from. The capture is
 *   rechecked inside the draft lock before storage changes, and again before the result is
 *   applied to the board. `epoch` changes with the seat, including leaving and reopening the
 *   same match, so nothing queued before that can land afterwards.
 * - Sync operations (refresh, open, a submission) take a ticket. Only the newest ticket may set
 *   the sync gate, busy flag, messages, board, or in-memory draft; an older completion,
 *   successful or failed, is ignored. Seat changes invalidate every ticket.
 */
export class OnlineMatchController {
  private session: OnlineSession | null;
  private draft: OnlineDraft | null;
  private sync: OnlineSync;
  /** Newest canonical state seen for the session's match. */
  private canonical: MatchState | null = null;
  /** Changes with the seat; see "Freshness" above. */
  private epoch = 0;
  /** Ticket of the newest sync operation; see "Freshness" above. */
  private generation = 0;
  private flight: Flight | null = null;
  private writes = 0;
  private view: OnlineView;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: OnlineMatchControllerDeps, initial: { session: OnlineSession | null; draft: OnlineDraft | null; sync: OnlineSync }) {
    this.session = initial.session;
    this.draft = initial.draft;
    this.sync = initial.sync;
    this.view = this.buildView();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getView = () => this.view;

  /** True while a draft write is queued or holds the lock; input should be ignored until it finishes. */
  get isWriting() {
    return this.writes > 0;
  }

  isActive(matchId: string) {
    return this.session?.matchId === matchId;
  }

  /** Switches the active seat. Leaving a match keeps its stored draft for a later resume. */
  select(session: OnlineSession | null) {
    const seatChanged = this.session?.matchId !== session?.matchId || this.session?.side !== session?.side;
    const sessionChanged = seatChanged || this.session?.inviteCode !== session?.inviteCode;
    if (seatChanged) {
      // Everything queued or in progress for the previous seat (or an earlier visit to this one) is obsolete.
      this.epoch += 1;
      this.generation += 1;
      this.canonical = null;
      this.draft = session ? this.deps.drafts.load(session.matchId, session.side) : null;
    }
    if (sessionChanged) {
      this.session = session;
      this.publish();
    }
  }

  leave() {
    this.select(null);
    this.setSync("ready");
    // Obsolete operations no longer release the busy flag, so leaving does.
    this.deps.ui.setBusy(false);
  }

  /** Opens a server snapshot (create, join, resume) and finishes any pending submission. */
  async open(snapshot: ServerSnapshot) {
    this.select({
      matchId: snapshot.id,
      side: snapshot.side,
      inviteCode: snapshot.inviteCode === undefined ? (this.isActive(snapshot.id) ? this.session?.inviteCode ?? null : null) : snapshot.inviteCode
    });
    const ticket = this.beginSync();
    try {
      return await this.adopt(snapshot, ticket);
    } finally {
      this.endSync(ticket);
    }
  }

  /** Fetches canonical state and reconciles. On failure the board stays locked. */
  async refresh(matchId: string, announce = false): Promise<boolean> {
    if (!this.isActive(matchId)) {
      return false;
    }
    if (this.flight && this.owns(this.flight.owner)) {
      // This seat's submission is on the network and its answer carries canonical state. A
      // parallel fetch could read the board from before that commit, so let the answer decide.
      return false;
    }
    const ticket = this.beginSync();
    try {
      return await this.syncUnder(ticket, matchId, announce);
    } finally {
      this.endSync(ticket);
    }
  }

  /**
   * Records an action the engine already accepted on the displayed board, then calls `apply`
   * to show the engine's result. `apply` runs only if the action was stored and the board it
   * was computed from is still current; returns whether it ran.
   */
  async recordAction(action: TurnAction, apply: () => void): Promise<boolean> {
    const seat = this.playableSeat();
    if (!seat) {
      return false;
    }
    const context = this.captureContext();
    const expected = this.draft;
    const next = appendDraftAction(expected ?? startDraft(seat.canonical, seat.session.matchId, seat.session.side, this.deps.getUserId()), action);
    const written = await this.write(() => this.deps.drafts.replace(expected, next, () => this.isFresh(context)));
    // No await from here until the result is applied: it is checked and applied in one run.
    const confirmed = this.confirmWrite(written, context, "your last action was not applied");
    if (!confirmed.apply) {
      await confirmed.settled;
      return false;
    }
    this.setDraft(confirmed.draft);
    apply();
    return true;
  }

  /**
   * Freezes the draft with `finalAction` (end_turn, or a winning attack) and sends it. The
   * frozen draft is stored before sending so a reload or another tab resends the same ID.
   */
  async submit(finalAction?: TurnAction) {
    const seat = this.playableSeat();
    if (!seat) {
      return;
    }
    const context = this.captureContext();
    const expected = this.draft;
    const frozen = markSubmitting(expected ?? startDraft(seat.canonical, seat.session.matchId, seat.session.side, this.deps.getUserId()), finalAction);
    const written = await this.write(() => this.deps.drafts.replace(expected, frozen, () => this.isFresh(context)));
    // No await from here until the request is on the network: checked and sent in one run.
    const confirmed = this.confirmWrite(written, context, "your turn was not sent");
    if (!confirmed.apply) {
      await confirmed.settled;
      return;
    }
    const stored = confirmed.draft!; // a replace always stores a draft
    this.setDraft(stored);
    const ticket = this.beginSync();
    try {
      await this.send(stored, ticket);
    } finally {
      this.endSync(ticket);
    }
  }

  /** Undo Turn: drops the unsent draft and shows the canonical board. */
  async discard() {
    const draft = this.draft;
    if (this.isWriting || !draft || draft.status !== "editing" || !this.isActive(draft.matchId) || this.sync !== "ready") {
      return;
    }
    const context = this.captureContext();
    const removed = await this.write(() => this.deps.drafts.remove(draft, () => this.isFresh(context)));
    // No await from here until the canonical board is shown: checked and applied in one run.
    const confirmed = this.confirmWrite(removed, context, "nothing was undone");
    if (!confirmed.apply) {
      await confirmed.settled;
      return;
    }
    this.setDraft(null);
    this.deps.ui.setBoard(this.canonical ?? draft.baseState);
    this.deps.ui.clearSelection();
    this.deps.ui.setMessage("Discarded your unsent moves for this turn.");
  }

  /** Call for `storage` events. Another tab changed this seat's draft: follow it. */
  handleStorageChange(key: string | null) {
    const session = this.session;
    if (!session || (key !== null && key !== onlineDraftKey(session.matchId, session.side))) {
      return Promise.resolve();
    }
    const stored = this.deps.drafts.load(session.matchId, session.side);
    if ((stored?.revision ?? null) === (this.draft?.revision ?? null)) {
      return Promise.resolve();
    }
    return this.followStoredDraft(
      stored?.status === "submitting"
        ? "This turn was sent from another tab."
        : stored
          ? "Updated with moves made in another tab."
          : null
    );
  }

  private playableSeat() {
    const { session, canonical } = this;
    if (this.isWriting) {
      return null;
    }
    if (!session || !canonical || !this.view.canPlay) {
      this.deps.ui.setMessage("This board is not synced with the server. Tap Refresh first.");
      return null;
    }
    return { session, canonical };
  }

  private async write(operation: () => Promise<DraftWriteResult>) {
    this.writes += 1;
    try {
      return await operation();
    } finally {
      this.writes -= 1;
    }
  }

  private captureContext(): ActionContext {
    return { epoch: this.epoch, canonical: canonicalVersion(this.canonical), draftRevision: revisionOf(this.draft) };
  }

  private isFresh(context: ActionContext) {
    return (
      context.epoch === this.epoch &&
      context.canonical === canonicalVersion(this.canonical) &&
      context.draftRevision === revisionOf(this.draft)
    );
  }

  /**
   * Shared tail of a local action's locked write, after its last await. Synchronous on
   * purpose: when it answers `apply`, the context was confirmed fresh in this same run, and
   * the caller must change controller state before awaiting anything, so no other operation
   * (Refresh, opening another match, leave and reopen) can run in between.
   * - Left the board meanwhile: silent. A stored draft is reconciled when the match is reopened.
   * - Context changed before the write: nothing was stored; the player is told the action was dropped.
   * - Context changed after the write: whatever changed it reconciled storage afterwards and
   *   reports its own outcome, so this result is dropped silently.
   * - Another tab changed the draft: adopt it and explain.
   */
  private confirmWrite(written: DraftWriteResult, context: ActionContext, consequence: string): Confirmation {
    const dropped: Confirmation = { apply: false, settled: Promise.resolve() };
    if (context.epoch !== this.epoch) {
      return dropped;
    }
    if (written.ok) {
      return this.isFresh(context) ? { apply: true, draft: written.draft } : dropped;
    }
    if (written.reason === "obsolete") {
      this.deps.ui.clearSelection();
      this.deps.ui.setMessage(`The board was updated before this was saved, so ${consequence}. Check the board and try again.`);
      return dropped;
    }
    return { apply: false, settled: this.followStoredDraft(conflictMessage(written.current, consequence)) };
  }

  private beginSync() {
    this.generation += 1;
    this.setSync("checking");
    this.deps.ui.setBusy(true);
    this.deps.ui.clearSelection();
    return this.generation;
  }

  private endSync(ticket: number) {
    if (this.owns(ticket)) {
      this.deps.ui.setBusy(false);
    }
  }

  private owns(ticket: number) {
    return ticket === this.generation;
  }

  /** Fetches canonical state and reconciles under an existing ticket. */
  private async syncUnder(ticket: number, matchId: string, announce = false): Promise<boolean> {
    const { ui } = this.deps;
    try {
      const latest = await this.deps.api.getMatch(matchId);
      const reconciliation = await this.adopt(latest, ticket);
      if (!reconciliation || !this.owns(ticket)) {
        return false;
      }
      if (announce && reconciliation.kind === "none") {
        const { winner, players, currentPlayer } = latest.state;
        ui.setMessage(
          winner
            ? `Refreshed: ${players[winner].name} won.`
            : latest.side === currentPlayer ? "Refreshed: your turn." : "Refreshed: waiting for opponent."
        );
      } else if (announce && reconciliation.kind === "resume") {
        ui.setMessage(`Refreshed: your ${reconciliation.draft.actions.length} unsent move(s) are kept until End Turn.`);
      }
      return true;
    } catch (error) {
      // An older request failing after a newer one succeeded must not lock the board again.
      if (this.owns(ticket)) {
        this.setSync("unreachable");
        const reason = error instanceof Error ? error.message : "Could not reach the server.";
        const draft = this.draft;
        ui.setMessage(
          draft?.status === "submitting"
            ? `Turn pending: ${reason} ${pendingMessage}`
            : draft?.actions.length
              ? `Could not sync: ${reason} Your ${draft.actions.length} unsent move(s) are saved on this device. Tap Refresh.`
              : `Could not sync: ${reason} Tap Refresh before playing.`
        );
      }
      return false;
    }
  }

  /**
   * Aligns this tab with whatever another tab stored. If the stored draft builds on the
   * canonical turn this tab knows, the board is rebuilt locally; otherwise this tab is
   * behind (or the draft was settled by a server answer) and refetches canonical state,
   * under `ticket` when called from an operation that owns one.
   */
  private async followStoredDraft(note: string | null, ticket?: number) {
    const session = this.session;
    if (!session) {
      return;
    }
    const stored = this.deps.drafts.load(session.matchId, session.side);
    const canonical = this.canonical;
    this.setDraft(stored);
    this.deps.ui.clearSelection();
    if (stored && canonical && !canonical.winner && stored.baseTurnNumber === canonical.turnNumber && stored.side === canonical.currentPlayer) {
      this.deps.ui.setBoard(draftBoard(stored, canonical) ?? canonical);
      if (note) this.deps.ui.setMessage(note);
      return;
    }
    if (canonical) {
      this.deps.ui.setBoard(canonical);
    }
    const synced = ticket === undefined ? await this.refresh(session.matchId) : await this.syncUnder(ticket, session.matchId);
    if (note && synced) {
      this.deps.ui.setMessage(note);
    }
  }

  /** Reconciles a snapshot, then finishes an uncertain submission by resending its ID. */
  private async adopt(snapshot: ServerSnapshot, ticket: number) {
    const reconciliation = await this.applySnapshot(snapshot, ticket);
    if (reconciliation?.kind === "resend") {
      await this.send(reconciliation.draft, ticket);
    }
    return reconciliation;
  }

  /**
   * Adopts canonical state for the active seat and reconciles the stored draft against it.
   * Every outcome leaves the in-memory draft equal to the stored one. Returns null when
   * `ticket` is no longer the newest operation (or the seat changed).
   */
  private async applySnapshot(snapshot: ServerSnapshot, ticket: number): Promise<DraftReconciliation | null> {
    if (!this.owns(ticket) || !this.isActive(snapshot.id)) {
      return null;
    }
    this.select({ matchId: snapshot.id, side: snapshot.side, inviteCode: snapshot.inviteCode === undefined ? this.session?.inviteCode ?? null : snapshot.inviteCode });
    if (!this.canonical || !isOlderMatchState(snapshot.state, this.canonical)) {
      this.canonical = snapshot.state;
    }

    let discarded: Extract<DraftReconciliation, { kind: "discard" }> | null = null;
    // A discard is a locked write; if another tab changes the draft meanwhile, reconcile again.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!this.owns(ticket) || !this.canonical) {
        return null;
      }
      const canonical = this.canonical;
      const stored = this.deps.drafts.load(snapshot.id, snapshot.side);
      const reconciliation = reconcileDraft(stored, canonical, { matchId: snapshot.id, side: snapshot.side, userId: this.deps.getUserId() });
      if (reconciliation.kind === "discard" && stored) {
        discarded = reconciliation;
        await this.deps.drafts.remove(stored);
        continue;
      }
      switch (reconciliation.kind) {
        case "none":
        case "discard":
          this.draft = null;
          this.deps.ui.setBoard(canonical);
          this.sync = "ready";
          break;
        case "resume":
          this.draft = reconciliation.draft;
          this.deps.ui.setBoard(reconciliation.board);
          this.sync = "ready";
          break;
        case "resend":
          this.draft = reconciliation.draft;
          this.deps.ui.setBoard(draftBoard(reconciliation.draft) ?? canonical);
          break;
      }
      // Draft, sync, and canonical turn change together; publish once so canPlay is consistent.
      this.publish();
      if (discarded && reconciliation.kind !== "resend") {
        this.deps.ui.setMessage(discarded.reason);
        return reconciliation.kind === "none" ? discarded : reconciliation;
      }
      return reconciliation;
    }
    if (!this.owns(ticket)) {
      return null;
    }
    this.setDraft(this.deps.drafts.load(snapshot.id, snapshot.side));
    this.setSync("unreachable");
    this.deps.ui.setMessage("Your moves keep changing in another tab. Tap Refresh.");
    return null;
  }

  /**
   * Sends a frozen draft under `ticket`. Only a definitive answer removes it, and only that
   * exact revision; a lost response keeps it so the next attempt reuses the same submission ID.
   */
  private async send(draft: OnlineDraft, ticket: number) {
    const { matchId, side } = draft;
    const { ui } = this.deps;
    let flight = this.flight;
    if (flight?.submissionId === draft.submissionId) {
      // Already on the network (e.g. sent before leaving and reopening this match): share its
      // answer rather than sending twice, and handle it under this newer ticket.
      flight.owner = ticket;
    } else {
      const started: Flight = { submissionId: draft.submissionId!, owner: ticket, result: submitDraft(draft, this.deps.api.submitTurn) };
      const clear = () => {
        if (this.flight === started) this.flight = null;
      };
      // Registered first, so the flight is cleared before anyone handles the answer.
      void started.result.then(clear, clear);
      this.flight = flight = started;
    }
    const result = await flight.result;
    if (result.kind !== "uncertain") {
      // Server truth, so it applies even if this operation is obsolete; exact revision only.
      await this.deps.drafts.remove(draft);
    }
    if (!this.owns(ticket)) {
      return;
    }

    if (result.kind === "uncertain") {
      if ((this.deps.drafts.load(matchId, side)?.revision ?? null) !== draft.revision) {
        // Another tab already settled this submission; this late failure is obsolete.
        await this.followStoredDraft(null, ticket);
        return;
      }
      this.setSync("unreachable");
      ui.setMessage(`Turn pending: ${result.message} ${pendingMessage}`);
      return;
    }

    if (result.kind === "accepted") {
      const committed = result.response;
      if (!(await this.applySnapshot({ id: matchId, side, state: committed.state }, ticket))) {
        return;
      }
      const outcome = committed.winner
        ? `${committed.state.players[committed.winner as PlayerId].name} won.`
        : committed.currentPlayer === side
          ? "Your turn again."
          : "Waiting for opponent.";
      ui.setMessage(
        committed.code === "duplicate"
          ? `Turn accepted (it had already been saved before the connection dropped). ${outcome}`
          : `Turn accepted. ${outcome}`
      );
      return;
    }

    const explanation = result.reason === "stale"
      ? `Turn not accepted, the match had moved on: ${result.message}`
      : `Turn rejected and discarded: ${result.message}`;
    if (result.state && (await this.applySnapshot({ id: matchId, side, state: result.state }, ticket))) {
      ui.setMessage(`${explanation} Showing the latest board.`);
      return;
    }
    if (!this.owns(ticket)) {
      return;
    }
    // No canonical state in the response: never fall back to the discarded optimistic board.
    this.setDraft(this.deps.drafts.load(matchId, side));
    ui.setBoard(this.canonical ?? draft.baseState);
    const synced = await this.syncUnder(ticket, matchId);
    if (this.owns(ticket)) {
      ui.setMessage(synced ? `${explanation} Showing the latest board.` : `${explanation} Could not load the latest board. Tap Refresh before playing.`);
    }
  }

  private setDraft(draft: OnlineDraft | null) {
    if (this.draft !== draft) {
      this.draft = draft;
      this.publish();
    }
  }

  private setSync(sync: OnlineSync) {
    if (this.sync !== sync) {
      this.sync = sync;
      this.publish();
    }
  }

  private buildView(): OnlineView {
    const { session, draft, sync, canonical } = this;
    return {
      session,
      draft,
      sync,
      canPlay: Boolean(
        session &&
        canonical &&
        !canonical.winner &&
        canonical.currentPlayer === session.side &&
        sync === "ready" &&
        draft?.status !== "submitting"
      )
    };
  }

  private publish() {
    this.view = this.buildView();
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** Canonical versions only change by committing a turn (turn number) or winning. */
function canonicalVersion(state: MatchState | null) {
  return state ? `${state.turnNumber}:${state.currentPlayer}:${state.winner ?? ""}` : null;
}

function revisionOf(draft: OnlineDraft | null) {
  return draft ? draft.revision ?? "" : null;
}

function conflictMessage(current: OnlineDraft | null, consequence: string) {
  if (current?.status === "submitting") {
    return `This turn was already sent from another tab, so ${consequence}.`;
  }
  return current
    ? `This turn was changed in another tab. Its moves are shown here, and ${consequence}.`
    : `Your unsent moves were changed in another tab, so ${consequence}.`;
}
