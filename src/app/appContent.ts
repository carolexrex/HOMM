import type { UnitKind } from "../engine";
import militiaUrl from "../assets/units/militia.png";
import swordsmanUrl from "../assets/units/swordsman.png";
import pikemanUrl from "../assets/units/pikeman.png";
import archerUrl from "../assets/units/archer.png";
import cavalryUrl from "../assets/units/cavalry.png";
import assassinUrl from "../assets/units/assassin.png";
import catapultUrl from "../assets/units/catapult.png";
import healerUrl from "../assets/units/healer.png";

export const boardTips = [
  { title: "Select", body: "Tap or click a friendly unit to preview moves and attacks." },
  { title: "Economy", body: "Villages add gold every turn so map control matters." },
  { title: "Capture", body: "Militia, swordsmen, and pikemen can seize keeps and villages." },
  { title: "Veterancy", body: "Units level from combat. Veteran and Elite troops hit harder, and Elite units also hold up better." },
  { title: "Tempo", body: "Cross bridges early and force trades before ranged units settle in." }
];

export const terrainTips = [
  { title: "Forests", body: "High cover for infantry and archers, weak for cavalry." },
  { title: "Hills", body: "Ranged units hit harder from height, and archers gain +1 range." },
  { title: "Roads", body: "Fast movement, low protection." },
  { title: "Swamps", body: "Slow every heavy piece and punish overextension." },
  { title: "Water", body: "Rivers, shorelines, and deep water block movement unless bridged." }
];

export const unitMenuArt: Record<UnitKind, string> = {
  militia: militiaUrl,
  swordsman: swordsmanUrl,
  pikeman: pikemanUrl,
  archer: archerUrl,
  cavalry: cavalryUrl,
  assassin: assassinUrl,
  catapult: catapultUrl,
  healer: healerUrl
};
