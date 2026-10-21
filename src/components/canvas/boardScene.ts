import { Container, Text, type DisplayObject, type TextStyle } from "pixi.js";

/** Takes a text label for the scene being drawn: the caller positions it and adds it to the scene. */
export type LabelSource = (text: string, style: TextStyle, name: string) => Text;

type LabelSet = Map<TextStyle, Map<string, Text[]>>;

function* labelsIn(set: LabelSet) {
  for (const byText of set.values()) for (const labels of byText.values()) yield* labels;
}

/**
 * Owns what the board canvas draws. Each redraw replaces the scene and destroys the one it
 * replaced: Graphics release their geometry and GPU buffers, Text labels their canvases and
 * textures, and Sprites are destroyed without their textures, which are the shared unit and
 * terrain art. Two kinds of object are kept between redraws instead, and owned here until
 * they are no longer drawn:
 *
 * - Text labels, matched by style and text, so an unchanged HP number or popup is neither
 *   drawn nor uploaded again.
 * - The swamp and lake layer, which depends only on the map and is moved and scaled with the
 *   view rather than rebuilt.
 */
export class BoardScene {
  private root: Container | null = null;
  private kept: LabelSet = new Map();
  private taken: LabelSet = new Map();
  private regions: { key: string; layer: Container } | null = null;
  private destroyed = false;

  constructor(private readonly stage: Container) {}

  /** Starts a redraw: destroys the previous scene (but not what is kept) and returns the new, empty one. */
  begin(): Container {
    // Labels left from an interrupted redraw are not coming back.
    for (const label of labelsIn(this.kept)) label.destroy();
    this.kept = this.taken;
    this.taken = new Map();
    for (const label of labelsIn(this.kept)) label.removeFromParent();
    this.regions?.layer.removeFromParent();
    if (this.root) {
      this.root.destroy({ children: true });
      this.root = null;
    }
    this.root = new Container();
    this.stage.addChild(this.root);
    return this.root;
  }

  /** A label for this redraw: the last redraw's, if it showed the same text in the same style. */
  readonly label: LabelSource = (text, style, name) => {
    let label = this.kept.get(style)?.get(text)?.pop();
    if (label) {
      label.anchor.set(0);
      label.position.set(0, 0);
      label.scale.set(1);
      label.rotation = 0;
      label.alpha = 1;
      label.tint = 0xffffff;
      label.visible = true;
    } else {
      label = new Text(text, style);
    }
    label.name = name;
    const byText = this.taken.get(style) ?? new Map<string, Text[]>();
    this.taken.set(style, byText);
    const same = byText.get(text);
    if (same) same.push(label);
    else byText.set(text, [label]);
    return label;
  };

  /** The swamp and lake layer for `key` (the map it was built for), built once. */
  regionLayer(key: string, build: () => Container): Container {
    if (this.regions?.key !== key) {
      this.regions?.layer.destroy({ children: true });
      this.regions = { key, layer: build() };
    }
    return this.regions.layer;
  }

  /** Ends a redraw: destroys the kept labels it did not take. */
  end() {
    for (const label of labelsIn(this.kept)) label.destroy();
    this.kept = new Map();
  }

  /** Destroys the scene and everything kept for it. Safe to call more than once. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const owned: DisplayObject[] = [...labelsIn(this.kept), ...labelsIn(this.taken)];
    if (this.regions) owned.push(this.regions.layer);
    if (this.root) owned.push(this.root);
    for (const object of owned) if (!object.destroyed) object.destroy({ children: true });
    this.kept = new Map();
    this.taken = new Map();
    this.regions = null;
    this.root = null;
  }
}
