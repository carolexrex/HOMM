import { estimateAttack } from "../combat.ts";
import { getRecruitOptions, availableHeals, availableTargets, moveUnit, recruitUnit, reachableTiles } from "../game.ts";
import { unitDefinitions } from "../content.ts";
import type { MatchState, UnitState } from "../types.ts";
import { scoreAttack, scoreHeal, scoreMove, scoreRecruit } from "./scoring.ts";
import type { AiCandidate } from "./types.ts";

function getUnit(state: MatchState, unitId: string): UnitState | undefined {
  return state.units.find((unit) => unit.id === unitId);
}

export function generateRecruitCandidates(state: MatchState): AiCandidate[] {
  const candidates: AiCandidate[] = [];
  for (const option of getRecruitOptions(state)) {
    if (!option.affordable) {
      continue;
    }
    const result = recruitUnit(state, option.kind);
    if (!result.ok) {
      continue;
    }
    candidates.push({
      score: scoreRecruit(state, option.kind),
      actions: [{ type: "recruit", kind: option.kind }],
      reason: `recruit:${option.kind}`
    });
  }
  return candidates;
}

export function generateUnitCandidates(state: MatchState): AiCandidate[] {
  const player = state.currentPlayer;
  const candidates: AiCandidate[] = [];

  for (const unit of state.units) {
    if (unit.owner !== player) {
      continue;
    }

    if (!unit.acted) {
      for (const target of availableTargets(state, unit.id)) {
        const preview = estimateAttack(state, unit, target);
        candidates.push({
          score: scoreAttack(state, unit, target, preview.damage, preview.retaliation, preview.splash),
          actions: [{ type: "attack", attackerId: unit.id, targetId: target.id }],
          reason: `attack:${unit.id}:${target.id}`
        });
      }

      if (unitDefinitions[unit.kind].canHeal) {
        for (const target of availableHeals(state, unit.id)) {
          candidates.push({
            score: scoreHeal(state, target),
            actions: [{ type: "heal", healerId: unit.id, targetId: target.id }],
            reason: `heal:${unit.id}:${target.id}`
          });
        }
      }
    }

    if (unit.moved) {
      continue;
    }

    for (const destination of reachableTiles(state, unit.id)) {
      if (destination.x === unit.x && destination.y === unit.y) {
        continue;
      }

      const moveResult = moveUnit(state, unit.id, destination);
      if (!moveResult.ok) {
        continue;
      }

      const movedUnit = getUnit(moveResult.state, unit.id);
      if (!movedUnit) {
        continue;
      }

      const moveScore = scoreMove(state, unit, destination);
      candidates.push({
        score: moveScore,
        actions: [{ type: "move", unitId: unit.id, to: destination }],
        reason: `move:${unit.id}:${destination.x},${destination.y}`
      });

      if (!movedUnit.acted) {
        for (const target of availableTargets(moveResult.state, unit.id)) {
          const targetInMovedState = getUnit(moveResult.state, target.id);
          if (!targetInMovedState) {
            continue;
          }
          const preview = estimateAttack(moveResult.state, movedUnit, targetInMovedState);
          candidates.push({
            score:
              moveScore * 0.35 +
              scoreAttack(moveResult.state, movedUnit, targetInMovedState, preview.damage, preview.retaliation, preview.splash),
            actions: [
              { type: "move", unitId: unit.id, to: destination },
              { type: "attack", attackerId: unit.id, targetId: target.id }
            ],
            reason: `move-attack:${unit.id}:${destination.x},${destination.y}:${target.id}`
          });
        }

        if (unitDefinitions[unit.kind].canHeal) {
          for (const target of availableHeals(moveResult.state, unit.id)) {
            const targetInMovedState = getUnit(moveResult.state, target.id);
            if (!targetInMovedState) {
              continue;
            }
            candidates.push({
              score: moveScore * 0.25 + scoreHeal(moveResult.state, targetInMovedState),
              actions: [
                { type: "move", unitId: unit.id, to: destination },
                { type: "heal", healerId: unit.id, targetId: target.id }
              ],
              reason: `move-heal:${unit.id}:${destination.x},${destination.y}:${target.id}`
            });
          }
        }
      }
    }
  }

  return candidates;
}
