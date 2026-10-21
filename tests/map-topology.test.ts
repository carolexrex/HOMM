import { describe, expect, it } from "vitest";
import { maps, terrainDefinitions, unitDefinitions, type Coord, type MapDefinition, type TerrainKind, type UnitClass } from "../src/engine";

const ROAD_LIKE: TerrainKind[] = ["road", "bridge", "village", "keep"];
const STEPS: Coord[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
/** The maps repaired for disconnected roads; Meadow Line and Ashen Ford are the visual references. */
const REPAIRED = ["thornwatch", "sunken-road", "citadel-pass", "lakewatch"];

const key = ({ x, y }: Coord) => `${x},${y}`;
const mapById = (id: string) => maps.find((map) => map.id === id)!;
const terrainAt = (map: MapDefinition, { x, y }: Coord) => map.board[y]?.[x]?.terrain;

function neighbors(map: MapDefinition, at: Coord): Coord[] {
  return STEPS.map((step) => ({ x: at.x + step.x, y: at.y + step.y })).filter((next) => terrainAt(map, next) !== undefined);
}

function tilesOf(map: MapDefinition, kinds: TerrainKind[]): Coord[] {
  return map.board.flat().filter((tile) => kinds.includes(tile.terrain)).map(({ x, y }) => ({ x, y }));
}

/** Every tile reachable from `start` through tiles that `passable` accepts. */
function flood(map: MapDefinition, start: Coord, passable: (terrain: TerrainKind) => boolean): Set<string> {
  const seen = new Set([key(start)]);
  const queue = [start];
  while (queue.length) {
    for (const next of neighbors(map, queue.shift()!)) {
      if (seen.has(key(next)) || !passable(terrainAt(map, next)!)) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  return seen;
}

const walkable = (unitClass: UnitClass) => (terrain: TerrainKind) => terrainDefinitions[terrain].moveCost[unitClass] < 999;
const roadLinks = (map: MapDefinition, at: Coord) => neighbors(map, at).filter((next) => ROAD_LIKE.includes(terrainAt(map, next)!));

describe("map topology", () => {
  it("builds rectangular boards for every map", () => {
    for (const map of maps) {
      expect(map.board).toHaveLength(map.size.height);
      for (const row of map.board) {
        expect(row).toHaveLength(map.size.width);
      }
    }
  });

  it.each(maps.map((map) => [map.name, map] as const))("%s mirrors terrain, structures, and armies left to right", (_name, map) => {
    const { width } = map.size;
    for (const tile of map.board.flat()) {
      const mirrored = map.board[tile.y][width - 1 - tile.x];
      expect(mirrored.terrain, `${key(tile)} mirrors left-right`).toBe(tile.terrain);
      expect(mirrored.structure).toBe(tile.structure);
      if (tile.structure === "keep") expect(tile.owner).toBe(tile.x < width / 2 ? "sun" : "moon");
    }
    const sun = map.units.filter((unit) => unit.owner === "sun");
    const moon = map.units.filter((unit) => unit.owner === "moon");
    expect(moon).toHaveLength(sun.length);
    for (const unit of sun) {
      expect(moon).toContainEqual(expect.objectContaining({ kind: unit.kind, x: width - 1 - unit.x, y: unit.y }));
    }
  });

  it.each(maps.map((map) => [map.name, map] as const))("%s spawns every unit on its own passable tile on its own half", (_name, map) => {
    expect(new Set(map.units.map(key)).size).toBe(map.units.length);
    for (const unit of map.units) {
      const terrain = terrainAt(map, unit);
      expect(terrain, `${unit.id} is on the board`).toBeDefined();
      expect(walkable(unitDefinitions[unit.kind].className)(terrain!), `${unit.id} stands on ${terrain}`).toBe(true);
      expect(unit.owner === "sun" ? unit.x < map.size.width / 2 : unit.x >= map.size.width / 2).toBe(true);
    }
  });

  it.each(maps.map((map) => [map.name, map] as const))("%s lets every unit reach every keep and village", (_name, map) => {
    const objectives = tilesOf(map, ["keep", "village"]);
    for (const unit of map.units) {
      const reached = flood(map, unit, walkable(unitDefinitions[unit.kind].className));
      for (const objective of objectives) {
        expect(reached.has(key(objective)), `${unit.id} reaches ${key(objective)}`).toBe(true);
      }
    }
  });

  it.each(maps.map((map) => [map.name, map] as const))("%s has no isolated road tiles, and every bridge has road approaches", (_name, map) => {
    for (const road of tilesOf(map, ["road"])) {
      expect(roadLinks(map, road).length, `road ${key(road)} joins a road, bridge, village, or keep`).toBeGreaterThan(0);
    }
    for (const bridge of tilesOf(map, ["bridge"])) {
      const banks = neighbors(map, bridge).filter((next) => !["river", "bridge", "water", "shore"].includes(terrainAt(map, next)!));
      expect(banks.length, `bridge ${key(bridge)} touches land`).toBeGreaterThan(0);
      for (const bank of banks) {
        expect(ROAD_LIKE, `the approach to bridge ${key(bridge)} at ${key(bank)}`).toContain(terrainAt(map, bank));
      }
    }
  });

  it.each(REPAIRED.map((id) => [mapById(id).name, mapById(id)] as const))("%s roads have no dead ends or doubled-up road blocks", (_name, map) => {
    for (const road of tilesOf(map, ["road"])) {
      expect(roadLinks(map, road).length, `road ${key(road)} continues on both ends`).toBeGreaterThanOrEqual(2);
      const block = [road, { x: road.x + 1, y: road.y }, { x: road.x, y: road.y + 1 }, { x: road.x + 1, y: road.y + 1 }];
      expect(block.every((tile) => terrainAt(map, tile) === "road"), `2x2 road block at ${key(road)}`).toBe(false);
    }
  });

  // The routes each map is built around, joined by roads, bridges, villages, and keeps.
  const routes: Record<string, Array<[Coord, Coord]>> = {
    "meadow-line": [[{ x: 0, y: 0 }, { x: 0, y: 6 }], [{ x: 0, y: 0 }, { x: 3, y: 1 }]],
    "ashen-ford": [[{ x: 0, y: 0 }, { x: 11, y: 0 }], [{ x: 0, y: 8 }, { x: 11, y: 8 }], [{ x: 0, y: 0 }, { x: 3, y: 1 }]],
    // North and south lanes around the bog link both keeps; the west village joins them.
    thornwatch: [[{ x: 0, y: 0 }, { x: 11, y: 0 }], [{ x: 0, y: 6 }, { x: 11, y: 6 }], [{ x: 0, y: 3 }, { x: 0, y: 0 }], [{ x: 0, y: 3 }, { x: 0, y: 6 }]],
    // Each keep road runs past its village to a bridge and on to the enemy keep.
    "sunken-road": [[{ x: 0, y: 0 }, { x: 6, y: 2 }], [{ x: 0, y: 0 }, { x: 13, y: 0 }], [{ x: 0, y: 6 }, { x: 13, y: 6 }], [{ x: 4, y: 0 }, { x: 0, y: 0 }]],
    // Both keeps and the central village reach all three gate bridges.
    "citadel-pass": [
      [{ x: 0, y: 0 }, { x: 7, y: 2 }], [{ x: 0, y: 0 }, { x: 7, y: 3 }], [{ x: 0, y: 0 }, { x: 7, y: 4 }],
      [{ x: 0, y: 6 }, { x: 7, y: 4 }], [{ x: 0, y: 3 }, { x: 7, y: 3 }], [{ x: 0, y: 0 }, { x: 15, y: 6 }]
    ],
    // Edge roads pass the lake villages and join both keeps.
    lakewatch: [[{ x: 0, y: 0 }, { x: 15, y: 0 }], [{ x: 0, y: 7 }, { x: 15, y: 7 }], [{ x: 5, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 7 }]]
  };

  it("covers every map with intended routes", () => {
    expect(Object.keys(routes).sort()).toEqual(maps.map((map) => map.id).sort());
  });

  it.each(Object.entries(routes).map(([id, list]) => [mapById(id).name, id, list] as const))("%s joins its intended routes by road", (_name, id, list) => {
    const map = mapById(id);
    for (const [from, to] of list) {
      expect(ROAD_LIKE).toContain(terrainAt(map, from));
      expect(flood(map, from, (terrain) => ROAD_LIKE.includes(terrain)).has(key(to)), `${key(from)} to ${key(to)} by road`).toBe(true);
    }
  });

  it("keeps the swamp, lake, and bridge terrain that gives each repaired map its identity", () => {
    const count = (id: string, kinds: TerrainKind[]) => tilesOf(mapById(id), kinds).length;
    expect(count("thornwatch", ["swamp"])).toBe(8);
    expect(count("thornwatch", ["forest"])).toBeGreaterThanOrEqual(8);
    expect(count("sunken-road", ["swamp"])).toBe(14);
    expect(count("sunken-road", ["bridge"])).toBe(4);
    expect(count("citadel-pass", ["bridge"])).toBe(6);
    expect(count("citadel-pass", ["hill"])).toBe(6);
    expect(count("lakewatch", ["water", "shore"])).toBe(28);
  });
});
