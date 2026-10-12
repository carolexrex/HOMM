import { createClient, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
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
  submitTurn(submission: TurnSubmission, guestName?: string): Promise<TurnSubmissionAccepted>;
}

export interface TurnSubmission {
  matchId: string;
  submissionId: string;
  /** Canonical turn number the draft was planned from. */
  expectedTurnNumber: number;
  actions: TurnAction[];
}

export interface TurnSubmissionAccepted {
  accepted: true;
  /** "duplicate" means an earlier attempt with this submission ID was already committed. */
  code: "accepted" | "duplicate";
  matchId: string;
  submissionId: string;
  turnNumber: number;
  currentPlayer: string;
  winner: string | null;
  /** Current canonical state, which may already include later turns. */
  state: MatchState;
}

/**
 * An Edge Function failure. `status` is undefined when no HTTP response arrived (network,
 * relay, or client error), in which case the server may or may not have acted.
 */
export class OnlineRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly state?: MatchState
  ) {
    super(message);
    this.name = "OnlineRequestError";
  }
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

async function throwFunctionError(error: unknown): Promise<never> {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    const status = error.context.status;
    let payload: { error?: unknown; code?: unknown; state?: unknown } | null = null;
    try {
      payload = await error.context.clone().json();
    } catch {
      /* fall back to the Supabase error message below */
    }
    const message = typeof payload?.error === "string" && payload.error.trim() ? payload.error : error.message;
    throw new OnlineRequestError(
      message,
      status,
      typeof payload?.code === "string" ? payload.code : undefined,
      payload?.state && typeof payload.state === "object" ? payload.state as MatchState : undefined
    );
  }
  throw new OnlineRequestError(error instanceof Error ? error.message : "Online request failed.");
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
      await throwFunctionError(error);
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
        await throwFunctionError(error);
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
        await throwFunctionError(error);
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
        await throwFunctionError(error);
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
        await throwFunctionError(error);
      }
      return data as { id: string; mapId: string; inviteCode: string | null; currentPlayer: string; turnNumber: number; winner: string | null; updatedAt: string; side: "sun" | "moon"; state: MatchState };
    },
    async submitTurn(submission: TurnSubmission, guestName?: string) {
      if (!client) {
        throw new Error("Supabase is not configured.");
      }
      try {
        await ensurePlayerSession(guestName);
      } catch (error) {
        // The turn was never sent; report it without a status so the draft is kept for retry.
        throw new OnlineRequestError(error instanceof Error ? error.message : "Could not reach the server.");
      }
      const { data, error } = await client.functions.invoke("match-turn", {
        body: { guestName, ...submission }
      });
      if (error) {
        await throwFunctionError(error);
      }
      return data as TurnSubmissionAccepted;
    }
  };
}
