import { CanvasResource, Color, Container, Graphics, Sprite, Text, Texture, utils, type Application, type BaseTexture, type Buffer, type DisplayObject, type Geometry } from "pixi.js";

/**
 * Read-only counts of the board's live rendering resources, for the browser tests. It is off
 * unless the page sets `window.__BANNERFRONT_PROBE__ = true` before the app loads; the tests then
 * read `window.__bannerfrontCanvas.stats()` and `.labels()`. Every count is of resources alive
 * now (cached, uploaded, or in the scene), not of allocations so far.
 */

export interface CanvasResourceStats {
  /** Pixi applications created and not yet destroyed. */
  apps: number;
  /** Textures and base textures in Pixi's global caches (destroying one removes it). */
  textures: number;
  baseTextures: number;
  /** Cached base textures drawn from a canvas: one per live Text, and Pixi's white texture. */
  canvasTextures: number;
  /** Cached base textures that are not drawn from a canvas (unit, terrain, and region art), and the loaded ones among them. */
  sharedTextures: number;
  sharedTexturesLoaded: number;
  /** Textures, buffers, and geometries (vertex arrays) the renderers hold on the GPU. */
  glTextures: number;
  glBuffers: number;
  glGeometries: number;
  /**
   * Resources alive that nothing uses: canvas textures no label in the scene draws, and GPU
   * textures, geometries, and buffers that belong neither to the scene, the shared art, nor the
   * renderer's own batching. A redraw that leaves its scene behind shows up here.
   */
  orphanCanvasTextures: number;
  orphanGlTextures: number;
  orphanGlGeometries: number;
  orphanGlBuffers: number;
  /** Display objects in the scene, the Text labels among them, and the passing effects (attacks and popups). */
  sceneObjects: number;
  sceneLabels: number;
  effects: number;
}

export interface CanvasLabel {
  name: string;
  text: string;
  /** Screen rectangle in CSS pixels. */
  bounds: { left: number; top: number; right: number; bottom: number };
  alpha: number;
  /** The label's own texture as the GPU draws it: the share of opaque pixels, and their mean colour. */
  coverage: number;
  color: [number, number, number] | null;
  /** The colour the label is meant to have: its style's fill, times its tint. */
  expected: [number, number, number];
}

interface ProbeWindow {
  __BANNERFRONT_PROBE__?: boolean;
  __bannerfrontCanvas?: { stats(): CanvasResourceStats; labels(): CanvasLabel[] };
}

const probeWindow = (typeof window === "undefined" ? {} : window) as ProbeWindow;
const enabled = probeWindow.__BANNERFRONT_PROBE__ === true;
const liveApps = new Set<Application>();

/** Registers a canvas's application with the probe; returns the call that unregisters it. */
export function trackCanvasApp(app: Application): () => void {
  if (!enabled) return () => undefined;
  liveApps.add(app);
  return () => liveApps.delete(app);
}

function walk(object: DisplayObject, visit: (object: DisplayObject) => void) {
  visit(object);
  if (object instanceof Container) for (const child of object.children) walk(child, visit);
}

function rgb(color: unknown): [number, number, number] {
  const [r, g, b] = new Color(color as ConstructorParameters<typeof Color>[0]).toUint8RgbArray();
  return [r, g, b];
}

interface RendererInternals {
  texture: { managedTextures: BaseTexture[] };
  buffer: { managedBuffers: Record<string, Buffer> };
  geometry: { managedGeometries: Record<string, Geometry> };
  filter?: { quad?: Geometry; quadUv?: Geometry };
  plugins: Record<string, { _packedGeometries?: Geometry[] }>;
}

function stats(): CanvasResourceStats {
  const bases = new Set(Object.values(utils.BaseTextureCache) as BaseTexture[]);
  const canvasBases = [...bases].filter((base) => base.resource instanceof CanvasResource);
  const sharedBases = [...bases].filter((base) => !(base.resource instanceof CanvasResource));
  const result: CanvasResourceStats = {
    apps: liveApps.size,
    textures: new Set(Object.values(utils.TextureCache)).size,
    baseTextures: bases.size,
    canvasTextures: canvasBases.length,
    sharedTextures: sharedBases.length,
    sharedTexturesLoaded: sharedBases.filter((base) => base.valid).length,
    glTextures: 0,
    glBuffers: 0,
    glGeometries: 0,
    orphanCanvasTextures: 0,
    orphanGlTextures: 0,
    orphanGlGeometries: 0,
    orphanGlBuffers: 0,
    sceneObjects: 0,
    sceneLabels: 0,
    effects: 0
  };
  const usedBases = new Set<BaseTexture>([...sharedBases, Texture.WHITE.baseTexture, Texture.EMPTY.baseTexture]);
  const labelBases = new Set<BaseTexture>();
  for (const app of liveApps) {
    // Draw the current scene first, so what it needs is on the GPU and what it replaced is not.
    app.render();
    const renderer = app.renderer as unknown as RendererInternals;
    const usedGeometries = new Set<Geometry>([renderer.filter?.quad, renderer.filter?.quadUv].filter((entry): entry is Geometry => Boolean(entry)));
    for (const plugin of Object.values(renderer.plugins)) for (const geometry of plugin?._packedGeometries ?? []) usedGeometries.add(geometry);
    walk(app.stage, (object) => {
      result.sceneObjects += 1;
      if (object instanceof Text) {
        result.sceneLabels += 1;
        labelBases.add(object.texture.baseTexture);
      }
      if (object instanceof Sprite) usedBases.add(object.texture.baseTexture);
      if (object instanceof Graphics) usedGeometries.add(object.geometry);
      if (object.name === "popup" || object.name === "attack") result.effects += 1;
    });
    const managedGeometries = Object.values(renderer.geometry.managedGeometries);
    const managedBuffers = Object.values(renderer.buffer.managedBuffers);
    const usedBuffers = new Set(managedGeometries.filter((geometry) => usedGeometries.has(geometry)).flatMap((geometry) => geometry.buffers));
    result.glTextures += renderer.texture.managedTextures.length;
    result.glBuffers += managedBuffers.length;
    result.glGeometries += managedGeometries.length;
    result.orphanGlTextures += renderer.texture.managedTextures.filter((base) => !usedBases.has(base) && !labelBases.has(base)).length;
    result.orphanGlGeometries += managedGeometries.filter((geometry) => !usedGeometries.has(geometry)).length;
    result.orphanGlBuffers += managedBuffers.filter((buffer) => !usedBuffers.has(buffer)).length;
  }
  // Pixi's own white texture (the fill of every Graphics) is drawn from a canvas too.
  result.orphanCanvasTextures = canvasBases.filter((base) => !labelBases.has(base) && !usedBases.has(base)).length;
  return result;
}

function labels(): CanvasLabel[] {
  const found: CanvasLabel[] = [];
  for (const app of liveApps) {
    walk(app.stage, (object) => {
      if (!(object instanceof Text) || !object.worldVisible || object.worldAlpha <= 0) return;
      const bounds = object.getBounds();
      // Draw the label's texture on its own and read it back, so a texture the GPU failed to
      // take (black or empty) shows here.
      const sample = new Sprite(object.texture);
      sample.tint = object.tint;
      const pixels = app.renderer.extract.pixels(sample);
      sample.destroy();
      let opaque = 0;
      const sum = [0, 0, 0];
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] < 200) continue;
        opaque += 1;
        sum[0] += pixels[index];
        sum[1] += pixels[index + 1];
        sum[2] += pixels[index + 2];
      }
      const fill = rgb(object.style.fill);
      const tint = rgb(object.tint);
      found.push({
        name: object.name ?? "",
        text: object.text,
        bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
        alpha: object.worldAlpha,
        coverage: opaque / Math.max(1, pixels.length / 4),
        color: opaque ? (sum.map((value) => Math.round(value / opaque)) as [number, number, number]) : null,
        expected: fill.map((value, index) => Math.round((value * tint[index]) / 255)) as [number, number, number]
      });
    });
  }
  return found;
}

if (enabled) probeWindow.__bannerfrontCanvas = { stats, labels };
