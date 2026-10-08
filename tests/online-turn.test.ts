import {
  MAX_ONLINE_TURN_ACTIONS,
  applyOnlineTurnSubmission,
  createInviteCode,
  createMatch,
  type TurnAction
} from "../src/engine";
import { describe, expect, it } from "vitest";

describe("online turn submissions", () => {
  it("accepts one complete turn and passes control once", () => {
    const match = createMatch("meadow-line", "online");
    const result = applyOnlineTurnSubmission(match, "sun", [{ type: "end_turn" }]);

    expect(result.ok).toBe(true);
    expect(result.state.currentPlayer).toBe("moon");
    expect(result.state.turnNumber).toBe(match.turnNumber + 1);
  });

  it("rejects submissions that cross more than one turn boundary", () => {
    const match = createMatch("meadow-line", "online");
    const result = applyOnlineTurnSubmission(match, "sun", [
      { type: "end_turn" },
      { type: "end_turn" },
      { type: "end_turn" }
    ]);

    expect(result.ok).toBe(false);
    expect(result.state.currentPlayer).toBe("sun");
    expect(result.state.turnNumber).toBe(match.turnNumber);
    if (!result.ok) expect(result.error).toContain("one end_turn");
  });

  it("accepts a terminal combat win without requiring end_turn", () => {
    const match = createMatch("meadow-line", "online");
    const attacker = match.units.find((unit) => unit.owner === "sun" && unit.kind === "swordsman")!;
    const defender = match.units.find((unit) => unit.owner === "moon" && unit.kind === "militia")!;

    attacker.x = 3;
    attacker.y = 3;
    attacker.moved = false;
    attacker.acted = false;
    defender.x = 4;
    defender.y = 3;
    defender.hp = 1;
    match.units = [attacker, defender];

    const result = applyOnlineTurnSubmission(match, "sun", [
      { type: "attack", attackerId: attacker.id, targetId: defender.id }
    ]);

    expect(result.ok).toBe(true);
    expect(result.state.winner).toBe("sun");
    expect(result.state.turnNumber).toBe(match.turnNumber);
  });

  it("rejects non-winning partial turns and malformed actions", () => {
    const match = createMatch("meadow-line", "online");
    const unit = match.units.find((entry) => entry.owner === "sun")!;

    const partial = applyOnlineTurnSubmission(match, "sun", [
      { type: "move", unitId: unit.id, to: { x: unit.x, y: unit.y } }
    ]);
    const malformed = applyOnlineTurnSubmission(match, "sun", [
      { type: "move", unitId: unit.id, to: { x: "bad", y: 1 } }
    ]);

    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.error).toContain("must end with end_turn");
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error).toContain("malformed");
  });

  it("caps submitted action counts", () => {
    const match = createMatch("meadow-line", "online");
    const actions: TurnAction[] = Array.from(
      { length: MAX_ONLINE_TURN_ACTIONS + 1 },
      () => ({ type: "end_turn" })
    );
    const result = applyOnlineTurnSubmission(match, "sun", actions);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(MAX_ONLINE_TURN_ACTIONS));
  });
});

describe("online invite codes", () => {
  it("uses ten cryptographically generated, unambiguous characters", () => {
    const codes = Array.from({ length: 32 }, () => createInviteCode());

    expect(codes.every((code) => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/.test(code))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
