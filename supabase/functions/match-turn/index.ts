import { corsHeaders } from "../_shared/cors.ts";
import { ensurePlayerProfile, getServiceClient } from "../_shared/supabase.ts";
import { applyTurnActions } from "../../../src/engine/game.ts";
import type { MatchState, TurnAction } from "../../../src/engine/types.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const guestName = body?.guestName as string | undefined;
    const matchId = body?.matchId as string | undefined;
    const actions = Array.isArray(body?.actions) ? (body.actions as TurnAction[]) : [];

    if (!matchId) {
      return Response.json({ error: "matchId is required." }, { headers: corsHeaders, status: 400 });
    }
    if (!actions.length) {
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
    if ((matchRow.current_player as string) !== side) {
      return Response.json({ error: "It is not your turn." }, { headers: corsHeaders, status: 409 });
    }
    if (matchRow.winner) {
      return Response.json({ error: "The match is already finished." }, { headers: corsHeaders, status: 409 });
    }
    if (actions[actions.length - 1]?.type !== "end_turn") {
      return Response.json({ error: "Submitted online turns must end with end_turn." }, { headers: corsHeaders, status: 400 });
    }

    const canonical = matchRow.state as MatchState;
    const applied = applyTurnActions(canonical, actions);
    if (!applied.ok) {
      return Response.json(
        {
          error: applied.issue?.message ?? "Illegal turn submission.",
          issue: applied.issue ?? null,
          state: canonical
        },
        { headers: corsHeaders, status: 400 }
      );
    }

    const resultingState = applied.state;
    if (resultingState.currentPlayer === side && !resultingState.winner) {
      return Response.json(
        { error: "Turn submission did not pass control to the opponent.", state: canonical },
        { headers: corsHeaders, status: 400 }
      );
    }

    const { error: commitError } = await supabase.rpc("commit_match_turn", {
      p_match_id: matchId,
      p_player_side: side,
      p_turn_number: matchRow.turn_number,
      p_actions: actions,
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
