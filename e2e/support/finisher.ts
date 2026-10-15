import {
  attackUnit,
  availableTargets,
  estimateAttack,
  getDistance,
  moveUnit,
  reachableTiles,
  type Coord,
  type MatchState,
  type TurnAction,
  type UnitState
} from "../../src/engine";

/**
 * Read-only, deterministic choice of the current player's next action for a test that plays a
 * match to its end: attack when possible (a kill first, then the most damage), otherwise move
 * to a tile that allows an attack, otherwise close in on the nearest enemy. It only reads the
 * engine; the test performs the chosen action through the rendered app.
 *
 * Returns null when the player has nothing useful left to do this turn.
 */
export type PressingAction = Extract<TurnAction, { type: "move" } | { type: "attack" }>;

const byId = (left: UnitState, right: UnitState) => left.id.localeCompare(right.id);
const byCoord = (left: Coord, right: Coord) => left.y - right.y || left.x - right.x;

function enemiesOf(state: MatchState, unit: UnitState) {
  return state.units.filter((entry) => entry.owner !== unit.owner).sort(byId);
}

/** The best attack for a unit where it stands, as [action, rank]; higher rank is better. */
function bestAttack(state: MatchState, unit: UnitState): [PressingAction, number] | null {
  let best: [PressingAction, number] | null = null;
  for (const target of availableTargets(state, unit.id).sort(byId)) {
    const preview = estimateAttack(state, unit, target);
    const kills = preview.damage >= target.hp;
    // Never trade the attacker away: an attack whose retaliation would kill it is skipped.
    if (!kills && preview.retaliation >= unit.hp) continue;
    const rank = (kills ? 1000 : 0) + preview.damage * 10 - preview.retaliation;
    if (!best || rank > best[1]) best = [{ type: "attack", attackerId: unit.id, targetId: target.id }, rank];
  }
  return best;
}

function nearestEnemyDistance(state: MatchState, unit: UnitState, at: Coord) {
  return Math.min(...enemiesOf(state, unit).map((enemy) => getDistance(at, enemy)));
}

export function nextPressingAction(state: MatchState): PressingAction | null {
  if (state.winner) return null;
  const own = state.units.filter((unit) => unit.owner === state.currentPlayer).sort(byId);
  const occupied = new Set(state.units.map((unit) => `${unit.x},${unit.y}`));

  // 1. Attack from where a unit stands.
  let attack: [PressingAction, number] | null = null;
  for (const unit of own) {
    if (unit.acted) continue;
    const option = bestAttack(state, unit);
    if (option && (!attack || option[1] > attack[1])) attack = option;
  }
  if (attack) return attack[0];

  // 2. Move to the tile that allows the best attack.
  let setup: [PressingAction, number] | null = null;
  for (const unit of own) {
    if (unit.moved || unit.acted) continue;
    for (const to of reachableTiles(state, unit.id).filter((tile) => !occupied.has(`${tile.x},${tile.y}`)).sort(byCoord)) {
      const moved = moveUnit(state, unit.id, to);
      if (!moved.ok) continue;
      const option = bestAttack(moved.state, moved.state.units.find((entry) => entry.id === unit.id)!);
      if (option && (!setup || option[1] > setup[1])) setup = [{ type: "move", unitId: unit.id, to: { x: to.x, y: to.y } }, option[1]];
    }
  }
  if (setup) return setup[0];

  // 3. Close in on the nearest enemy.
  for (const unit of own) {
    if (unit.moved || unit.acted) continue;
    const here = nearestEnemyDistance(state, unit, unit);
    let best: [Coord, number] | null = null;
    for (const to of reachableTiles(state, unit.id).filter((tile) => !occupied.has(`${tile.x},${tile.y}`)).sort(byCoord)) {
      const distance = nearestEnemyDistance(state, unit, to);
      if (distance < here && (!best || distance < best[1])) best = [to, distance];
    }
    if (best) return { type: "move", unitId: unit.id, to: { x: best[0].x, y: best[0].y } };
  }
  return null;
}

/** Whether performing the action ends the match. */
export function wins(state: MatchState, action: PressingAction) {
  return action.type === "attack" && Boolean(attackUnit(state, action.attackerId, action.targetId).state.winner);
}
