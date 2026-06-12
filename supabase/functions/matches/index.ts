import { corsHeaders } from "../_shared/cors.ts";
import { ensurePlayerProfile, getServiceClient } from "../_shared/supabase.ts";
import { createMatch } from "../../../src/engine/game.ts";
import type { EconomyMode } from "../../../src/engine/types.ts";

function matchActionStatus(error: { message?: string }): number {
  const message = error.message?.toLowerCase?.() ?? "";
  if (message.includes("not found")) return 404;
  if (message.includes("already full") || message.includes("duplicate") || message.includes("unique")) return 409;
  return 500;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const action = body?.action as string | undefined;
    const supabase = getServiceClient();

    if (action === "create") {
      const mapId = String(body?.mapId ?? "").trim();
      if (!mapId) {
        return Response.json({ error: "mapId is required." }, { headers: corsHeaders, status: 400 });
      }

      const account = await ensurePlayerProfile(request, body?.guestName);
      const economyMode: EconomyMode = body?.rules?.economyMode === "skirmish" ? "skirmish" : "standard";
      const match = createMatch(mapId, "online", "normal", { economyMode });

      const { data: createdMatch, error: createError } = await supabase
        .rpc("create_online_match", {
          p_created_by: account.userId,
          p_map_id: match.mapId,
          p_invite_code: match.inviteCode,
          p_current_player: match.currentPlayer,
          p_turn_number: match.turnNumber,
          p_winner: match.winner,
          p_state: match
        })
        .single();

      if (createError) {
        throw createError;
      }

      return Response.json(
        {
          id: createdMatch.id,
          inviteCode: createdMatch.invite_code,
          side: "sun",
          state: createdMatch.state
        },
        { headers: corsHeaders }
      );
    }

    if (action === "join") {
      const inviteCode = String(body?.inviteCode ?? "").trim().toUpperCase();
      if (!inviteCode) {
        return Response.json({ error: "inviteCode is required." }, { headers: corsHeaders, status: 400 });
      }

      const account = await ensurePlayerProfile(request, body?.guestName);
      const { data: joinedMatch, error: joinError } = await supabase
        .rpc("join_online_match", {
          p_invite_code: inviteCode,
          p_user_id: account.userId
        })
        .single();

      if (joinError) {
        return Response.json(
          { error: joinError.message },
          { headers: corsHeaders, status: matchActionStatus(joinError) }
        );
      }

      return Response.json(
        {
          joined: true,
          id: joinedMatch.id,
          inviteCode: joinedMatch.invite_code,
          side: joinedMatch.side,
          state: joinedMatch.state
        },
        { headers: corsHeaders }
      );
    }

    if (action === "list") {
      const account = await ensurePlayerProfile(request, body?.guestName);
      const { data: seats, error: seatsError } = await supabase
        .from("match_players")
        .select("match_id, side")
        .eq("user_id", account.userId);

      if (seatsError) {
        throw seatsError;
      }

      if (!seats?.length) {
        return Response.json({ matches: [] }, { headers: corsHeaders });
      }

      const sideByMatchId = new Map(seats.map((seat) => [seat.match_id as string, seat.side as string]));
      const { data: matches, error: listError } = await supabase
        .from("matches")
        .select("id, map_id, invite_code, current_player, turn_number, winner, updated_at, state")
        .in("id", seats.map((seat) => seat.match_id as string))
        .order("updated_at", { ascending: false });

      if (listError) {
        throw listError;
      }

      return Response.json(
        {
          matches: (matches ?? []).map((entry) => ({
            id: entry.id,
            mapId: entry.map_id,
            inviteCode: entry.invite_code,
            currentPlayer: entry.current_player,
            turnNumber: entry.turn_number,
            winner: entry.winner,
            updatedAt: entry.updated_at,
            side: sideByMatchId.get(entry.id as string) ?? null,
            state: entry.state
          }))
        },
        { headers: corsHeaders }
      );
    }

    if (action === "get") {
      const matchId = String(body?.matchId ?? "").trim();
      if (!matchId) {
        return Response.json({ error: "matchId is required." }, { headers: corsHeaders, status: 400 });
      }

      const account = await ensurePlayerProfile(request, body?.guestName);
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

      const { data: matchRow, error: getError } = await supabase
        .from("matches")
        .select("id, map_id, invite_code, current_player, turn_number, winner, updated_at, state")
        .eq("id", matchId)
        .single();

      if (getError) {
        throw getError;
      }

      return Response.json(
        {
          id: matchRow.id,
          mapId: matchRow.map_id,
          inviteCode: matchRow.invite_code,
          currentPlayer: matchRow.current_player,
          turnNumber: matchRow.turn_number,
          winner: matchRow.winner,
          updatedAt: matchRow.updated_at,
          side: seat.side,
          state: matchRow.state
        },
        { headers: corsHeaders }
      );
    }

    return Response.json(
      {
        error: "Unsupported action",
        supported: ["create", "join", "list", "get"]
      },
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Match action failed.";
    return Response.json({ error: message }, { headers: corsHeaders, status: 500 });
  }
});
