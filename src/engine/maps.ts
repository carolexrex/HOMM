import { PLAYER_NAMES, unitDefinitions } from "./content.ts";
import type { Coord, MapDefinition, PlayerId, TileState, UnitKind, UnitState } from "./types.ts";

const unitId = (owner: PlayerId, kind: UnitKind, x: number, y: number) =>
  `${owner}-${kind}-${x}-${y}`;

function mirrorRow(left: string): string {
  return `${left}${left.split("").reverse().join("")}`;
}

function toTerrain(symbol: string): Pick<TileState, "terrain" | "structure"> {
  switch (symbol) {
    case "f":
      return { terrain: "forest" };
    case "h":
      return { terrain: "hill" };
    case "r":
      return { terrain: "road" };
    case "s":
      return { terrain: "swamp" };
    case "~":
      return { terrain: "river" };
    case "w":
      return { terrain: "water" };
    case "c":
      return { terrain: "shore" };
    case "=":
      return { terrain: "bridge" };
    case "v":
      return { terrain: "village", structure: "village" };
    case "k":
      return { terrain: "keep", structure: "keep" };
    default:
      return { terrain: "plains" };
  }
}

function createBoard(rows: string[]): TileState[][] {
  const width = rows[0].length;
  return rows.map((row, y) =>
    row.split("").map((symbol, x) => {
      const base = toTerrain(symbol);
      const isLeftKeep = base.structure === "keep" && x < width / 2;
      const isRightKeep = base.structure === "keep" && x > width / 2;
      return {
        x,
        y,
        terrain: base.terrain,
        structure: base.structure,
        owner: isLeftKeep ? "sun" : isRightKeep ? "moon" : null
      };
    })
  );
}

function mirrorUnits(left: Array<{ kind: UnitKind; at: Coord }>, width: number): UnitState[] {
  return left.flatMap(({ kind, at }) => {
    const mirroredX = width - at.x - 1;
    const maxHp = unitDefinitions[kind].maxHp;
    return [
      {
        id: unitId("sun", kind, at.x, at.y),
        owner: "sun",
        kind,
        hp: maxHp,
        xp: 0,
        level: 1,
        x: at.x,
        y: at.y,
        moved: false,
        acted: false,
        captureProgress: 0
      },
      {
        id: unitId("moon", kind, mirroredX, at.y),
        owner: "moon",
        kind,
        hp: maxHp,
        xp: 0,
        level: 1,
        x: mirroredX,
        y: at.y,
        moved: false,
        acted: false,
        captureProgress: 0
      }
    ];
  });
}

function buildMap(
  id: string,
  name: string,
  halfRows: string[],
  units: Array<{ kind: UnitKind; at: Coord }>,
  description: string
): MapDefinition {
  const rows = halfRows.map((row) => mirrorRow(row));
  const board = createBoard(rows);
  return {
    id,
    name,
    description,
    size: {
      width: rows[0].length,
      height: rows.length
    },
    board,
    units: mirrorUnits(units, rows[0].length)
  };
}

export const maps: MapDefinition[] = [
  buildMap(
    "meadow-line",
    "Meadow Line",
    ["krr..", ".frv.", "..r..", "..rh.", "..r..", ".frv.", "krr.."],
    [
      { kind: "militia", at: { x: 1, y: 1 } },
      { kind: "swordsman", at: { x: 1, y: 3 } },
      { kind: "archer", at: { x: 2, y: 2 } },
      { kind: "pikeman", at: { x: 2, y: 4 } }
    ],
    "A quick opener with fast road pressure and exposed side villages."
  ),
  buildMap(
    "ashen-ford",
    "Ashen Ford",
    ["krr..~", ".frv.~", "..rrr=", ".h.rr~", "v.rr.~", ".h.rr~", "..rrr=", ".frv.~", "krr..~"],
    [
      { kind: "militia", at: { x: 1, y: 1 } },
      { kind: "swordsman", at: { x: 1, y: 4 } },
      { kind: "archer", at: { x: 2, y: 3 } },
      { kind: "cavalry", at: { x: 1, y: 6 } }
    ],
    "A central river splits the field, forcing early decisions between two bridge crossings and exposed villages."
  ),
  buildMap(
    "thornwatch",
    "Thornwatch",
    ["krrv..", ".ffr..", ".rhh..", "v.r.ss", ".rhh..", ".ffr..", "krrv.."],
    [
      { kind: "militia", at: { x: 1, y: 2 } },
      { kind: "swordsman", at: { x: 2, y: 3 } },
      { kind: "archer", at: { x: 2, y: 1 } },
      { kind: "pikeman", at: { x: 1, y: 4 } },
      { kind: "healer", at: { x: 0, y: 3 } }
    ],
    "A wooded ring around a central bog rewards infantry control and makes cavalry commit to clear lanes."
  ),
  buildMap(
    "sunken-road",
    "Sunken Road",
    ["krr.v.~", ".srr..~", ".hrrr.=", "v.sss.~", ".hrrr.=", ".srr..~", "krr.v.~"],
    [
      { kind: "militia", at: { x: 1, y: 1 } },
      { kind: "swordsman", at: { x: 2, y: 3 } },
      { kind: "archer", at: { x: 3, y: 2 } },
      { kind: "cavalry", at: { x: 2, y: 5 } },
      { kind: "healer", at: { x: 0, y: 3 } }
    ],
    "A flooded cut divides the long road, with two bridge approaches and a swampy center that punishes overextension."
  ),
  buildMap(
    "citadel-pass",
    "Citadel Pass",
    ["krr..v.~", ".f..hr.~", ".rr.r..=", "v..rrh.=", ".rr.r..=", ".f..hr.~", "krr..v.~"],
    [
      { kind: "militia", at: { x: 1, y: 1 } },
      { kind: "swordsman", at: { x: 2, y: 3 } },
      { kind: "archer", at: { x: 3, y: 2 } },
      { kind: "pikeman", at: { x: 1, y: 4 } },
      { kind: "cavalry", at: { x: 2, y: 5 } },
      { kind: "catapult", at: { x: 0, y: 3 } }
    ],
    "A larger siege map built around a river gate, bridge pressure, and elevated flanks for ranged pieces."
  ),
  buildMap(
    "lakewatch",
    "Lakewatch",
    ["krr..v..", ".fr..r..", "..r.cwww", "v.r.cwww", ".hr.cwww", "..r.cwww", ".fr..r..", "krr..v.."],
    [
      { kind: "militia", at: { x: 1, y: 1 } },
      { kind: "swordsman", at: { x: 2, y: 3 } },
      { kind: "archer", at: { x: 2, y: 4 } },
      { kind: "cavalry", at: { x: 1, y: 6 } },
      { kind: "assassin", at: { x: 1, y: 2 } }
    ],
    "A wide central lake blocks the middle, forcing armies through village roads and forested ambush lanes."
  )
];

export function getMapDefinition(id: string): MapDefinition {
  const found = maps.find((entry) => entry.id === id);
  return structuredClone(found ?? maps[0]);
}

export function getMapSummary(id: string): string {
  const found = maps.find((entry) => entry.id === id);
  return found ? `${found.name} - ${found.description}` : maps[0].description;
}

export function createInviteCode(): string {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

export function playerBannerName(player: PlayerId): string {
  return PLAYER_NAMES[player];
}
