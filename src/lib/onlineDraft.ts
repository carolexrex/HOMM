import { applyTurnActions, type MatchState, type PlayerId, type TurnAction } from "../engine";
import { OnlineRequestError, type TurnSubmission, type TurnSubmissionAccepted } from "./online";

/**
 * The local, uncommitted part of an online turn.
 * - "editing": actions are queued locally and have never been sent.
 * - "submitting": the turn was sent (or is about to be) with `submissionId`; the outcome is
 *   unknown until the server answers. The draft is frozen and every retry reuses the ID.
 */
export type OnlineDraftStatus = "editing" | "submitting";

export interface OnlineDraft {
  matchId: string;
  side: PlayerId;
  userId: string | null;
  /** Canonical turn number the draft was planned from; sent as expectedTurnNumber. */
  baseTurnNumber: number;
  /** Canonical state at baseTurnNumber, used to rebuild the board without a network. */
  baseState: MatchState;
  actions: TurnAction[];
  submissionId: string | null;
  status: OnlineDraftStatus;
  /**
   * Stamped with a fresh value by every stored write (see onlineDraftStore.ts). A tab may only
   * change the stored draft while it holds the latest revision. Unset until first stored.
   */
  revision?: string;
}

export function startDraft(canonical: MatchState, matchId: string, side: PlayerId, userId: string | null): OnlineDraft {
  return {
    matchId,
    side,
    userId,
    baseTurnNumber: canonical.turnNumber,
    baseState: structuredClone(canonical),
    actions: [],
    submissionId: null,
    status: "editing"
  };
}

export function appendDraftAction(draft: OnlineDraft, action: TurnAction): OnlineDraft {
  if (draft.status !== "editing") {
    throw new Error("A submitted turn cannot be changed.");
  }
  return { ...draft, actions: [...draft.actions, action] };
}

/** Freezes the draft for sending. The submission ID is minted once and reused by every retry. */
export function markSubmitting(draft: OnlineDraft, finalAction?: TurnAction): OnlineDraft {
  if (draft.status === "submitting") {
    return draft;
  }
  return {
    ...draft,
    actions: finalAction ? [...draft.actions, finalAction] : draft.actions,
    submissionId: crypto.randomUUID(),
    status: "submitting"
  };
}

export function toSubmission(draft: OnlineDraft): TurnSubmission {
  if (draft.status !== "submitting" || !draft.submissionId) {
    throw new Error("Only a submitted draft can be sent.");
  }
  return {
    matchId: draft.matchId,
    submissionId: draft.submissionId,
    expectedTurnNumber: draft.baseTurnNumber,
    actions: draft.actions
  };
}

/**
 * The board to show for a draft. A submitting draft shows the board as it was when the
 * player committed (before end_turn or the winning blow), since the result is unconfirmed.
 */
export function draftBoard(draft: OnlineDraft, base: MatchState = draft.baseState): MatchState | null {
  const actions = draft.status === "submitting" ? draft.actions.slice(0, -1) : draft.actions;
  const replayed = applyTurnActions(base, actions);
  return replayed.ok ? replayed.state : null;
}

export type DraftReconciliation =
  | { kind: "none" }
  | { kind: "resume"; draft: OnlineDraft; board: MatchState }
  | { kind: "resend"; draft: OnlineDraft }
  | { kind: "discard"; reason: string };

/** Decides what to do with a stored draft once the canonical state is known. */
export function reconcileDraft(
  draft: OnlineDraft | null,
  canonical: MatchState,
  seat: { matchId: string; side: PlayerId; userId: string | null }
): DraftReconciliation {
  if (!draft) {
    return { kind: "none" };
  }
  if (draft.matchId !== seat.matchId || draft.side !== seat.side || (draft.userId && seat.userId && draft.userId !== seat.userId)) {
    return { kind: "discard", reason: "Unsent moves from a different player on this device were discarded." };
  }
  if (draft.status === "submitting") {
    // Only the server knows whether it was committed; resending with the same ID is safe.
    return { kind: "resend", draft };
  }
  if (canonical.winner) {
    return { kind: "discard", reason: "Your unsent moves were discarded because the match has finished." };
  }
  if (canonical.turnNumber !== draft.baseTurnNumber || canonical.currentPlayer !== draft.side) {
    return {
      kind: "discard",
      reason: `Your unsent moves from turn ${draft.baseTurnNumber} were discarded because the match is now on turn ${canonical.turnNumber}.`
    };
  }
  // Same version means same canonical state, so the replay matches what the player saw.
  const board = draftBoard(draft, canonical);
  if (!board) {
    return { kind: "discard", reason: "Your unsent moves no longer apply to the server's board and were discarded." };
  }
  return { kind: "resume", draft: { ...draft, baseState: structuredClone(canonical) }, board };
}

/** True when `candidate` is behind `known`. Turn numbers only grow, and a winner is terminal. */
export function isOlderMatchState(candidate: Pick<MatchState, "turnNumber" | "winner">, known: Pick<MatchState, "turnNumber" | "winner">): boolean {
  return candidate.turnNumber < known.turnNumber || (candidate.turnNumber === known.turnNumber && !candidate.winner && Boolean(known.winner));
}

export type SubmitFailure =
  /** The server definitively did not commit this draft; it must be dropped. */
  | { kind: "settled"; reason: "stale" | "rejected" | "forbidden"; message: string; state?: MatchState }
  /** No definitive answer; the draft must be kept and resent with the same submission ID. */
  | { kind: "uncertain"; message: string };

export function classifySubmitError(error: unknown): SubmitFailure {
  const message = error instanceof Error ? error.message : "Online turn submission failed.";
  if (!(error instanceof OnlineRequestError) || error.status === undefined) {
    return { kind: "uncertain", message };
  }
  const { status, code, state } = error;
  // 401 means the request was never processed; 408/429/5xx may or may not have been.
  if (status < 400 || status >= 500 || status === 401 || status === 408 || status === 429) {
    return { kind: "uncertain", message };
  }
  if (code === "stale" || code === "finished" || code === "not_your_turn") {
    return { kind: "settled", reason: "stale", message, state };
  }
  if (code === "forbidden" || code === "not_found" || status === 403 || status === 404) {
    return { kind: "settled", reason: "forbidden", message };
  }
  return { kind: "settled", reason: "rejected", message, state };
}

export type SubmitDraftResult = { kind: "accepted"; response: TurnSubmissionAccepted } | SubmitFailure;

/**
 * Sends a frozen draft and classifies the answer. The caller removes the stored copy only
 * after "accepted" or "settled"; on "uncertain" it must keep it so a retry reuses the ID.
 */
export async function submitDraft(
  draft: OnlineDraft,
  send: (submission: TurnSubmission) => Promise<TurnSubmissionAccepted>
): Promise<SubmitDraftResult> {
  try {
    return { kind: "accepted", response: await send(toSubmission(draft)) };
  } catch (error) {
    return classifySubmitError(error);
  }
}
