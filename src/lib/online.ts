import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EconomyMode, MatchState, TurnAction } from "../engine";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export interface OnlineApi {
  configured: boolean;
  ensurePlayerSession(guestName?: string): Promise<{ id: string; displayName: string; isGuest: boolean }>;
  createMatch(mapId: string, rules: { economyMode: EconomyMode }, guestName?: string): Promise<{ id: string; inviteCode: string | null; side: "sun"; state: MatchState }>;
  joinMatch(inviteCode: string, guestName?: string): Promise<{ joined: true; id: string; inviteCode: string | null; side: "sun" | "moon"; state: MatchState }>;
  listMatches(guestName?: string): Promise<Array<{ id: string; mapId: string; inviteCode: string | null; currentPlayer: string; turnNumber: number; winner: string | null; updatedAt: string; side: "sun" | "moon" | null; state: MatchState }>>;
  getMatch(matchId: string, guestName?: string): Promise<{ id: string; mapId: string; inviteCode: string | null; currentPlayer: string; turnNumber: number; winner: string | null; updatedAt: string; side: "sun" | "moon"; state: MatchState }>;
  submitTurn(matchId: string, actions: TurnAction[], guestName?: string): Promise<{ accepted: true; matchId: string; turnNumber: number; currentPlayer: string; winner: string | null; state: MatchState }>;
}

let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (!url || !anonKey) {
    return null;
  }
  if (!cachedClient) {
    cachedClient = createClient(url, anonKey);
  }
  return cachedClient;
}

export function createOnlineApi(): OnlineApi {
  const client = getClient();

  async function ensurePlayerSession(guestName?: string) {
    if (!client) {
      throw new Error("Supabase is not configured.");
    }

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }

    if (!sessionData.session) {
      const { error } = await client.auth.signInAnonymously(
        guestName
          ? {
              options: {
                data: { display_name: guestName }
              }
            }
          : undefined
      );
      if (error) {
        throw error;
      }
    }

    const { data, error } = await client.functions.invoke("guest-session", {
      body: { guestName }
    });
    if (error) {
      throw error;
    }
    return data as { id: string; displayName: string; isGuest: boolean };
  }

  return {
    configured: Boolean(client),
    ensurePlayerSession,
    async createMatch(mapId: string, rules: { economyMode: EconomyMode }, guestName?: string) {
      if (!client) {
        throw new Error("Supabase is not configured.");
      }
      await ensurePlayerSession(guestName);
      const { data, error } = await client.functions.invoke("matches", {
        body: { action: "create", guestName, mapId, rules }
      });
      if (error) {
        throw error;
      }
      return data as { id: string; inviteCode: string | null; side: "sun"; state: MatchState };
    },
    async joinMatch(inviteCode: string, guestName?: string) {
      if (!client) {
        throw new Error("Supabase is not configured.");
      }
      await ensurePlayerSession(guestName);
      const { data, error } = await client.functions.invoke("matches", {
        body: { action: "join", guestName, inviteCode }
      });
      if (error) {
        throw error;
      }
      return data as { joined: true; id: string; inviteCode: string | null; side: "sun" | "moon"; state: MatchState };
    },
    async listMatches(guestName?: string) {
      if (!client) {
        throw new Error("Supabase is not configured.");
      }
      await ensurePlayerSession(guestName);
      const { data, error } = await client.functions.invoke("matches", {
        body: { action: "list", guestName }
      });
      if (error) {
        throw error;
      }
      return (data as { matches: Array<{ id: string; mapId: string; inviteCode: string | null; currentPlayer: string; turnNumber: number; winner: string | null; updatedAt: string; side: "sun" | "moon" | null; state: MatchState }> }).matches;
    },
    async getMatch(matchId: string, guestName?: string) {
      if (!client) {
        throw new Error("Supabase is not configured.");
      }
      await ensurePlayerSession(guestName);
      const { data, error } = await client.functions.invoke("matches", {
        body: { action: "get", guestName, matchId }
      });
      if (error) {
        throw error;
      }
      return data as { id: string; mapId: string; inviteCode: string | null; currentPlayer: string; turnNumber: number; winner: string | null; updatedAt: string; side: "sun" | "moon"; state: MatchState };
    },
    async submitTurn(matchId: string, actions: TurnAction[], guestName?: string) {
      if (!client) {
        throw new Error("Supabase is not configured.");
      }
      await ensurePlayerSession(guestName);
      const { data, error } = await client.functions.invoke("match-turn", {
        body: { guestName, matchId, actions }
      });
      if (error) {
        throw error;
      }
      return data as { accepted: true; matchId: string; turnNumber: number; currentPlayer: string; winner: string | null; state: MatchState };
    }
  };
}
