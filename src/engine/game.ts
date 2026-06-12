import {
  PLAYER_NAMES,
  baseIncome,
  captureThreshold,
  recruitOrder,
  terrainDefinitions,
  unitDefinitions,
  villageIncome
} from "./content.ts";
import { estimateAttack, getUnitsInSplash } from "./combat.ts";
import { addUnitExperience } from "./experience.ts";
import { createInviteCode, getMapDefinition } from "./maps.ts";
import { getDistance, getReachableTiles, getTileOccupant, sameCoord } from "./pathfinding.ts";
import type {
  Coord,
  GameIssueCode,
  GameResult,
  MatchMode,
  AiDifficultyLevel,
  EconomyMode,
  MatchState,
  PlayerId,
  TurnAction,
  UnitKind,
  UnitState,
  MatchRules
} from "./types.ts";

function cloneState(state: MatchState): MatchState {
  return structuredClone(state);
}

function ok(state: MatchState): GameResult {
  return { ok: true, state };
}

function fail(state: MatchState, code: GameIssueCode, message: string): GameResult {
  return { ok: false, state, issue: { code, message } };
}

function freshUnit(id: string, owner: PlayerId, kind: UnitKind, x: number, y: number): UnitState {
  return {
    id,
    owner,
    kind,
    hp: unitDefinitions[kind].maxHp,
    xp: 0,
    level: 1,
    x,
    y,
    moved: true,
    acted: true,
    captureProgress: 0
  };
}

function unitName(unit: UnitState): string {
  return unitDefinitions[unit.kind].label;
}

function nextPlayer(player: PlayerId): PlayerId {
  return player === "sun" ? "moon" : "sun";
}

export function getEconomyMode(state: MatchState): EconomyMode {
  return state.rules?.economyMode ?? "standard";
}

function economyEnabled(state: MatchState): boolean {
  return getEconomyMode(state) === "standard";
}

function activeKeep(state: MatchState, owner: PlayerId): Coord | null {
  for (const row of state.board) {
    for (const tile of row) {
      if (tile.structure === "keep" && tile.owner === owner) {
        return { x: tile.x, y: tile.y };
      }
    }
  }
  return null;
}

function incomeFor(state: MatchState, owner: PlayerId): number {
  if (!economyEnabled(state)) {
    return 0;
  }
  let total = baseIncome;
  for (const row of state.board) {
    for (const tile of row) {
      if (tile.structure === "village" && tile.owner === owner) {
        total += villageIncome;
      }
    }
  }
  return total;
}

export function getIncomeFor(state: MatchState, owner: PlayerId): number {
  return incomeFor(state, owner);
}

export function countOwnedStructures(
  state: MatchState,
  owner: PlayerId,
  structure: "village" | "keep" | "all" = "all"
): number {
  let total = 0;
  for (const row of state.board) {
    for (const tile of row) {
      if (tile.owner !== owner || !tile.structure) {
        continue;
      }
      if (structure === "all" || tile.structure === structure) {
        total += 1;
      }
    }
  }
  return total;
}

export function getUnitsForPlayer(state: MatchState, owner: PlayerId): UnitState[] {
  return state.units.filter((unit) => unit.owner === owner);
}

export function getScoreBreakdown(state: MatchState, owner: PlayerId) {
  const units = getUnitsForPlayer(state, owner);
  const villages = countOwnedStructures(state, owner, "village");
  const totalHp = units.reduce((sum, unit) => sum + unit.hp, 0);
  const treasury = state.players[owner].gold;
  const winBonus = state.winner === owner ? 500 : 0;
  const tempoBonus = state.winner === owner ? Math.max(0, 180 - Math.max(0, state.turnNumber - 1) * 6) : 0;
  const villageScore = villages * 75;
  const unitScore = units.length * 45;
  const healthScore = totalHp * 4;
  const treasuryScore = Math.floor(treasury / 10);

  return {
    villages,
    units: units.length,
    totalHp,
    treasury,
    winBonus,
    tempoBonus,
    villageScore,
    unitScore,
    healthScore,
    treasuryScore,
    total: winBonus + tempoBonus + villageScore + unitScore + healthScore + treasuryScore
  };
}

function appendLog(state: MatchState, line: string): void {
  state.log.unshift(line);
  state.log = state.log.slice(0, 24);
}

function levelName(level: number): string {
  return level === 3 ? "Elite" : "Veteran";
}

function grantCombatExperience(state: MatchState, unit: UnitState, amount: number): void {
  if (amount <= 0 || unit.hp <= 0) {
    return;
  }
  const result = addUnitExperience(unit, amount);
  if (result.leveledUp) {
    appendLog(state, `${unitName(unit)} became ${levelName(result.level)}.`);
  }
}

function getUnit(state: MatchState, unitId: string): UnitState | undefined {
  return state.units.find((entry) => entry.id === unitId);
}

export function getUnitRange(state: MatchState, unit: UnitState): { min: number; max: number } {
  const definition = unitDefinitions[unit.kind];
  const hillBonus = unit.kind === "archer" && state.board[unit.y][unit.x].terrain === "hill" ? 1 : 0;
  return {
    min: definition.minRange,
    max: definition.maxRange + hillBonus
  };
}

export function createMatch(mapId: string, mode: MatchMode, aiDifficulty: AiDifficultyLevel = "normal", rules: MatchRules = { economyMode: "standard" }): MatchState {
  const map = getMapDefinition(mapId);
  return {
    id: crypto.randomUUID(),
    mode,
    aiDifficulty: mode === "ai" ? aiDifficulty : undefined,
    rules: { economyMode: rules.economyMode ?? "standard" },
    mapId: map.id,
    mapName: map.name,
    board: map.board,
    units: map.units,
    players: {
      sun: {
        id: "sun",
        name: PLAYER_NAMES.sun,
        gold: (rules.economyMode ?? "standard") === "standard" ? 360 : 0
      },
      moon: {
        id: "moon",
        name: mode === "ai" ? PLAYER_NAMES.moon + " AI" : PLAYER_NAMES.moon,
        gold: (rules.economyMode ?? "standard") === "standard" ? 360 : 0
      }
    },
    currentPlayer: "sun",
    turnNumber: 1,
    winner: null,
    inviteCode: mode === "online" ? createInviteCode() : null,
    log: [`${map.name} opened. ${PLAYER_NAMES.sun} take the first turn.`],
    createdAt: new Date().toISOString()
  };
}

function ensureActiveUnit(state: MatchState, unitId: string): UnitState | undefined {
  const unit = getUnit(state, unitId);
  if (!unit || unit.owner !== state.currentPlayer) {
    return undefined;
  }
  return unit;
}

function removeDead(state: MatchState): void {
  state.units = state.units.filter((unit) => unit.hp > 0);
}

function checkVictory(state: MatchState): void {
  const sunAlive = state.units.some((unit) => unit.owner === "sun");
  const moonAlive = state.units.some((unit) => unit.owner === "moon");
  if (!sunAlive) {
    state.winner = "moon";
  } else if (!moonAlive) {
    state.winner = "sun";
  }

  for (const row of state.board) {
    for (const tile of row) {
      if (tile.structure !== "keep" || !tile.owner) {
        continue;
      }
      const originalOwner = tile.x < state.board[0].length / 2 ? "sun" : "moon";
      if (tile.owner !== originalOwner) {
        state.winner = tile.owner;
      }
    }
  }
}

export function availableTargets(state: MatchState, unitId: string): UnitState[] {
  const unit = getUnit(state, unitId);
  if (!unit || state.winner || unit.owner !== state.currentPlayer || unit.acted) {
    return [];
  }
  if (unitDefinitions[unit.kind].cannotAttackAfterMove && unit.moved) {
    return [];
  }
  const range = getUnitRange(state, unit);
  return state.units.filter((target) => {
    if (target.owner === unit.owner) {
      return false;
    }
    const distance = getDistance(unit, target);
    return distance >= range.min && distance <= range.max;
  });
}

export function availableHeals(state: MatchState, unitId: string): UnitState[] {
  const unit = getUnit(state, unitId);
  if (!unit || state.winner || unit.owner !== state.currentPlayer || unit.acted || !unitDefinitions[unit.kind].canHeal) {
    return [];
  }
  return state.units.filter((target) => {
    if (target.owner !== unit.owner || target.id === unit.id) {
      return false;
    }
    if (target.hp >= unitDefinitions[target.kind].maxHp) {
      return false;
    }
    return getDistance(unit, target) === 1;
  });
}

export function reachableTiles(state: MatchState, unitId: string): Coord[] {
  const unit = getUnit(state, unitId);
  if (!unit) {
    return [];
  }
  return getReachableTiles(state, unit).map(({ x, y }) => ({ x, y }));
}

export function moveUnit(state: MatchState, unitId: string, destination: Coord): GameResult {
  const next = cloneState(state);
  if (next.winner) {
    return fail(next, "match-finished", "The match is already over.");
  }

  const unit = ensureActiveUnit(next, unitId);
  if (!unit) {
    return fail(next, "unit-not-found", "That unit is unavailable.");
  }
  if (unit.moved) {
    return fail(next, "already-moved", "That unit has already moved.");
  }

  const reachable = getReachableTiles(next, unit);
  if (!reachable.some((tile) => sameCoord(tile, destination))) {
    return fail(next, "unreachable", "That destination is not reachable.");
  }

  const occupant = getTileOccupant(next, destination);
  if (occupant && occupant.id !== unit.id) {
    return fail(next, "tile-occupied", "A unit already occupies that tile.");
  }

  unit.x = destination.x;
  unit.y = destination.y;
  unit.moved = true;
  unit.captureProgress = 0;
  appendLog(next, `${PLAYER_NAMES[unit.owner]} moved ${unitName(unit)}.`);
  return ok(next);
}

export function attackUnit(state: MatchState, attackerId: string, targetId: string): GameResult {
  const next = cloneState(state);
  if (next.winner) {
    return fail(next, "match-finished", "The match is already over.");
  }

  const attacker = ensureActiveUnit(next, attackerId);
  const target = getUnit(next, targetId);
  if (!attacker || !target) {
    return fail(next, "unit-not-found", "Attacker or defender not found.");
  }
  if (attacker.acted) {
    return fail(next, "already-acted", "That unit has already acted.");
  }
  if (target.owner === attacker.owner) {
    return fail(next, "friendly-fire", "Friendly units cannot be attacked.");
  }

  const attackerDef = unitDefinitions[attacker.kind];
  const attackRange = getUnitRange(next, attacker);
  const distance = getDistance(attacker, target);
  if (distance < attackRange.min || distance > attackRange.max) {
    return fail(next, "out-of-range", "Target is out of range.");
  }
  if (attackerDef.cannotAttackAfterMove && attacker.moved) {
    return fail(next, "already-moved", "This unit must stay still to attack.");
  }

  const preview = estimateAttack(next, attacker, target);
  target.hp -= preview.damage;
  attacker.acted = true;
  attacker.moved = true;

  grantCombatExperience(next, attacker, 1);

  if (target.hp > 0) {
    grantCombatExperience(next, target, 1);
  } else {
    grantCombatExperience(next, attacker, 6);
  }

  if (preview.splash > 0) {
    const splashTargets = getUnitsInSplash(next, { x: target.x, y: target.y }).filter(
      (unit) => unit.owner === target.owner
    );
    for (const splash of splashTargets) {
      splash.hp -= 1;
      if (splash.hp <= 0) {
        grantCombatExperience(next, attacker, 3);
      }
    }
  }

  if (preview.retaliation > 0 && target.hp > 0) {
    attacker.hp -= preview.retaliation;
    grantCombatExperience(next, target, 1);
    if (attacker.hp <= 0) {
      grantCombatExperience(next, target, 6);
    }
  }

  removeDead(next);
  appendLog(
    next,
    `${unitName(attacker)} dealt ${preview.damage} to ${unitName(target)}${
      preview.retaliation > 0 ? ` and took ${preview.retaliation} back` : ""
    }.`
  );
  checkVictory(next);
  return ok(next);
}

export function healUnit(state: MatchState, healerId: string, targetId: string): GameResult {
  const next = cloneState(state);
  if (next.winner) {
    return fail(next, "match-finished", "The match is already over.");
  }

  const healer = ensureActiveUnit(next, healerId);
  const target = getUnit(next, targetId);
  if (!healer || !target) {
    return fail(next, "unit-not-found", "Healer or target was not found.");
  }
  if (!unitDefinitions[healer.kind].canHeal) {
    return fail(next, "not-healer", "That unit cannot heal.");
  }
  if (healer.acted) {
    return fail(next, "already-acted", "That unit has already acted.");
  }
  if (target.owner !== healer.owner) {
    return fail(next, "friendly-fire", "Healers may only heal allies.");
  }
  if (target.hp >= unitDefinitions[target.kind].maxHp) {
    return fail(next, "full-health", "That ally is already at full health.");
  }
  if (getDistance(healer, target) !== 1) {
    return fail(next, "out-of-range", "Healing requires adjacent range.");
  }

  const previousHp = target.hp;
  target.hp = Math.min(unitDefinitions[target.kind].maxHp, target.hp + 3);
  const restored = target.hp - previousHp;
  healer.moved = true;
  healer.acted = true;
  grantCombatExperience(next, healer, restored >= 3 ? 2 : 1);
  appendLog(next, `${unitName(healer)} restored ${restored} health to ${unitName(target)}.`);
  return ok(next);
}

export function recruitUnit(state: MatchState, kind: UnitKind): GameResult {
  const next = cloneState(state);
  if (!economyEnabled(next)) {
    return fail(next, "invalid-recruit", "Recruitment is disabled in skirmish mode.");
  }
  if (next.winner) {
    return fail(next, "match-finished", "The match is already over.");
  }
  const definition = unitDefinitions[kind];
  const player = next.players[next.currentPlayer];
  if (player.gold < definition.cost) {
    return fail(next, "insufficient-gold", "Not enough gold to recruit that unit.");
  }

  const keep = activeKeep(next, next.currentPlayer);
  if (!keep) {
    return fail(next, "invalid-recruit", "Your keep has been lost.");
  }
  const occupant = getTileOccupant(next, keep);
  if (occupant) {
    return fail(next, "tile-occupied", "Move the unit off your keep before recruiting.");
  }

  next.units.push(
    freshUnit(`${next.currentPlayer}-${kind}-${crypto.randomUUID()}`, next.currentPlayer, kind, keep.x, keep.y)
  );
  next.players[next.currentPlayer].gold -= definition.cost;
  appendLog(next, `${PLAYER_NAMES[next.currentPlayer]} recruited ${definition.label}.`);
  return ok(next);
}

function resolveCaptures(state: MatchState, owner: PlayerId): void {
  for (const unit of state.units) {
    if (unit.owner !== owner) {
      continue;
    }
    const tile = state.board[unit.y][unit.x];
    const definition = unitDefinitions[unit.kind];
    if (!tile.structure || !definition.canCapture) {
      unit.captureProgress = 0;
      continue;
    }
    if (tile.owner === owner) {
      unit.captureProgress = 0;
      continue;
    }
    unit.captureProgress += unit.hp;
    appendLog(state, `${unitName(unit)} pressed the capture on the ${terrainDefinitions[tile.terrain].label}.`);
    if (unit.captureProgress >= captureThreshold) {
      tile.owner = owner;
      unit.captureProgress = 0;
      appendLog(state, `${PLAYER_NAMES[owner]} secured the ${tile.structure}.`);
    }
  }
}

export function endTurn(state: MatchState): GameResult {
  const next = cloneState(state);
  if (next.winner) {
    return fail(next, "match-finished", "The match is already over.");
  }

  resolveCaptures(next, next.currentPlayer);
  checkVictory(next);
  if (next.winner) {
    return ok(next);
  }

  next.currentPlayer = nextPlayer(next.currentPlayer);
  next.turnNumber += 1;
  next.players[next.currentPlayer].gold += incomeFor(next, next.currentPlayer);
  next.units = next.units.map((unit) =>
    unit.owner === next.currentPlayer
      ? { ...unit, moved: false, acted: false }
      : unit
  );
  appendLog(next, `${PLAYER_NAMES[next.currentPlayer]} begin turn ${next.turnNumber}.`);
  return ok(next);
}

export function applyTurnAction(state: MatchState, action: TurnAction): GameResult {
  switch (action.type) {
    case "move":
      return moveUnit(state, action.unitId, action.to);
    case "attack":
      return attackUnit(state, action.attackerId, action.targetId);
    case "heal":
      return healUnit(state, action.healerId, action.targetId);
    case "recruit":
      return recruitUnit(state, action.kind);
    case "end_turn":
      return endTurn(state);
  }
}

export function applyTurnActions(state: MatchState, actions: TurnAction[]): GameResult {
  let current = structuredClone(state);
  for (const action of actions) {
    const result = applyTurnAction(current, action);
    if (!result.ok) {
      return result;
    }
    current = result.state;
  }
  return ok(current);
}

export function summarizeMatch(state: MatchState): string[] {
  const player = state.players[state.currentPlayer];
  const keep = activeKeep(state, state.currentPlayer);
  const keepStatus = keep ? `Keep at ${keep.x + 1},${keep.y + 1}` : "Keep lost";
  return [
    `${player.name} to act`,
    `${player.gold} gold`,
    `${state.units.filter((unit) => unit.owner === state.currentPlayer).length} units standing`,
    keepStatus
  ];
}

export function getRecruitOptions(state: MatchState): Array<{ kind: UnitKind; affordable: boolean; cost: number }> {
  if (!economyEnabled(state)) {
    return [];
  }
  return recruitOrder.map((kind) => ({
    kind,
    cost: unitDefinitions[kind].cost,
    affordable: state.players[state.currentPlayer].gold >= unitDefinitions[kind].cost
  }));
}



