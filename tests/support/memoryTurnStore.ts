import type { MatchState, PlayerId, TurnAction } from "../../src/engine";
import type { CanonicalMatch, CommitTurnParams, StoredSubmission, TurnStore } from "../../supabase/functions/match-turn/handler";

interface TurnRow extends StoredSubmission {
  submissionId: string;
  actions: TurnAction[];
}

/**
 * In-memory stand-in for the Supabase tables and public.commit_match_turn_v2. It mirrors the
 * SQL function's order of checks; a promise mutex plays the role of SELECT ... FOR UPDATE.
 * This verifies the Edge Function handler, not the SQL itself (see tests/db for that).
 */
export class MemoryTurnStore implements TurnStore {
  readonly seats = new Map<string, PlayerId>();
  readonly turns: TurnRow[] = [];
  match: MatchState;
  commitCalls = 0;
  /** Called inside the "lock" before the version check, to interleave concurrent requests. */
  beforeCommitCheck: (() => Promise<void>) | null = null;
  /**
   * Called at the start of every store call (before commitTurn takes the lock), so a test can
   * run another request to completion at that exact point of the handler.
   */
  beforeOperation: ((operation: "getSeat" | "findSubmission" | "getMatch" | "commitTurn") => Promise<void>) | null = null;
  private lock: Promise<void> = Promise.resolve();

  constructor(match: MatchState, seats: Record<string, PlayerId>) {
    this.match = structuredClone(match);
    for (const [userId, side] of Object.entries(seats)) {
      this.seats.set(userId, side);
    }
  }

  private canonical(): CanonicalMatch {
    const state = structuredClone(this.match);
    return { state, turnNumber: state.turnNumber, currentPlayer: state.currentPlayer, winner: state.winner };
  }

  async getSeat(matchId: string, userId: string) {
    await this.beforeOperation?.("getSeat");
    return matchId === this.match.id ? this.seats.get(userId) ?? null : null;
  }

  async findSubmission(matchId: string, submissionId: string) {
    await this.beforeOperation?.("findSubmission");
    const row = this.turns.find((turn) => matchId === this.match.id && turn.submissionId === submissionId);
    return row ? structuredClone(row) : null;
  }

  async getMatch(matchId: string) {
    await this.beforeOperation?.("getMatch");
    return matchId === this.match.id ? this.canonical() : null;
  }

  async commitTurn(params: CommitTurnParams) {
    await this.beforeOperation?.("commitTurn");
    this.commitCalls += 1;
    const release = this.acquire();
    await release.acquired;
    try {
      if (params.matchId !== this.match.id) return { outcome: "not_found" as const, match: null };
      const side = this.seats.get(params.userId);
      if (!side) return { outcome: "forbidden" as const, match: null };
      await this.beforeCommitCheck?.();

      const previous = this.turns.find((turn) => turn.submissionId === params.submissionId);
      if (previous) {
        const same =
          previous.submittedBy === params.userId &&
          previous.playerSide === side &&
          previous.turnNumber === params.expectedTurnNumber &&
          JSON.stringify(previous.actions) === JSON.stringify(params.actions);
        return { outcome: same ? "duplicate" as const : "submission_conflict" as const, match: this.canonical() };
      }
      if (this.match.winner) return { outcome: "finished" as const, match: this.canonical() };
      if (this.match.turnNumber !== params.expectedTurnNumber) return { outcome: "stale" as const, match: this.canonical() };
      if (this.match.currentPlayer !== side) return { outcome: "not_your_turn" as const, match: this.canonical() };
      if (this.turns.some((turn) => turn.turnNumber === params.expectedTurnNumber && turn.playerSide === side)) {
        throw new Error("duplicate key value violates unique constraint");
      }

      this.turns.push({
        submissionId: params.submissionId,
        submittedBy: params.userId,
        playerSide: side,
        turnNumber: params.expectedTurnNumber,
        actions: structuredClone(params.actions)
      });
      this.match = structuredClone(params.resultingState);
      return { outcome: "committed" as const, match: this.canonical() };
    } finally {
      release.release();
    }
  }

  private acquire() {
    let release!: () => void;
    const previous = this.lock;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { acquired: previous, release };
  }
}
