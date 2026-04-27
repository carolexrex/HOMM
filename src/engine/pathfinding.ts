import { terrainDefinitions, unitDefinitions } from "./content.ts";
import type { Coord, MatchState, ReachableNode, UnitState } from "./types.ts";

const directions: Coord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
];

export function inBounds(state: MatchState, { x, y }: Coord): boolean {
  return y >= 0 && y < state.board.length && x >= 0 && x < state.board[0].length;
}

export function sameCoord(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y;
}

export function getTileOccupant(state: MatchState, coord: Coord): UnitState | undefined {
  return state.units.find((unit) => unit.x === coord.x && unit.y === coord.y);
}

export function getNeighbors(state: MatchState, coord: Coord): Coord[] {
  return directions
    .map((direction) => ({ x: coord.x + direction.x, y: coord.y + direction.y }))
    .filter((next) => inBounds(state, next));
}

export function getMoveCost(state: MatchState, unit: UnitState, coord: Coord): number {
  const tile = state.board[coord.y][coord.x];
  return terrainDefinitions[tile.terrain].moveCost[unitDefinitions[unit.kind].className];
}

export function getReachableTiles(state: MatchState, unit: UnitState): ReachableNode[] {
  const frontier: ReachableNode[] = [{ x: unit.x, y: unit.y, cost: 0 }];
  const visited = new Map<string, number>([[`${unit.x},${unit.y}`, 0]]);
  const results: ReachableNode[] = [];

  while (frontier.length) {
    const current = frontier.shift()!;
    results.push(current);

    for (const next of getNeighbors(state, current)) {
      const occupant = getTileOccupant(state, next);
      if (occupant && occupant.id !== unit.id) {
        continue;
      }

      const moveCost = getMoveCost(state, unit, next);
      if (moveCost >= 999) {
        continue;
      }

      const nextCost = current.cost + moveCost;
      if (nextCost > unitDefinitions[unit.kind].move) {
        continue;
      }

      const key = `${next.x},${next.y}`;
      const best = visited.get(key);
      if (best === undefined || nextCost < best) {
        visited.set(key, nextCost);
        frontier.push({ x: next.x, y: next.y, cost: nextCost });
      }
    }
  }

  return results;
}

export function getDistance(a: Coord, b: Coord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
