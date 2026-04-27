import type { AiDifficultyLevel, GameResult, MatchState, PlayerId, TurnAction } from "../types.ts";

export type AiAction = TurnAction;

export interface AiCandidate {
  score: number;
  actions: AiAction[];
  reason: string;
}

export interface AiPlan {
  player: PlayerId;
  actions: AiAction[];
}

export interface AiDifficulty {
  level: AiDifficultyLevel;
  maxActions: number;
  minimumScore: number;
  selectionSlack: number;
}

export interface AiExecution extends GameResult {
  action: AiAction;
}


