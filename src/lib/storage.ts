import type { AiDifficultyLevel, EconomyMode, MatchState, PlayerId } from "../engine";

const activeMatchKey = "bannerfront.active-match";
const accountKey = "bannerfront.account";
const settingsKey = "bannerfront.settings";
const statsKey = "bannerfront.local-stats";
const onlineSessionKey = "bannerfront.online-session";

export interface LocalAccount {
  deviceId?: string;
  guestName: string;
  userId?: string;
}

export interface OnlineSession {
  matchId: string;
  side: PlayerId;
  inviteCode: string | null;
}

export interface LocalSettings {
  moveAnimation: "animated" | "instant";
  aiDifficulty?: AiDifficultyLevel;
  economyMode?: EconomyMode;
}

export interface LocalMatchResult {
  id: string;
  finishedAt: string;
  mapId: string;
  mapName: string;
  mode: MatchState["mode"];
  aiDifficulty?: AiDifficultyLevel;
  winner: PlayerId;
  turnNumber: number;
  scores: Record<PlayerId, number>;
  villages: Record<PlayerId, number>;
  survivors: Record<PlayerId, number>;
  treasury: Record<PlayerId, number>;
}

export interface LocalStats {
  matches: LocalMatchResult[];
}

export function loadActiveMatch(): MatchState | null {
  const raw = localStorage.getItem(activeMatchKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as MatchState;
  } catch {
    localStorage.removeItem(activeMatchKey);
    return null;
  }
}

export function saveActiveMatch(match: MatchState): void {
  localStorage.setItem(activeMatchKey, JSON.stringify(match));
}

export function clearActiveMatch(): void {
  localStorage.removeItem(activeMatchKey);
}

export function loadAccount(): LocalAccount | null {
  const raw = localStorage.getItem(accountKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as LocalAccount;
  } catch {
    localStorage.removeItem(accountKey);
    return null;
  }
}

export function saveAccount(account: LocalAccount): void {
  localStorage.setItem(accountKey, JSON.stringify(account));
}

export function loadSettings(): LocalSettings | null {
  const raw = localStorage.getItem(settingsKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as LocalSettings;
  } catch {
    localStorage.removeItem(settingsKey);
    return null;
  }
}

export function saveSettings(settings: LocalSettings): void {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

export function loadLocalStats(): LocalStats {
  const raw = localStorage.getItem(statsKey);
  if (!raw) {
    return { matches: [] };
  }

  try {
    const parsed = JSON.parse(raw) as LocalStats;
    return {
      matches: Array.isArray(parsed.matches) ? parsed.matches : []
    };
  } catch {
    localStorage.removeItem(statsKey);
    return { matches: [] };
  }
}

export function saveLocalStats(stats: LocalStats): void {
  localStorage.setItem(statsKey, JSON.stringify(stats));
}

export function recordLocalMatch(result: LocalMatchResult): LocalStats {
  const stats = loadLocalStats();
  if (stats.matches.some((match) => match.id === result.id)) {
    return stats;
  }

  const next: LocalStats = {
    matches: [result, ...stats.matches].slice(0, 60)
  };
  saveLocalStats(next);
  return next;
}

export function loadOnlineSession(): OnlineSession | null {
  const raw = localStorage.getItem(onlineSessionKey);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as OnlineSession;
  } catch {
    localStorage.removeItem(onlineSessionKey);
    return null;
  }
}

export function saveOnlineSession(session: OnlineSession): void {
  localStorage.setItem(onlineSessionKey, JSON.stringify(session));
}

export function clearOnlineSession(): void {
  localStorage.removeItem(onlineSessionKey);
}
