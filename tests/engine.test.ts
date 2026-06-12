import { attackUnit, availableTargets, createMatch, estimateAttack, getUnitLevel, healUnit, maps, moveUnit, recruitUnit, reachableTiles, unitDefinitions } from "../src/engine";
import { describe, expect, it } from "vitest";

describe("engine", () => {
  it("creates a mirrored map with two banners", () => {
    const match = createMatch("meadow-line", "hotseat");
    expect(match.board[0][0].structure).toBe("keep");
    expect(match.players.sun.gold).toBe(360);
    expect(match.units.filter((unit) => unit.owner === "sun")).toHaveLength(4);
  });

  it("starts every map unit at its definition max HP", () => {
    for (const map of maps) {
      for (const unit of map.units) {
        expect(unit.hp).toBe(unitDefinitions[unit.kind].maxHp);
      }
    }
  });

  it("recruits from an empty keep and spends gold", () => {
    const match = createMatch("meadow-line", "hotseat");
    const result = recruitUnit(match, "militia");
    expect(result.ok).toBe(true);
    expect(result.state.players.sun.gold).toBe(260);
    expect(result.state.units.filter((unit) => unit.owner === "sun")).toHaveLength(5);
  });

  it("lets cavalry advance onto a reachable open tile", () => {
    const match = createMatch("ashen-ford", "hotseat");
    const cavalry = match.units.find((unit) => unit.owner === "sun" && unit.kind === "cavalry");
    expect(cavalry).toBeDefined();
    const destination = reachableTiles(match, cavalry!.id).find(
      (tile) => tile.x !== cavalry!.x || tile.y !== cavalry!.y
    );
    expect(destination).toBeDefined();
    const result = moveUnit(match, cavalry!.id, destination!);
    expect(result.ok).toBe(true);
    expect(result.state.units.find((unit) => unit.id === cavalry!.id)?.x).toBe(destination!.x);
    expect(result.state.units.find((unit) => unit.id === cavalry!.id)?.y).toBe(destination!.y);
  });

  it("gives archers +1 range on hills", () => {
    const match = createMatch("meadow-line", "hotseat");
    const archer = match.units.find((unit) => unit.owner === "sun" && unit.kind === "archer")!;
    const target = match.units.find((unit) => unit.owner === "moon" && unit.kind === "militia")!;

    archer.x = 4;
    archer.y = 3;
    archer.moved = false;
    archer.acted = false;
    match.board[3][4].terrain = "hill";

    target.x = 7;
    target.y = 3;
    target.moved = false;
    target.acted = false;
    match.currentPlayer = "sun";

    expect(availableTargets(match, archer.id).some((unit) => unit.id === target.id)).toBe(true);
    const attack = attackUnit(match, archer.id, target.id);
    expect(attack.ok).toBe(true);
  });

  it("does not advertise catapult attacks after moving", () => {
    const match = createMatch("citadel-pass", "hotseat");
    const catapult = match.units.find((unit) => unit.owner === "sun" && unit.kind === "catapult")!;
    const target = match.units.find((unit) => unit.owner === "moon")!;

    catapult.x = 3;
    catapult.y = 3;
    catapult.moved = true;
    catapult.acted = false;
    target.x = 5;
    target.y = 3;
    match.units = [catapult, target];
    match.currentPlayer = "sun";

    expect(availableTargets(match, catapult.id)).toHaveLength(0);
    expect(attackUnit(match, catapult.id, target.id).ok).toBe(false);
  });

  it("awards combat XP and uses elite combat bonuses", () => {
    const match = createMatch("meadow-line", "hotseat");
    const sunSword = match.units.find((unit) => unit.owner === "sun" && unit.kind === "swordsman")!;
    const moonSword = match.units.find((unit) => unit.owner === "moon" && unit.kind === "swordsman")!;

    sunSword.x = 3;
    sunSword.y = 3;
    sunSword.moved = false;
    sunSword.acted = false;
    moonSword.x = 4;
    moonSword.y = 3;
    moonSword.moved = false;
    moonSword.acted = false;
    match.currentPlayer = "sun";

    const rookiePreview = estimateAttack(match, sunSword, moonSword);
    sunSword.xp = 22;
    sunSword.level = 3;
    const elitePreview = estimateAttack(match, sunSword, moonSword);
    expect(getUnitLevel(sunSword)).toBe(3);
    expect(elitePreview.damage).toBeGreaterThanOrEqual(rookiePreview.damage);

    sunSword.xp = 0;
    sunSword.level = 1;
    const attack = attackUnit(match, sunSword.id, moonSword.id);
    expect(attack.ok).toBe(true);
    expect(attack.state.units.find((unit) => unit.id === sunSword.id)?.xp).toBeGreaterThan(0);
    expect(attack.state.units.find((unit) => unit.id === moonSword.id)?.xp).toBeGreaterThan(0);
  });

  it("resolves melee combat with retaliation", () => {
    const match = createMatch("meadow-line", "hotseat");
    const sunSword = match.units.find((unit) => unit.owner === "sun" && unit.kind === "swordsman")!;
    const moonSword = match.units.find((unit) => unit.owner === "moon" && unit.kind === "swordsman")!;

    sunSword.x = 3;
    sunSword.y = 3;
    sunSword.moved = false;
    sunSword.acted = false;
    moonSword.x = 4;
    moonSword.y = 3;
    moonSword.moved = false;
    moonSword.acted = false;
    match.currentPlayer = "sun";

    const attack = attackUnit(match, sunSword.id, moonSword.id);
    expect(attack.ok).toBe(true);
    const updatedAttacker = attack.state.units.find((unit) => unit.id === sunSword.id)!;
    const updatedDefender = attack.state.units.find((unit) => unit.id === moonSword.id)!;
    expect(updatedAttacker.hp).toBeLessThan(10);
    expect(updatedDefender.hp).toBeLessThan(10);
  });

  it("lets assassins ambush from forest without retaliation", () => {
    const match = createMatch("meadow-line", "hotseat");
    const result = recruitUnit(match, "assassin");
    expect(result.ok).toBe(true);

    const assassin = result.state.units.find((unit) => unit.owner === "sun" && unit.kind === "assassin")!;
    const moonSword = result.state.units.find((unit) => unit.owner === "moon" && unit.kind === "swordsman")!;

    assassin.x = 3;
    assassin.y = 3;
    assassin.moved = false;
    assassin.acted = false;
    result.state.board[3][3].terrain = "forest";
    moonSword.x = 4;
    moonSword.y = 3;
    moonSword.moved = false;
    moonSword.acted = false;
    result.state.currentPlayer = "sun";

    const preview = estimateAttack(result.state, assassin, moonSword);
    expect(preview.damage).toBeGreaterThan(1);
    expect(preview.retaliation).toBe(0);

    const attack = attackUnit(result.state, assassin.id, moonSword.id);
    expect(attack.ok).toBe(true);
    expect(attack.state.units.find((unit) => unit.id === assassin.id)?.hp).toBe(8);
  });

  it("rejects healing after the match is finished", () => {
    const match = createMatch("thornwatch", "hotseat");
    const healer = match.units.find((unit) => unit.owner === "sun" && unit.kind === "healer")!;
    const ally = match.units.find((unit) => unit.owner === "sun" && unit.id !== healer.id)!;

    healer.x = 3;
    healer.y = 3;
    healer.acted = false;
    ally.x = 4;
    ally.y = 3;
    ally.hp = 4;
    match.currentPlayer = "sun";
    match.winner = "sun";

    const result = healUnit(match, healer.id, ally.id);
    expect(result.ok).toBe(false);
    expect(result.issue?.code).toBe("match-finished");
  });
});
