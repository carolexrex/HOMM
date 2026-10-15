import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MatchState } from "../../src/engine";
import { localSupabase } from "./env";

/**
 * Read-only server checks for assertions. The service role bypasses RLS, so this is only used
 * to inspect what the Edge Functions committed, never to set up or change game state.
 */
let admin: SupabaseClient | null = null;

function adminClient() {
  const { apiUrl, serviceRoleKey } = localSupabase();
  admin ??= createClient(apiUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export interface TurnRow {
  turn_number: number;
  player_side: string;
  submission_id: string | null;
  submitted_by: string | null;
  actions: unknown[];
  /** `resulting_state.winner`: set only on the row that won the match. */
  winner: string | null;
}

export async function turnRows(matchId: string): Promise<TurnRow[]> {
  const { data, error } = await adminClient()
    .from("turns")
    .select("turn_number, player_side, submission_id, submitted_by, actions, winner:resulting_state->>winner")
    .eq("match_id", matchId)
    .order("turn_number");
  if (error) throw error;
  return data as TurnRow[];
}

export async function matchRow(matchId: string): Promise<{ turn_number: number; current_player: string; winner: string | null; state: MatchState }> {
  const { data, error } = await adminClient()
    .from("matches")
    .select("turn_number, current_player, winner, state")
    .eq("id", matchId)
    .single();
  if (error) throw error;
  return data as { turn_number: number; current_player: string; winner: string | null; state: MatchState };
}

/** A client acting as one signed-in player, with the anon key and that player's JWT. */
export function playerClient(accessToken: string): SupabaseClient {
  const { apiUrl, anonKey } = localSupabase();
  return createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}
