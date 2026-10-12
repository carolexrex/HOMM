import { corsHeaders } from "../_shared/cors.ts";
import { ensurePlayerProfile, getServiceClient } from "../_shared/supabase.ts";
import type { MatchState, PlayerId } from "../../../src/engine/types.ts";
import { handleTurnSubmission, type CanonicalMatch, type CommitOutcome, type TurnStore } from "./handler.ts";

const MAX_TURN_BODY_CHARS = 64 * 1024;

function toCanonical(row: { state: unknown; turn_number: number; current_player: string; winner: string | null }): CanonicalMatch {
  return {
    state: row.state as MatchState,
    turnNumber: row.turn_number,
    currentPlayer: row.current_player as PlayerId,
    winner: row.winner as PlayerId | null
  };
}

function createSupabaseTurnStore(): TurnStore {
  const supabase = getServiceClient();
  return {
    async getSeat(matchId, userId) {
      const { data, error } = await supabase
        .from("match_players")
        .select("side")
        .eq("match_id", matchId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data?.side as PlayerId | undefined) ?? null;
    },
    async findSubmission(matchId, submissionId) {
      const { data, error } = await supabase
        .from("turns")
        .select("submitted_by, player_side, turn_number, actions")
        .eq("match_id", matchId)
        .eq("submission_id", submissionId)
        .maybeSingle();
      if (error) throw error;
      return data
        ? {
            submittedBy: data.submitted_by as string | null,
            playerSide: data.player_side as PlayerId,
            turnNumber: data.turn_number as number,
            actions: data.actions
          }
        : null;
    },
    async getMatch(matchId) {
      const { data, error } = await supabase
        .from("matches")
        .select("state, current_player, turn_number, winner")
        .eq("id", matchId)
        .maybeSingle();
      if (error) throw error;
      return data ? toCanonical(data) : null;
    },
    async commitTurn(params) {
      const { data, error } = await supabase
        .rpc("commit_match_turn_v2", {
          p_match_id: params.matchId,
          p_user_id: params.userId,
          p_submission_id: params.submissionId,
          p_expected_turn_number: params.expectedTurnNumber,
          p_actions: params.actions,
          p_resulting_state: params.resultingState,
          p_next_current_player: params.resultingState.currentPlayer,
          p_next_turn_number: params.resultingState.turnNumber,
          p_winner: params.resultingState.winner
        })
        .single();
      if (error) throw error;
      const row = data as {
        outcome: CommitOutcome;
        match_state: unknown;
        match_turn_number: number | null;
        match_current_player: string | null;
        match_winner: string | null;
      };
      return {
        outcome: row.outcome,
        match: row.match_state
          ? toCanonical({
              state: row.match_state,
              turn_number: row.match_turn_number ?? 0,
              current_player: row.match_current_player ?? "sun",
              winner: row.match_winner
            })
          : null
      };
    }
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_TURN_BODY_CHARS) {
      return Response.json({ error: "Turn submission is too large.", code: "bad_request" }, { headers: corsHeaders, status: 413 });
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: "Request body must be JSON.", code: "bad_request" }, { headers: corsHeaders, status: 400 });
    }

    const guestName = (body as { guestName?: unknown } | null)?.guestName;
    let account: Awaited<ReturnType<typeof ensurePlayerProfile>>;
    try {
      account = await ensurePlayerProfile(request, typeof guestName === "string" ? guestName : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/auth/i.test(message)) {
        return Response.json({ error: message, code: "unauthorized" }, { headers: corsHeaders, status: 401 });
      }
      throw error;
    }
    const result = await handleTurnSubmission(body, account.userId, createSupabaseTurnStore());
    return Response.json(result.body, { headers: corsHeaders, status: result.status });
  } catch (error) {
    // 5xx means "outcome unknown" to the client, which keeps the draft and retries with the same ID.
    const message = error instanceof Error ? error.message : "Turn submission failed.";
    return Response.json({ error: message, code: "server_error" }, { headers: corsHeaders, status: 500 });
  }
});
