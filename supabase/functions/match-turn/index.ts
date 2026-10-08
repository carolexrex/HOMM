import { corsHeaders } from "../_shared/cors.ts";
import { ensurePlayerProfile, getServiceClient } from "../_shared/supabase.ts";
import { applyOnlineTurnSubmission } from "../../../src/engine/game.ts";
import type { MatchState } from "../../../src/engine/types.ts";

const MAX_TURN_BODY_CHARS = 64 * 1024;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_TURN_BODY_CHARS) {
      return Response.json({ error: "Turn submission is too large." }, { headers: corsHeaders, status: 413 });
    }
    const body = JSON.parse(rawBody);
    const guestName = body?.guestName as string | undefined;
    const matchId = body?.matchId as string | undefined;
    const actions = body?.actions as unknown;

    if (!matchId) {
      return Response.json({ error: "matchId is required." }, { headers: corsHeaders, status: 400 });
    }
    if (!Array.isArray(actions) || !actions.length) {
      return Response.json({ error: "actions are required." }, { headers: corsHeaders, status: 400 });
    }

    const account = await ensurePlayerProfile(request, guestName);
    const supabase = getServiceClient();

    const { data: seat, error: seatError } = await supabase
      .from("match_players")
      .select("side")
      .eq("match_id", matchId)
      .eq("user_id", account.userId)
      .maybeSingle();

    if (seatError) {
      throw seatError;
    }
    if (!seat) {
      return Response.json({ error: "You are not a player in this match." }, { headers: corsHeaders, status: 403 });
    }

    const { data: matchRow, error: matchError } = await supabase
      .from("matches")
      .select("id, state, current_player, turn_number, winner")
      .eq("id", matchId)
      .single();

    if (matchError) {
      throw matchError;
    }

    const side = seat.side as "sun" | "moon";
    const canonical = matchRow.state as MatchState;
    const applied = applyOnlineTurnSubmission(canonical, side, actions);
    if (!applied.ok) {
      return Response.json(
        {
          error: applied.error,
          state: canonical
        },
        { headers: corsHeaders, status: applied.error === "It is not your turn." || applied.error === "The match is already finished." ? 409 : 400 }
      );
    }

    const resultingState = applied.state;

    const { error: commitError } = await supabase.rpc("commit_match_turn", {
      p_match_id: matchId,
      p_player_side: side,
      p_turn_number: matchRow.turn_number,
      p_actions: applied.actions,
      p_resulting_state: resultingState,
      p_next_current_player: resultingState.currentPlayer,
      p_next_turn_number: resultingState.turnNumber,
      p_winner: resultingState.winner
    });

    if (commitError) {
      const message = commitError.message?.toLowerCase?.() ?? "";
      const status = message.includes("duplicate") || message.includes("unique") || message.includes("changed before turn commit") ? 409 : 500;
      return Response.json({ error: commitError.message }, { headers: corsHeaders, status });
    }

    return Response.json(
      {
        accepted: true,
        matchId,
        turnNumber: resultingState.turnNumber,
        currentPlayer: resultingState.currentPlayer,
        winner: resultingState.winner,
        state: resultingState
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Turn submission failed.";
    return Response.json({ error: message }, { headers: corsHeaders, status: 500 });
  }
});
