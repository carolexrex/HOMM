import { createMatch, executeAiAction, planAiTurn } from "../src/engine";
import { describe, expect, it } from "vitest";

describe("ai", () => {
  it("stores the requested ai difficulty on solo matches", () => {
    const match = createMatch("meadow-line", "ai", "easy");
    expect(match.aiDifficulty).toBe("easy");
  });
  it("creates ai matches with an AI-controlled opposing banner", () => {
    const match = createMatch("meadow-line", "ai");
    expect(match.mode).toBe("ai");
    expect(match.players.moon.name).toContain("AI");
  });

  it("captures a free village when a militia can take one", () => {
    const match = createMatch("meadow-line", "ai");
    const militia = match.units.find((unit) => unit.owner === "sun" && unit.kind === "militia")!;
    const enemy = match.units.find((unit) => unit.owner === "moon")!;

    match.currentPlayer = "sun";
    match.players.sun.gold = 0;
    militia.x = 2;
    militia.y = 1;
    militia.moved = false;
    militia.acted = false;
    enemy.x = match.board[0].length - 1;
    enemy.y = match.board.length - 1;
    match.units = [militia, enemy];

    const plan = planAiTurn(match);
    let next = match;
    for (const action of plan.actions) {
      const result = executeAiAction(next, action);
      expect(result.ok).toBe(true);
      next = result.state;
    }

    const ownedVillages = next.board.flat().filter((tile) => tile.structure === "village" && tile.owner === "sun");
    expect(ownedVillages.length).toBeGreaterThan(0);
  });

  it("chooses a kill sequence against a vulnerable target", () => {
    const match = createMatch("meadow-line", "ai");
    const swordsman = match.units.find((unit) => unit.owner === "sun" && unit.kind === "swordsman")!;
    const lowMilitia = match.units.find((unit) => unit.owner === "moon" && unit.kind === "militia")!;
    const otherEnemy = match.units.find((unit) => unit.owner === "moon" && unit.id !== lowMilitia.id)!;

    match.currentPlayer = "sun";
    match.players.sun.gold = 0;
    swordsman.x = 4;
    swordsman.y = 3;
    swordsman.moved = false;
    swordsman.acted = false;
    lowMilitia.x = 5;
    lowMilitia.y = 3;
    lowMilitia.hp = 2;
    lowMilitia.moved = false;
    lowMilitia.acted = false;
    otherEnemy.x = 8;
    otherEnemy.y = 6;
    otherEnemy.moved = false;
    otherEnemy.acted = false;
    match.units = [swordsman, lowMilitia, otherEnemy];

    const plan = planAiTurn(match);
    expect(plan.actions.some((action) => action.type === "attack" && action.targetId === lowMilitia.id)).toBe(true);
    const firstAttack = plan.actions.find((action) => action.type === "attack");
    expect(firstAttack).toMatchObject({ type: "attack", attackerId: swordsman.id, targetId: lowMilitia.id });
  });
});
