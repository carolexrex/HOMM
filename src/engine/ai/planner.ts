import { applyTurnAction } from "../game.ts";
import type { AiDifficultyLevel, GameResult, MatchState, PlayerId } from "../types.ts";
import { chooseBestCandidate } from "./scoring.ts";
import { generateRecruitCandidates, generateUnitCandidates } from "./candidates.ts";
import type { AiAction, AiDifficulty, AiPlan } from "./types.ts";

export const aiDifficultyPresets: Record<AiDifficultyLevel, AiDifficulty> = {
  easy: { level: "easy", maxActions: 6, minimumScore: 18, selectionSlack: 18 },
  normal: { level: "normal", maxActions: 8, minimumScore: 10, selectionSlack: 8 },
  hard: { level: "hard", maxActions: 12, minimumScore: 4, selectionSlack: 0 }
};

export const AI_DIFFICULTY_LABELS: Record<AiDifficultyLevel, string> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard"
};

function resolveAiDifficulty(difficulty: AiDifficultyLevel | Partial<AiDifficulty>): AiDifficulty {
  if (typeof difficulty === "string") {
    return aiDifficultyPresets[difficulty];
  }

  return {
    ...aiDifficultyPresets.normal,
    ...difficulty,
    level: difficulty.level ?? aiDifficultyPresets.normal.level
  };
}

export function executeAiAction(state: MatchState, action: AiAction): GameResult {
  return applyTurnAction(state, action);
}

export function planAiTurn(state: MatchState, difficulty: AiDifficultyLevel | Partial<AiDifficulty> = "normal"): AiPlan {
  const options = resolveAiDifficulty(difficulty);
  const player: PlayerId = state.currentPlayer;
  let working = structuredClone(state);
  const actions: AiAction[] = [];

  for (let step = 0; step < options.maxActions; step += 1) {
    if (working.winner || working.currentPlayer !== player) {
      break;
    }

    const candidates = [
      ...generateRecruitCandidates(working),
      ...generateUnitCandidates(working)
    ];
    const best = chooseBestCandidate(candidates, options);
    if (!best || best.score < options.minimumScore) {
      break;
    }

    let candidateState = working;
    let applied = false;
    for (const action of best.actions) {
      const result = executeAiAction(candidateState, action);
      if (!result.ok) {
        applied = false;
        break;
      }
      candidateState = result.state;
      actions.push(action);
      applied = true;
    }

    if (!applied) {
      break;
    }

    working = candidateState;
  }

  if (!working.winner && working.currentPlayer === player) {
    actions.push({ type: "end_turn" });
  }

  return { player, actions };
}
