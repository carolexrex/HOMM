import type { UnitState } from "./types.ts";

export type UnitLevel = 1 | 2 | 3;

export const maxUnitLevel: UnitLevel = 3;

const STANDARD_VETERAN_XP = 8;
const STANDARD_ELITE_XP = 22;
const MILITIA_VETERAN_XP = 12;
const MILITIA_ELITE_XP = 30;

function thresholdsFor(unit: UnitState) {
  return unit.kind === "militia"
    ? { veteran: MILITIA_VETERAN_XP, elite: MILITIA_ELITE_XP }
    : { veteran: STANDARD_VETERAN_XP, elite: STANDARD_ELITE_XP };
}

export function getUnitXp(unit: UnitState): number {
  return unit.xp ?? 0;
}

export function getUnitLevel(unit: UnitState): UnitLevel {
  const xp = getUnitXp(unit);
  const thresholds = thresholdsFor(unit);
  if (xp >= thresholds.elite) {
    return 3;
  }
  if (xp >= thresholds.veteran) {
    return 2;
  }
  return unit.level ?? 1;
}

export function getXpForNextLevel(unit: UnitState): number | null {
  const level = getUnitLevel(unit);
  const thresholds = thresholdsFor(unit);
  if (level <= 1) {
    return thresholds.veteran;
  }
  if (level === 2) {
    return thresholds.elite;
  }
  return null;
}

export function getDamageDealtMultiplier(unit: UnitState): number {
  const level = getUnitLevel(unit);
  if (level === 3) {
    return 1.15;
  }
  if (level === 2) {
    return 1.1;
  }
  return 1;
}

export function getDamageTakenMultiplier(unit: UnitState): number {
  return getUnitLevel(unit) === 3 ? 0.9 : 1;
}

export function addUnitExperience(unit: UnitState, amount: number): { leveledUp: boolean; level: UnitLevel; xp: number } {
  const previousLevel = getUnitLevel(unit);
  unit.xp = getUnitXp(unit) + Math.max(0, Math.floor(amount));
  unit.level = getUnitLevel(unit);
  return {
    leveledUp: unit.level > previousLevel,
    level: unit.level,
    xp: unit.xp
  };
}
