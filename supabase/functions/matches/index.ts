import { corsHeaders } from "../_shared/cors.ts";
import { ensurePlayerProfile, getServiceClient } from "../_shared/supabase.ts";
import { createMatch } from "../../../src/engine/game.ts";
import type { EconomyMode } from "../../../src/engine/types.ts";

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
        .from("matches")
        .insert({
          mode: "online",
          map_id: match.mapId,
          invite_code: match.inviteCode,
          current_player: match.currentPlayer,
          turn_number: match.turnNumber,
          winner: match.winner,
          state: match,
          created_by: account.userId
        })
        .select("id, invite_code, state, map_id, current_player, turn_number, winner, updated_at")
        .single();

      if (createError) {
        throw createError;
      }

      const { error: playerError } = await supabase.from("match_players").insert({
        match_id: createdMatch.id,
        user_id: account.userId,
        side: "sun"
      });

      if (playerError) {
        throw playerError;
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
      const { data: matchRow, error: matchError } = await supabase
        .from("matches")
        .select("id, invite_code, state, winner")
        .eq("invite_code", inviteCode)
        .maybeSingle();

      if (matchError) {
        throw matchError;
      }
      if (!matchRow) {
        return Response.json({ error: "Match not found." }, { headers: corsHeaders, status: 404 });
      }

      const { data: existingSeat, error: existingSeatError } = await supabase
        .from("match_players")
        .select("side")
        .eq("match_id", matchRow.id)
        .eq("user_id", account.userId)
        .maybeSingle();

      if (existingSeatError) {
        throw existingSeatError;
      }

      if (existingSeat) {
        return Response.json(
          {
            joined: true,
            id: matchRow.id,
            inviteCode: matchRow.invite_code,
            side: existingSeat.side,
            state: matchRow.state
          },
          { headers: corsHeaders }
        );
      }

      const { data: moonSeat, error: moonSeatError } = await supabase
        .from("match_players")
        .select("id")
        .eq("match_id", matchRow.id)
        .eq("side", "moon")
        .maybeSingle();

      if (moonSeatError) {
        throw moonSeatError;
      }

      if (moonSeat) {
        return Response.json({ error: "Match is already full." }, { headers: corsHeaders, status: 409 });
      }

      const { error: joinError } = await supabase.from("match_players").insert({
        match_id: matchRow.id,
        user_id: account.userId,
        side: "moon"
      });

      if (joinError) {
        throw joinError;
      }

      return Response.json(
        {
          joined: true,
          id: matchRow.id,
          inviteCode: matchRow.invite_code,
          side: "moon",
          state: matchRow.state
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
