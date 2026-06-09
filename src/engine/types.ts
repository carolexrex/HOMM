export type PlayerId = "sun" | "moon";

export type MatchMode = "hotseat" | "online" | "ai";
export type AiDifficultyLevel = "easy" | "normal" | "hard";
export type EconomyMode = "standard" | "skirmish";

export type TerrainKind =
  | "plains"
  | "forest"
  | "hill"
  | "road"
  | "swamp"
  | "river"
  | "water"
  | "shore"
  | "bridge"
  | "village"
  | "keep";

export type StructureKind = "village" | "keep";

export type UnitKind =
  | "militia"
  | "swordsman"
  | "pikeman"
  | "archer"
  | "cavalry"
  | "assassin"
  | "catapult"
  | "healer";

export type UnitClass = "foot" | "cavalry" | "siege";

export interface Coord {
  x: number;
  y: number;
}

export interface TileState {
  x: number;
  y: number;
  terrain: TerrainKind;
  structure?: StructureKind;
  owner: PlayerId | null;
}

export interface UnitDefinition {
  kind: UnitKind;
  label: string;
  className: UnitClass;
  maxHp: number;
  move: number;
  minRange: number;
  maxRange: number;
  attack: number;
  retaliationAttack: number;
  cost: number;
  canCapture: boolean;
  canHeal: boolean;
  cannotAttackAfterMove?: boolean;
  splash?: number;
  notes: string[];
}

export interface TerrainDefinition {
  kind: TerrainKind;
  label: string;
  defense: number;
  moveCost: Record<UnitClass, number>;
  attackBonus: Partial<Record<UnitKind, number>>;
  visionBonus?: number;
  notes: string[];
}

export interface UnitState {
  id: string;
  owner: PlayerId;
  kind: UnitKind;
  hp: number;
  xp?: number;
  level?: 1 | 2 | 3;
  x: number;
  y: number;
  moved: boolean;
  acted: boolean;
  captureProgress: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  gold: number;
}

export interface MatchRules {
  economyMode?: EconomyMode;
}

export interface MapDefinition {
  id: string;
  name: string;
  size: {
    width: number;
    height: number;
  };
  board: TileState[][];
  units: UnitState[];
  description: string;
}

export interface MatchState {
  id: string;
  mode: MatchMode;
  aiDifficulty?: AiDifficultyLevel;
  rules?: MatchRules;
  mapId: string;
  mapName: string;
  board: TileState[][];
  units: UnitState[];
  players: Record<PlayerId, PlayerState>;
  currentPlayer: PlayerId;
  turnNumber: number;
  winner: PlayerId | null;
  inviteCode: string | null;
  log: string[];
  createdAt: string;
}

export type GameIssueCode =
  | "not-your-turn"
  | "unit-not-found"
  | "tile-occupied"
  | "unreachable"
  | "out-of-range"
  | "already-acted"
  | "already-moved"
  | "invalid-recruit"
  | "insufficient-gold"
  | "friendly-fire"
  | "match-finished"
  | "not-healer"
  | "full-health";

export interface GameIssue {
  code: GameIssueCode;
  message: string;
}

export interface GameResult {
  ok: boolean;
  state: MatchState;
  issue?: GameIssue;
}

export interface ReachableNode extends Coord {
  cost: number;
}

export interface AttackPreview {
  targetId: string;
  damage: number;
  retaliation: number;
  splash: number;
}

export type TurnAction =
  | { type: "move"; unitId: string; to: Coord }
  | { type: "attack"; attackerId: string; targetId: string }
  | { type: "heal"; healerId: string; targetId: string }
  | { type: "recruit"; kind: UnitKind }
  | { type: "end_turn" };



