// Runtime-agnostic turn submission logic. index.ts wires it to Supabase; tests wire it to an
// in-memory store. Keep this file free of Deno/npm: imports so Vitest can load it.
import { applyOnlineTurnSubmission, parseOnlineTurnActions, sameTurnActions } from "../../../src/engine/game.ts";
import type { MatchState, PlayerId, TurnAction } from "../../../src/engine/types.ts";

export type TurnResponseCode =
  | "accepted"
  | "duplicate"
  | "stale"
  | "finished"
  | "not_your_turn"
  | "rejected"
  | "submission_conflict"
  | "forbidden"
  | "not_found"
  | "bad_request";

export interface CanonicalMatch {
  state: MatchState;
  turnNumber: number;
  currentPlayer: PlayerId;
  winner: PlayerId | null;
}

export interface StoredSubmission {
  submittedBy: string | null;
  playerSide: PlayerId;
  turnNumber: number;
  actions: unknown;
}

export interface CommitTurnParams {
  matchId: string;
  userId: string;
  submissionId: string;
  expectedTurnNumber: number;
  actions: TurnAction[];
  resultingState: MatchState;
}

/** Mirrors the `outcome` values returned by public.commit_match_turn_v2. */
export type CommitOutcome =
  | "committed"
  | "duplicate"
  | "submission_conflict"
  | "stale"
  | "finished"
  | "not_your_turn"
  | "forbidden"
  | "not_found";

export interface TurnStore {
  getSeat(matchId: string, userId: string): Promise<PlayerId | null>;
  findSubmission(matchId: string, submissionId: string): Promise<StoredSubmission | null>;
  getMatch(matchId: string): Promise<CanonicalMatch | null>;
  /** Must lock the match, dedupe, check the expected version, and write atomically. */
  commitTurn(params: CommitTurnParams): Promise<{ outcome: CommitOutcome; match: CanonicalMatch | null }>;
}

export interface TurnHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function accepted(code: "accepted" | "duplicate", matchId: string, submissionId: string, match: CanonicalMatch): TurnHandlerResult {
  // Always the current canonical row, never a stored turn snapshot, so a late retry cannot
  // hand the client a board older than what the server already holds.
  return {
    status: 200,
    body: {
      accepted: true,
      code,
      matchId,
      submissionId,
      turnNumber: match.turnNumber,
      currentPlayer: match.currentPlayer,
      winner: match.winner,
      state: match.state
    }
  };
}

function refused(status: number, code: TurnResponseCode, error: string, match?: CanonicalMatch | null): TurnHandlerResult {
  return { status, body: match ? { error, code, state: match.state } : { error, code } };
}

const outcomeMessages: Record<Exclude<CommitOutcome, "committed" | "duplicate">, [number, string]> = {
  submission_conflict: [409, "This submission ID was already used for a different turn."],
  stale: [409, "The match moved on before this turn could be saved."],
  finished: [409, "The match is already finished."],
  not_your_turn: [409, "It is not your turn."],
  forbidden: [403, "You are not a player in this match."],
  not_found: [404, "Match not found."]
};

export async function handleTurnSubmission(body: unknown, userId: string, store: TurnStore): Promise<TurnHandlerResult> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const { matchId, submissionId, expectedTurnNumber } = input;

  if (typeof matchId !== "string" || !UUID_PATTERN.test(matchId)) {
    return refused(400, "bad_request", "matchId is required.");
  }
  if (typeof submissionId !== "string" || !UUID_PATTERN.test(submissionId)) {
    return refused(400, "bad_request", "submissionId must be a UUID.");
  }
  if (typeof expectedTurnNumber !== "number" || !Number.isInteger(expectedTurnNumber) || expectedTurnNumber < 1) {
    return refused(400, "bad_request", "expectedTurnNumber is required.");
  }
  const parsed = parseOnlineTurnActions(input.actions);
  if (!parsed.ok) {
    return refused(400, "bad_request", parsed.error);
  }

  const side = await store.getSeat(matchId, userId);
  if (!side) {
    return refused(403, "forbidden", "You are not a player in this match.");
  }

  // Read the version before resolving the submission ID. Any commit that makes this snapshot
  // stale is then already visible to the lookup below, so a concurrent identical request is
  // reported as a duplicate rather than stale. A commit landing after the lookup can only be
  // one this snapshot still allows, and commit_match_turn_v2 dedupes it under the row lock.
  const canonical = await store.getMatch(matchId);
  if (!canonical) {
    return refused(404, "not_found", "Match not found.");
  }

  // Idempotency before versioning: a retry of an accepted turn succeeds after the match moved on.
  const previous = await store.findSubmission(matchId, submissionId);
  if (previous) {
    // Re-read so the reply carries the current canonical state, not the pre-lookup snapshot.
    const match = await store.getMatch(matchId);
    if (!match) {
      return refused(404, "not_found", "Match not found.");
    }
    const sameContent =
      previous.submittedBy === userId &&
      previous.playerSide === side &&
      previous.turnNumber === expectedTurnNumber &&
      sameTurnActions(previous.actions, parsed.actions);
    return sameContent
      ? accepted("duplicate", matchId, submissionId, match)
      : refused(409, "submission_conflict", outcomeMessages.submission_conflict[1], match);
  }

  const applied = applyOnlineTurnSubmission(canonical.state, side, parsed.actions, expectedTurnNumber);
  if (!applied.ok) {
    return refused(applied.code === "rejected" ? 400 : 409, applied.code, applied.error, canonical);
  }

  const commit = await store.commitTurn({
    matchId,
    userId,
    submissionId,
    expectedTurnNumber,
    actions: applied.actions,
    resultingState: applied.state
  });

  if ((commit.outcome === "committed" || commit.outcome === "duplicate") && commit.match) {
    return accepted(commit.outcome === "committed" ? "accepted" : "duplicate", matchId, submissionId, commit.match);
  }
  if (commit.outcome === "committed" || commit.outcome === "duplicate") {
    throw new Error("Turn commit returned no match state.");
  }
  const [status, message] = outcomeMessages[commit.outcome];
  return refused(status, commit.outcome, message, commit.outcome === "forbidden" ? null : commit.match);
}
