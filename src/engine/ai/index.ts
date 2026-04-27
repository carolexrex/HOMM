import type { MatchMode, PlayerId } from "../types.ts";

export * from "./types.ts";
export * from "./planner.ts";

export function isAiControlledPlayer(mode: MatchMode, player: PlayerId): boolean {
  return mode === "ai" && player === "moon";
}
