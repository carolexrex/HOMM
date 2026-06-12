import { AI_DIFFICULTY_LABELS, type AiDifficultyLevel, type MatchMode } from "../engine";
import type { LocalStats } from "../lib/storage";

export interface StatsSummary {
  totalMatches: number;
  bestScore: number;
  fastestTurn: number;
  averageTurns: number;
}

export function getLocalLeaderboard(stats: LocalStats) {
  return [...stats.matches]
    .sort((left, right) => right.scores[right.winner] - left.scores[left.winner] || left.turnNumber - right.turnNumber)
    .slice(0, 6);
}

export function getLocalStatsSummary(stats: LocalStats): StatsSummary {
  if (stats.matches.length === 0) {
    return { totalMatches: 0, bestScore: 0, fastestTurn: 0, averageTurns: 0 };
  }

  const bestScore = Math.max(...stats.matches.map((result) => result.scores[result.winner]));
  const fastestTurn = Math.min(...stats.matches.map((result) => result.turnNumber));
  const averageTurns = Math.round(stats.matches.reduce((total, result) => total + result.turnNumber, 0) / stats.matches.length);
  return { totalMatches: stats.matches.length, bestScore, fastestTurn, averageTurns };
}

export function formatResultMode(mode: MatchMode, difficulty?: AiDifficultyLevel) {
  if (mode === "ai") {
    return `AI ${AI_DIFFICULTY_LABELS[difficulty ?? "normal"]}`;
  }
  if (mode === "online") {
    return "Online";
  }
  return "Hot-seat";
}
