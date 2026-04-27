import { createMatch, executeAiAction, maps, planAiTurn } from "../src/engine";
import { describe, expect, it } from "vitest";

function simulateAiMirror(mapId: string, maxTurns: number) {
  let match = createMatch(mapId, "ai");
  let totalActions = 0;

  while (!match.winner && match.turnNumber <= maxTurns) {
    const actingPlayer = match.currentPlayer;
    const plan = planAiTurn(match);
    expect(plan.player).toBe(actingPlayer);
    expect(plan.actions.length).toBeGreaterThan(0);

    for (const action of plan.actions) {
      const result = executeAiAction(match, action);
      expect(result.ok).toBe(true);
      match = result.state;
      totalActions += 1;
      if (match.winner) {
        break;
      }
    }

    expect(match.currentPlayer !== actingPlayer || Boolean(match.winner)).toBe(true);
  }

  return { winner: match.winner, turnNumber: match.turnNumber, totalActions };
}

describe("stability", () => {
  it(
    "lets AI complete legal turns on every map for at least 20 turns",
    () => {
      for (const map of maps) {
        const result = simulateAiMirror(map.id, 20);
        expect(result.totalActions).toBeGreaterThan(0);
      }
    },
    12000
  );

  it(
    "has at least three maps that converge by 40 turns under AI mirror play",
    () => {
      const outcomes = maps.map((map) => ({ map: map.name, ...simulateAiMirror(map.id, 40) }));
      const converged = outcomes.filter((outcome) => outcome.winner !== null);
      expect(converged.length).toBeGreaterThanOrEqual(3);
    },
    20000
  );
});
