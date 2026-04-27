import { terrainDefinitions, unitDefinitions } from "../content.ts";
import { getDistance } from "../pathfinding.ts";
import type { Coord, MatchState, UnitKind, UnitState } from "../types.ts";
import type { AiCandidate, AiDifficulty } from "./types.ts";

const targetPriority: Partial<Record<UnitKind, number>> = {
  healer: 42,
  catapult: 36,
  archer: 24,
  cavalry: 18,
  assassin: 16,
  pikeman: 14,
  swordsman: 12,
  militia: 8
};

function isObjectiveTile(state: MatchState, coord: Coord, owner: UnitState["owner"]): boolean {
  const tile = state.board[coord.y][coord.x];
  return Boolean(tile.structure) && tile.owner !== owner;
}

function objectiveDistance(state: MatchState, coord: Coord, owner: UnitState["owner"]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const row of state.board) {
    for (const tile of row) {
      if (tile.structure && tile.owner !== owner) {
        best = Math.min(best, getDistance(coord, tile));
      }
    }
  }
  return Number.isFinite(best) ? best : 0;
}

function enemyDistance(state: MatchState, coord: Coord, owner: UnitState["owner"]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const unit of state.units) {
    if (unit.owner !== owner) {
      best = Math.min(best, getDistance(coord, unit));
    }
  }
  return Number.isFinite(best) ? best : 0;
}

export function scoreAttack(
  state: MatchState,
  attacker: UnitState,
  defender: UnitState,
  damage: number,
  retaliation: number,
  splash: number
): number {
  let score = damage * 15 - retaliation * 8;
  if (damage >= defender.hp) {
    score += 260 + unitDefinitions[defender.kind].cost / 2;
  }
  if (retaliation >= attacker.hp) {
    score -= 150;
  }
  score += targetPriority[defender.kind] ?? 0;
  if (state.board[defender.y][defender.x].structure) {
    score += 14;
  }
  if (splash > 0) {
    score += 8;
  }
  return score;
}

export function scoreHeal(state: MatchState, target: UnitState): number {
  const missing = unitDefinitions[target.kind].maxHp - target.hp;
  let score = Math.min(3, missing) * 15;
  score += (targetPriority[target.kind] ?? 10) * 0.5;
  if (state.board[target.y][target.x].structure) {
    score += 12;
  }
  return score;
}

export function scoreMove(state: MatchState, unit: UnitState, destination: Coord): number {
  const tile = state.board[destination.y][destination.x];
  let score = 0;
  score += terrainDefinitions[tile.terrain].defense * 5;

  if (isObjectiveTile(state, destination, unit.owner) && unitDefinitions[unit.kind].canCapture) {
    score += tile.structure === "keep" ? 220 : 160;
  }

  const beforeObjective = objectiveDistance(state, unit, unit.owner);
  const afterObjective = objectiveDistance(state, destination, unit.owner);
  score += (beforeObjective - afterObjective) * 5;

  const beforeEnemy = enemyDistance(state, unit, unit.owner);
  const afterEnemy = enemyDistance(state, destination, unit.owner);

  if (unit.kind === "archer") {
    if (tile.terrain === "hill") {
      score += 18;
    }
    score += (beforeEnemy - afterEnemy) * 2;
  } else if (unit.kind === "catapult") {
    if (tile.terrain === "hill") {
      score += 12;
    }
    if (afterEnemy <= 1) {
      score -= 80;
    }
    score += (beforeEnemy - afterEnemy) * 1.5;
  } else if (unit.kind === "healer") {
    score += (beforeEnemy - afterEnemy) * 1.2;
  } else {
    score += (beforeEnemy - afterEnemy) * 4;
  }

  if (unit.kind === "cavalry" && (tile.terrain === "forest" || tile.terrain === "swamp")) {
    score -= 24;
  }
  if (unit.kind === "assassin" && (tile.terrain === "forest" || tile.terrain === "swamp")) {
    score += 20;
  }
  if (unit.kind === "catapult" && tile.terrain === "swamp") {
    score -= 16;
  }
  if (unit.kind === "pikeman" && afterEnemy <= 2) {
    score += 10;
  }

  const centerX = (state.board[0].length - 1) / 2;
  const centerY = (state.board.length - 1) / 2;
  const centerBias = Math.abs(unit.x - centerX) + Math.abs(unit.y - centerY) - (Math.abs(destination.x - centerX) + Math.abs(destination.y - centerY));
  score += centerBias * 2;

  return score;
}

export function scoreRecruit(state: MatchState, kind: UnitKind): number {
  const player = state.currentPlayer;
  const enemyUnits = state.units.filter((unit) => unit.owner !== player);
  const friendlyUnits = state.units.filter((unit) => unit.owner === player);
  const openObjectives = state.board.flat().filter((tile) => tile.structure && tile.owner !== player).length;

  let score = 0;
  switch (kind) {
    case "militia":
      score = 42 + openObjectives * 8;
      break;
    case "swordsman":
      score = 48;
      break;
    case "pikeman":
      score = 36 + enemyUnits.filter((unit) => unit.kind === "cavalry").length * 20;
      break;
    case "archer":
      score = 44 + enemyUnits.filter((unit) => unit.kind === "militia" || unit.kind === "pikeman").length * 4;
      break;
    case "cavalry":
      score = 34 + enemyUnits.filter((unit) => unit.kind === "archer" || unit.kind === "catapult").length * 10;
      break;
    case "assassin":
      score = 30 + enemyUnits.filter((unit) => unit.kind === "archer" || unit.kind === "healer").length * 8;
      break;
    case "catapult":
      score = 22 + enemyUnits.filter((unit) => unit.kind === "swordsman" || unit.kind === "pikeman").length * 8;
      break;
    case "healer":
      score = friendlyUnits.length >= 4 ? 32 : 18;
      break;
  }

  if (friendlyUnits.length < 4) {
    score += 25;
  }
  score -= unitDefinitions[kind].cost / 25;
  return score;
}

export function chooseBestCandidate(candidates: AiCandidate[], difficulty: AiDifficulty): AiCandidate | null {
  if (!candidates.length) {
    return null;
  }

  const ranked = [...candidates].sort((left, right) => right.score - left.score || left.actions.length - right.actions.length);
  if (difficulty.selectionSlack <= 0) {
    return ranked[0] ?? null;
  }

  const threshold = ranked[0].score - difficulty.selectionSlack;
  const pool = ranked.filter((candidate) => candidate.score >= threshold);
  return pool[pool.length - 1] ?? ranked[0] ?? null;
}

