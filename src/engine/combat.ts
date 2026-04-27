import { terrainDefinitions, unitDefinitions } from "./content.ts";
import { getDamageDealtMultiplier, getDamageTakenMultiplier } from "./experience.ts";
import { getDistance } from "./pathfinding.ts";
import type { AttackPreview, Coord, MatchState, UnitKind, UnitState } from "./types.ts";

function matchUpBonus(attacker: UnitKind, defender: UnitKind): number {
  if (attacker === "pikeman" && defender === "cavalry") {
    return 3;
  }
  if (attacker === "cavalry" && (defender === "archer" || defender === "catapult")) {
    return 2;
  }
  if (attacker === "archer" && (defender === "militia" || defender === "pikeman")) {
    return 1;
  }
  if (attacker === "catapult" && (defender === "swordsman" || defender === "pikeman")) {
    return 1;
  }
  return 0;
}

function terrainDefense(state: MatchState, unit: UnitState): number {
  return terrainDefinitions[state.board[unit.y][unit.x].terrain].defense;
}

function terrainAttackBonus(state: MatchState, unit: UnitState): number {
  const tile = state.board[unit.y][unit.x];
  return terrainDefinitions[tile.terrain].attackBonus[unit.kind] ?? 0;
}

function isAssassinAmbush(state: MatchState, unit: UnitState): boolean {
  const terrain = state.board[unit.y][unit.x].terrain;
  return unit.kind === "assassin" && (terrain === "forest" || terrain === "swamp");
}

function scaledAttack(power: number, hp: number): number {
  return power * (0.55 + hp / 20);
}

function clampDamage(raw: number): number {
  return Math.max(1, Math.min(8, Math.round(raw)));
}

function applyLevelDamage(raw: number, attacker: UnitState, defender: UnitState): number {
  return raw * getDamageDealtMultiplier(attacker) * getDamageTakenMultiplier(defender);
}

export function estimateAttack(
  state: MatchState,
  attacker: UnitState,
  defender: UnitState
): AttackPreview {
  const attackerDef = unitDefinitions[attacker.kind];
  const defenderDef = unitDefinitions[defender.kind];
  const baseDamage =
    scaledAttack(attackerDef.attack + terrainAttackBonus(state, attacker), attacker.hp) +
    matchUpBonus(attacker.kind, defender.kind) -
    terrainDefense(state, defender);
  const damage = clampDamage(applyLevelDamage(baseDamage, attacker, defender));

  let retaliation = 0;
  const range = getDistance(attacker, defender);
  if (
    attackerDef.minRange === 1 &&
    range === 1 &&
    !isAssassinAmbush(state, attacker) &&
    defenderDef.minRange === 1 &&
    defenderDef.retaliationAttack > 0
  ) {
    const retaliationBase =
      scaledAttack(defenderDef.retaliationAttack + terrainAttackBonus(state, defender), defender.hp) -
      terrainDefense(state, attacker);
    retaliation = clampDamage(applyLevelDamage(retaliationBase, defender, attacker));
  }

  return {
    targetId: defender.id,
    damage,
    retaliation,
    splash: attackerDef.splash ?? 0
  };
}

export function getUnitsInSplash(state: MatchState, target: Coord): UnitState[] {
  return state.units.filter(
    (unit) => getDistance(unit, target) === 1 && !(unit.x === target.x && unit.y === target.y)
  );
}
