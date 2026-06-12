import { Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { getUnitLevel, PLAYER_COLORS, unitDefinitions } from "../../engine";
import type { UnitKind, UnitState } from "../../engine";
import militiaUrl from "../../assets/units/militia.png";
import swordsmanUrl from "../../assets/units/swordsman.png";
import pikemanUrl from "../../assets/units/pikeman.png";
import archerUrl from "../../assets/units/archer.png";
import cavalryUrl from "../../assets/units/cavalry.png";
import assassinUrl from "../../assets/units/assassin.png";
import catapultUrl from "../../assets/units/catapult.png";
import healerUrl from "../../assets/units/healer.png";
import { NATURAL_CELL } from "./types";

const popupDarkStyle = new TextStyle({ fill: 0x102125, fontFamily: "Trebuchet MS", fontSize: 10, fontWeight: "700" });

const unitTextures: Record<UnitKind, Texture> = {
  militia: Texture.from(militiaUrl),
  swordsman: Texture.from(swordsmanUrl),
  pikeman: Texture.from(pikemanUrl),
  archer: Texture.from(archerUrl),
  cavalry: Texture.from(cavalryUrl),
  assassin: Texture.from(assassinUrl),
  catapult: Texture.from(catapultUrl),
  healer: Texture.from(healerUrl)
};

const unitSpriteTuning: Record<UnitKind, { scale: number; yOffset: number }> = {
  militia: { scale: 0.9, yOffset: 0.01 },
  swordsman: { scale: 0.92, yOffset: 0.01 },
  pikeman: { scale: 0.98, yOffset: 0.015 },
  archer: { scale: 0.98, yOffset: 0.015 },
  cavalry: { scale: 1.04, yOffset: 0.02 },
  assassin: { scale: 0.95, yOffset: 0.01 },
  catapult: { scale: 1.08, yOffset: 0.03 },
  healer: { scale: 0.96, yOffset: 0.01 }
};

export function getUnitRenderSize(zoom: number) {
  return NATURAL_CELL * zoom;
}

export function drawUnit(root: Container, unit: UnitState, x: number, y: number, size: number, zoom: number, selected: boolean) {
  const container = new Container();
  container.x = x;
  container.y = y;
  container.alpha = 1;

  const teamColor = PLAYER_COLORS[unit.owner];
  const tuning = unitSpriteTuning[unit.kind];

  const shadow = new Graphics();
  shadow.beginFill(0x081214, 0.3);
  shadow.drawEllipse(size * 0.5, size * 0.8, size * 0.23, size * 0.09);
  shadow.endFill();
  container.addChild(shadow);

  const sprite = new Sprite(unitTextures[unit.kind]);
  sprite.anchor.set(0.5, 1);
  sprite.x = size * 0.5;
  sprite.y = size * (0.72 + tuning.yOffset);
  const spriteSize = size * 0.84 * tuning.scale;
  sprite.width = spriteSize;
  sprite.height = spriteSize;
  sprite.roundPixels = true;
  container.addChild(sprite);

  const teamBadgeShadow = new Graphics();
  teamBadgeShadow.beginFill(0x081214, 0.38);
  teamBadgeShadow.drawCircle(size * 0.19, size * 0.14, size * 0.095);
  teamBadgeShadow.endFill();
  container.addChild(teamBadgeShadow);

  const teamBadgeRing = new Graphics();
  teamBadgeRing.lineStyle(Math.max(2, size * 0.022), 0xf4efe1, 0.94);
  teamBadgeRing.beginFill(teamColor, 0.98);
  teamBadgeRing.drawCircle(size * 0.19, size * 0.14, size * 0.068);
  teamBadgeRing.endFill();
  container.addChild(teamBadgeRing);

  if (unit.acted || unit.moved) {
    const badgeX = size * 0.81;
    const badgeY = size * 0.15;
    const badgeRadius = size * 0.078;

    const statusShadow = new Graphics();
    statusShadow.beginFill(0x081214, 0.42);
    statusShadow.drawCircle(badgeX, badgeY + size * 0.008, badgeRadius + size * 0.012);
    statusShadow.endFill();
    container.addChild(statusShadow);

    const statusBadge = new Graphics();
    statusBadge.lineStyle(Math.max(2, size * 0.022), unit.acted ? 0x132126 : 0x5a3912, 0.98);
    statusBadge.beginFill(unit.acted ? 0xf4efe1 : 0xf1c26a, 0.98);
    statusBadge.drawCircle(badgeX, badgeY, badgeRadius);
    statusBadge.endFill();
    container.addChild(statusBadge);

    const statusMark = new Graphics();
    statusMark.lineStyle(Math.max(2.5, size * 0.032), unit.acted ? 0x132126 : 0x5a3912, 1, 0.5, true);
    if (unit.acted) {
      statusMark.moveTo(badgeX - size * 0.032, badgeY + size * 0.002);
      statusMark.lineTo(badgeX - size * 0.008, badgeY + size * 0.03);
      statusMark.lineTo(badgeX + size * 0.038, badgeY - size * 0.03);
    } else {
      statusMark.moveTo(badgeX - size * 0.036, badgeY + size * 0.018);
      statusMark.lineTo(badgeX + size * 0.018, badgeY + size * 0.018);
      statusMark.moveTo(badgeX + size * 0.018, badgeY + size * 0.018);
      statusMark.lineTo(badgeX - size * 0.002, badgeY - size * 0.002);
      statusMark.moveTo(badgeX + size * 0.018, badgeY + size * 0.018);
      statusMark.lineTo(badgeX - size * 0.002, badgeY + size * 0.038);
    }
    container.addChild(statusMark);
  }

  const hpTrackY = size * 0.84;
  const level = getUnitLevel(unit);
  if (level > 1) {
    const pipCount = level - 1;
    const plateWidth = size * (pipCount === 1 ? 0.16 : 0.24);
    const plateX = size * 0.5 - plateWidth / 2;
    const plateY = hpTrackY - size * 0.1;

    const veteranPlateShadow = new Graphics();
    veteranPlateShadow.beginFill(0x081214, 0.36);
    veteranPlateShadow.drawRoundedRect(plateX, plateY + size * 0.008, plateWidth, size * 0.072, size * 0.03);
    veteranPlateShadow.endFill();
    container.addChild(veteranPlateShadow);

    const veteranPlate = new Graphics();
    veteranPlate.beginFill(0x102125, 0.88);
    veteranPlate.lineStyle(Math.max(1.5, size * 0.016), 0xf1c26a, 0.9);
    veteranPlate.drawRoundedRect(plateX, plateY, plateWidth, size * 0.072, size * 0.03);
    veteranPlate.endFill();
    container.addChild(veteranPlate);

    const veteranMarks = new Graphics();
    veteranMarks.beginFill(0xf1c26a, 1);
    veteranMarks.lineStyle(Math.max(1, size * 0.011), 0x4f3a18, 0.92);
    const gap = size * 0.064;
    const startX = size * 0.5 - ((pipCount - 1) * gap) / 2;
    const cy = plateY + size * 0.036;
    const radius = size * 0.022;
    for (let mark = 0; mark < pipCount; mark += 1) {
      const cx = startX + mark * gap;
      veteranMarks.moveTo(cx, cy - radius);
      veteranMarks.lineTo(cx + radius, cy);
      veteranMarks.lineTo(cx, cy + radius);
      veteranMarks.lineTo(cx - radius, cy);
      veteranMarks.lineTo(cx, cy - radius);
    }
    veteranMarks.endFill();
    container.addChild(veteranMarks);
  }

  const hpTrack = new Graphics();
  hpTrack.beginFill(0x142225, 0.82);
  hpTrack.drawRoundedRect(size * 0.14, hpTrackY, size * 0.72, size * 0.08, size * 0.04);
  hpTrack.endFill();
  container.addChild(hpTrack);

  const hpFill = new Graphics();
  hpFill.beginFill(0x98df9d, 0.96);
  hpFill.drawRoundedRect(size * 0.14, hpTrackY, size * 0.72 * (unit.hp / unitDefinitions[unit.kind].maxHp), size * 0.08, size * 0.04);
  hpFill.endFill();
  container.addChild(hpFill);

  const hpText = new Text(String(unit.hp), popupDarkStyle);
  hpText.anchor.set(0.5);
  hpText.x = size * 0.5;
  hpText.y = size * 0.88;
  hpText.scale.set(Math.max(0.8, zoom * 0.95));
  container.addChild(hpText);

  if (selected) {
    const outline = new Graphics();
    outline.lineStyle(Math.max(2, size * 0.045), 0xf4efe1, 0.95);
    outline.drawRoundedRect(size * 0.1, size * 0.08, size * 0.8, size * 0.78, size * 0.18);
    container.addChild(outline);
  }

  root.addChild(container);
}
