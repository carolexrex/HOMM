import type {
  PlayerId,
  TerrainDefinition,
  TerrainKind,
  UnitDefinition,
  UnitKind
} from "./types.ts";

export const PLAYER_NAMES: Record<PlayerId, string> = {
  sun: "Amber Host",
  moon: "Verdant Pact"
};

export const PLAYER_COLORS: Record<PlayerId, number> = {
  sun: 0xf0b45b,
  moon: 0x7ac4bf
};

export const unitDefinitions: Record<UnitKind, UnitDefinition> = {
  militia: {
    kind: "militia",
    label: "Militia",
    className: "foot",
    maxHp: 10,
    move: 4,
    minRange: 1,
    maxRange: 1,
    attack: 3,
    retaliationAttack: 2,
    cost: 100,
    canCapture: true,
    canHeal: false,
    notes: ["Cheap capture unit", "Wins through economy, not damage"]
  },
  swordsman: {
    kind: "swordsman",
    label: "Swordsman",
    className: "foot",
    maxHp: 10,
    move: 4,
    minRange: 1,
    maxRange: 1,
    attack: 5,
    retaliationAttack: 4,
    cost: 180,
    canCapture: true,
    canHeal: false,
    notes: ["Reliable frontline", "No hard counters"]
  },
  pikeman: {
    kind: "pikeman",
    label: "Pikeman",
    className: "foot",
    maxHp: 10,
    move: 4,
    minRange: 1,
    maxRange: 1,
    attack: 4,
    retaliationAttack: 4,
    cost: 190,
    canCapture: true,
    canHeal: false,
    notes: ["Bonus vs cavalry", "Strong on defense"]
  },
  archer: {
    kind: "archer",
    label: "Archer",
    className: "foot",
    maxHp: 10,
    move: 4,
    minRange: 2,
    maxRange: 2,
    attack: 5,
    retaliationAttack: 0,
    cost: 210,
    canCapture: false,
    canHeal: false,
    notes: ["Ranged pressure", "+1 range on hills", "Weak in melee"]
  },
  cavalry: {
    kind: "cavalry",
    label: "Cavalry",
    className: "cavalry",
    maxHp: 10,
    move: 6,
    minRange: 1,
    maxRange: 1,
    attack: 6,
    retaliationAttack: 4,
    cost: 260,
    canCapture: false,
    canHeal: false,
    notes: ["Flanking specialist", "Bad in forests and swamps"]
  },
  assassin: {
    kind: "assassin",
    label: "Assassin",
    className: "foot",
    maxHp: 8,
    move: 5,
    minRange: 1,
    maxRange: 1,
    attack: 2,
    retaliationAttack: 1,
    cost: 240,
    canCapture: false,
    canHeal: false,
    notes: ["Fragile ambusher", "+4 attack from forests and swamps", "Ambush attacks avoid retaliation"]
  },
  catapult: {
    kind: "catapult",
    label: "Catapult",
    className: "siege",
    maxHp: 10,
    move: 3,
    minRange: 2,
    maxRange: 3,
    attack: 7,
    retaliationAttack: 0,
    cost: 320,
    canCapture: false,
    canHeal: false,
    cannotAttackAfterMove: true,
    splash: 1,
    notes: ["Siege and splash", "Cannot fire after moving"]
  },
  healer: {
    kind: "healer",
    label: "Healer",
    className: "foot",
    maxHp: 10,
    move: 4,
    minRange: 1,
    maxRange: 1,
    attack: 1,
    retaliationAttack: 1,
    cost: 220,
    canCapture: false,
    canHeal: true,
    notes: ["Restores nearby allies", "Low offense"]
  }
};

export const terrainDefinitions: Record<TerrainKind, TerrainDefinition> = {
  plains: {
    kind: "plains",
    label: "Plains",
    defense: 0,
    moveCost: { foot: 1, cavalry: 1, siege: 1 },
    attackBonus: {},
    notes: ["Neutral ground"]
  },
  forest: {
    kind: "forest",
    label: "Forest",
    defense: 2,
    moveCost: { foot: 1, cavalry: 2, siege: 2 },
    attackBonus: { archer: 1, swordsman: 1, pikeman: 1, assassin: 4 },
    notes: ["Good cover", "Slows cavalry"]
  },
  hill: {
    kind: "hill",
    label: "Hill",
    defense: 1,
    moveCost: { foot: 2, cavalry: 2, siege: 3 },
    attackBonus: { archer: 2, catapult: 1 },
    visionBonus: 1,
    notes: ["Boosts ranged fire"]
  },
  road: {
    kind: "road",
    label: "Road",
    defense: -1,
    moveCost: { foot: 1, cavalry: 1, siege: 1 },
    attackBonus: {},
    notes: ["Fast but exposed"]
  },
  swamp: {
    kind: "swamp",
    label: "Swamp",
    defense: 0,
    moveCost: { foot: 2, cavalry: 3, siege: 4 },
    attackBonus: { assassin: 4 },
    notes: ["Heavy movement penalty"]
  },
  river: {
    kind: "river",
    label: "River",
    defense: 0,
    moveCost: { foot: 999, cavalry: 999, siege: 999 },
    attackBonus: {},
    notes: ["Impassable unless bridged"]
  },
  water: {
    kind: "water",
    label: "Water",
    defense: 0,
    moveCost: { foot: 999, cavalry: 999, siege: 999 },
    attackBonus: {},
    notes: ["Impassable deep water"]
  },
  shore: {
    kind: "shore",
    label: "Shore",
    defense: 0,
    moveCost: { foot: 999, cavalry: 999, siege: 999 },
    attackBonus: {},
    notes: ["Impassable water edge"]
  },
  bridge: {
    kind: "bridge",
    label: "Bridge",
    defense: -1,
    moveCost: { foot: 1, cavalry: 1, siege: 1 },
    attackBonus: {},
    notes: ["River crossing chokepoint"]
  },
  village: {
    kind: "village",
    label: "Village",
    defense: 2,
    moveCost: { foot: 1, cavalry: 1, siege: 2 },
    attackBonus: {},
    notes: ["Generates gold when held"]
  },
  keep: {
    kind: "keep",
    label: "Keep",
    defense: 3,
    moveCost: { foot: 1, cavalry: 1, siege: 1 },
    attackBonus: {},
    notes: ["Recruitment and victory point"]
  }
};

export const recruitOrder: UnitKind[] = [
  "militia",
  "swordsman",
  "pikeman",
  "archer",
  "cavalry",
  "assassin",
  "healer",
  "catapult"
];

export const captureThreshold = 10;
export const baseIncome = 80;
export const villageIncome = 40;

export const terrainPalette: Record<TerrainKind, number> = {
  plains: 0x9fae6d,
  forest: 0x456d3f,
  hill: 0x8b7750,
  road: 0xb59f72,
  swamp: 0x4a5b42,
  river: 0x406b89,
  water: 0x315f78,
  shore: 0x5f8368,
  bridge: 0xa68758,
  village: 0x8f7147,
  keep: 0x725345
};


