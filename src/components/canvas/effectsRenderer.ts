import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { getUnitLevel } from "../../engine";
import type { Coord, MatchState, UnitState } from "../../engine";
import { clamp, lerp, projectCell } from "./geometry";
import {
  ARROW_COLOR,
  HEAL_COLOR,
  MOVE_ANIMATION_MS,
  POPUP_MS,
  PROJECTILE_MS,
  SLASH_MS,
  STONE_COLOR,
  type ActiveVisuals,
  type AttackVisual,
  type Layout,
  type MoveVisual,
  type PanState,
  type PopupVisual,
  type ProjectedCell
} from "./types";

const popupTextStyle = new TextStyle({ fill: 0xf4efe1, fontFamily: "Trebuchet MS", fontSize: 14, fontWeight: "700" });
const combatPreviewStyle = new TextStyle({ fill: 0xfff3ef, fontFamily: "Trebuchet MS", fontSize: 13, fontWeight: "800" });
const combatPreviewMetaStyle = new TextStyle({ fill: 0xffd7cf, fontFamily: "Trebuchet MS", fontSize: 9, fontWeight: "700" });

export function drawCombatPreview(root: Container, preview: { damage: number; retaliation: number }, cell: ProjectedCell, zoom: number) {
  const label = preview.retaliation > 0 ? `${preview.damage} / ${preview.retaliation}` : `${preview.damage}`;
  const meta = preview.retaliation > 0 ? "damage / back" : "damage";
  const valueText = new Text(label, combatPreviewStyle);
  const metaText = new Text(meta, combatPreviewMetaStyle);
  valueText.anchor.set(0.5, 0.5);
  metaText.anchor.set(0.5, 0.5);
  valueText.scale.set(Math.max(0.95, zoom * 1.02));
  metaText.scale.set(Math.max(0.9, zoom));

  const contentWidth = Math.max(valueText.width, metaText.width);
  const paddingX = Math.max(8, cell.size * 0.09);
  const width = Math.max(cell.size * 0.5, contentWidth + paddingX * 2);
  const height = Math.max(cell.size * 0.22, valueText.height + metaText.height + 8);
  const x = cell.centerX;
  const y = cell.centerY + cell.size * 0.1;

  const shadow = new Graphics();
  shadow.beginFill(0x090f12, 0.34);
  shadow.drawRoundedRect(x - width / 2, y - height / 2 + 2, width, height, height / 2);
  shadow.endFill();
  root.addChild(shadow);

  const chip = new Graphics();
  chip.beginFill(0x3f1112, 0.94);
  chip.lineStyle(Math.max(1.5, zoom * 1.7), 0xffb3a4, 0.96);
  chip.drawRoundedRect(x - width / 2, y - height / 2, width, height, height / 2);
  chip.endFill();
  root.addChild(chip);

  valueText.x = x;
  valueText.y = y - height * 0.16;
  valueText.tint = 0xffe7df;
  root.addChild(valueText);

  metaText.x = x;
  metaText.y = y + height * 0.2;
  metaText.alpha = 0.92;
  root.addChild(metaText);
}

export function drawPopupEffect(root: Container, popup: PopupVisual, layout: Layout, pan: PanState, zoom: number, now: number) {
  const progress = clamp((now - popup.start) / popup.duration, 0, 1);
  const projected = projectCell(popup.coord, layout, pan, zoom);
  const label = new Text(popup.label, popupTextStyle);
  label.anchor.set(0.5);
  label.x = projected.centerX;
  label.y = projected.centerY - projected.size * (0.15 + progress * 0.3);
  label.alpha = 1 - progress;
  label.tint = popup.color;
  root.addChild(label);
}

export function drawAttackEffect(root: Container, attack: AttackVisual, layout: Layout, pan: PanState, zoom: number, now: number) {
  const progress = clamp((now - attack.start) / attack.duration, 0, 1);
  const from = projectCell(attack.from, layout, pan, zoom);
  const to = projectCell(attack.to, layout, pan, zoom);
  const effect = new Graphics();

  if (attack.kind === "slash") {
    effect.lineStyle(Math.max(2, zoom * 3), attack.color, 1 - progress * 0.25);
    effect.moveTo(to.centerX - to.size * 0.18, to.centerY - to.size * 0.16);
    effect.lineTo(to.centerX + to.size * 0.2, to.centerY + to.size * 0.12);
  } else if (attack.kind === "heal") {
    effect.lineStyle(Math.max(2, zoom * 2.5), attack.color, 0.8);
    effect.moveTo(from.centerX, from.centerY - from.size * 0.08);
    effect.lineTo(to.centerX, to.centerY - to.size * 0.08);
    effect.beginFill(attack.color, 0.18 * (1 - progress));
    effect.drawCircle(to.centerX, to.centerY - to.size * 0.08, to.size * (0.12 + 0.1 * progress));
    effect.endFill();
  } else {
    const projectileX = lerp(from.centerX, to.centerX, progress);
    const projectileY = lerp(from.centerY - from.size * 0.12, to.centerY - to.size * 0.12, progress);
    effect.lineStyle(Math.max(1.5, zoom * 2), attack.color, 0.38);
    effect.moveTo(from.centerX, from.centerY - from.size * 0.12);
    effect.lineTo(projectileX, projectileY);
    effect.beginFill(attack.color, 0.96);
    if (attack.kind === "stone") effect.drawCircle(projectileX, projectileY, Math.max(3, zoom * 5));
    else effect.drawRoundedRect(projectileX - Math.max(2, zoom * 5), projectileY - 1, Math.max(6, zoom * 10), 2, 2);
    effect.endFill();
  }

  root.addChild(effect);
}

export function interpolateMove(move: MoveVisual, now: number): Coord {
  const progress = clamp((now - move.start) / move.duration, 0, 1);
  return { x: lerp(move.from.x, move.to.x, progress), y: lerp(move.from.y, move.to.y, progress) };
}

export function buildVisualDiff(previous: MatchState, next: MatchState, now: number, animateMovement: boolean): ActiveVisuals {
  const previousUnits = new Map(previous.units.map((unit) => [unit.id, unit]));
  const nextUnits = new Map(next.units.map((unit) => [unit.id, unit]));
  const moves: MoveVisual[] = [];
  const popups: PopupVisual[] = [];
  const attacks: AttackVisual[] = [];

  for (const unit of next.units) {
    const oldUnit = previousUnits.get(unit.id);
    if (!oldUnit) continue;
    if (oldUnit.x !== unit.x || oldUnit.y !== unit.y) {
      moves.push({ unitId: unit.id, from: { x: oldUnit.x, y: oldUnit.y }, to: { x: unit.x, y: unit.y }, start: now, duration: animateMovement ? MOVE_ANIMATION_MS : 1 });
    }
    if (oldUnit.hp !== unit.hp) {
      const delta = unit.hp - oldUnit.hp;
      popups.push({ id: `${unit.id}-${now}-hp`, coord: { x: unit.x, y: unit.y }, label: delta > 0 ? `+${delta}` : `${delta}`, color: delta > 0 ? HEAL_COLOR : 0xffb2a4, start: now, duration: POPUP_MS });
    }
    if (getUnitLevel(unit) > getUnitLevel(oldUnit)) {
      popups.push({ id: `${unit.id}-${now}-level`, coord: { x: unit.x, y: unit.y }, label: "Level up!", color: 0xf1c26a, start: now, duration: POPUP_MS + 260 });
    }
  }

  const actor = detectActingUnit(previous, next);
  if (actor) {
    const harmed = collectChangedTargets(previous, next, actor.owner, "enemy");
    const healed = collectChangedTargets(previous, next, actor.owner, "ally", true);
    if (healed.length > 0 && actor.kind === "healer") {
      attacks.push({ id: `heal-${actor.id}-${now}`, kind: "heal", from: { x: actor.x, y: actor.y }, to: healed[0], color: HEAL_COLOR, start: now, duration: PROJECTILE_MS });
    } else if (harmed.length > 0) {
      const kind = actor.kind === "archer" ? "arrow" : actor.kind === "catapult" ? "stone" : "slash";
      const color = actor.kind === "catapult" ? STONE_COLOR : actor.kind === "archer" ? ARROW_COLOR : 0xffd17a;
      attacks.push({ id: `attack-${actor.id}-${now}`, kind, from: { x: actor.x, y: actor.y }, to: harmed[0], color, start: now, duration: kind === "slash" ? SLASH_MS : PROJECTILE_MS });
    }
  }

  for (const [id, oldUnit] of previousUnits) {
    if (!nextUnits.has(id)) popups.push({ id: `${id}-${now}-ko`, coord: { x: oldUnit.x, y: oldUnit.y }, label: "KO", color: 0xffb2a4, start: now, duration: POPUP_MS });
  }

  return { moves, popups, attacks };
}

function detectActingUnit(previous: MatchState, next: MatchState): UnitState | null {
  return next.units.find((unit) => {
    const oldUnit = previous.units.find((candidate) => candidate.id === unit.id);
    if (!oldUnit || unit.owner !== previous.currentPlayer) return false;
    return (!oldUnit.acted && unit.acted) || (!oldUnit.moved && unit.moved && oldUnit.x === unit.x && oldUnit.y === unit.y);
  }) ?? null;
}

function collectChangedTargets(previous: MatchState, next: MatchState, owner: UnitState["owner"], side: "enemy" | "ally", healing = false): Coord[] {
  const targets: Array<{ coord: Coord; magnitude: number }> = [];
  for (const oldUnit of previous.units) {
    const nextUnit = next.units.find((unit) => unit.id === oldUnit.id);
    const matchesSide = side === "enemy" ? oldUnit.owner !== owner : oldUnit.owner === owner;
    if (!matchesSide) continue;
    if (!nextUnit) {
      targets.push({ coord: { x: oldUnit.x, y: oldUnit.y }, magnitude: oldUnit.hp });
      continue;
    }
    const delta = nextUnit.hp - oldUnit.hp;
    if (healing ? delta > 0 : delta < 0) targets.push({ coord: { x: nextUnit.x, y: nextUnit.y }, magnitude: Math.abs(delta) });
  }
  return targets.sort((left, right) => right.magnitude - left.magnitude).map((entry) => entry.coord);
}

export function pruneVisuals(visuals: ActiveVisuals, now: number): ActiveVisuals {
  return {
    moves: visuals.moves.filter((move) => now - move.start < move.duration),
    popups: visuals.popups.filter((popup) => now - popup.start < popup.duration),
    attacks: visuals.attacks.filter((attack) => now - attack.start < attack.duration)
  };
}

export function hasActiveVisuals(visuals: ActiveVisuals) {
  return visuals.moves.length > 0 || visuals.popups.length > 0 || visuals.attacks.length > 0;
}
