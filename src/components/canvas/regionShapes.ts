/**
 * Outlines for terrain drawn as continuous regions (swamps, lakes) instead of square tiles.
 *
 * Each region tile gets a polygon in tile-local units (0..1). Sides that face another tile of
 * the region run straight along the tile edge, so neighbouring tiles meet exactly and the
 * interior stays one coherent surface. Sides that face land are inset with a gentle wobble,
 * outer corners are rounded, and inner corners (land only diagonally) are cut with an arc that
 * joins the neighbours' insets. Drawing the same tiles at several insets gives a soft edge.
 */

export type RegionTest = (x: number, y: number) => boolean;

export interface RegionEdge {
  /** Distance of the edge from a land-facing tile side, in tiles. */
  inset: number;
  /** Largest sideways wobble of a land-facing edge, in tiles; it fades out at both ends. */
  wobble: number;
  /** Radius of rounded outer corners, in tiles. */
  cornerRadius: number;
}

type Side = "n" | "e" | "s" | "w";
interface Vec { x: number; y: number; }

// Clockwise from the top-left corner: each side with its travel direction and inward normal.
const SIDES: Array<{ side: Side; from: Vec; along: Vec; inward: Vec; neighbor: Vec }> = [
  { side: "n", from: { x: 0, y: 0 }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 }, neighbor: { x: 0, y: -1 } },
  { side: "e", from: { x: 1, y: 0 }, along: { x: 0, y: 1 }, inward: { x: -1, y: 0 }, neighbor: { x: 1, y: 0 } },
  { side: "s", from: { x: 1, y: 1 }, along: { x: -1, y: 0 }, inward: { x: 0, y: -1 }, neighbor: { x: 0, y: 1 } },
  { side: "w", from: { x: 0, y: 1 }, along: { x: 0, y: -1 }, inward: { x: 1, y: 0 }, neighbor: { x: -1, y: 0 } }
];

const ARC_STEPS = 6;
const WOBBLE_STEPS = 10;

export function regionTileOutline(inRegion: RegionTest, x: number, y: number, edge: RegionEdge): number[] {
  const land = SIDES.map(({ neighbor }) => !inRegion(x + neighbor.x, y + neighbor.y));
  const points: number[] = [];
  const push = (point: Vec) => points.push(point.x, point.y);

  for (let index = 0; index < 4; index += 1) {
    // The corner where the previous side ends and this one starts.
    const incoming = SIDES[(index + 3) % 4];
    const outgoing = SIDES[index];
    const corner = outgoing.from;
    const landIn = land[(index + 3) % 4];
    const landOut = land[index];
    const diagonal = { x: incoming.neighbor.x + outgoing.neighbor.x, y: incoming.neighbor.y + outgoing.neighbor.y };
    const d = edge.inset;

    if (landIn && landOut) {
      const radius = edge.cornerRadius;
      const center = add(corner, scale(incoming.inward, d + radius), scale(outgoing.inward, d + radius));
      for (let step = 0; step <= ARC_STEPS; step += 1) {
        const angle = (step / ARC_STEPS) * (Math.PI / 2);
        push(add(center, scale(incoming.inward, -radius * Math.cos(angle)), scale(outgoing.inward, -radius * Math.sin(angle))));
      }
    } else if (landIn) {
      push(add(corner, scale(incoming.inward, d)));
    } else if (landOut) {
      push(add(corner, scale(outgoing.inward, d)));
    } else if (!inRegion(x + diagonal.x, y + diagonal.y) && d > 0) {
      for (let step = 0; step <= ARC_STEPS; step += 1) {
        const angle = (step / ARC_STEPS) * (Math.PI / 2);
        push(add(corner, scale(incoming.along, -d * Math.cos(angle)), scale(outgoing.along, d * Math.sin(angle))));
      }
    } else {
      push(corner);
    }

    if (landOut && edge.wobble > 0) {
      // Interior points of the inset side; the wobble vanishes at both ends so it meets the corners.
      const start = { x: points[points.length - 2], y: points[points.length - 1] };
      const next = SIDES[(index + 1) % 4];
      const end = nextCornerStart(next.from, outgoing, next, land[(index + 1) % 4], d, edge.cornerRadius);
      const phase = hash(x, y, index);
      for (let step = 1; step < WOBBLE_STEPS; step += 1) {
        const t = step / WOBBLE_STEPS;
        const offset = edge.wobble * Math.sin(Math.PI * t) * (0.65 * Math.sin(2 * Math.PI * (1.5 * t + phase)) + 0.35 * Math.sin(2 * Math.PI * (3.2 * t + phase * 1.7)));
        push(add(lerp(start, end, t), scale(outgoing.inward, offset)));
      }
    }
  }
  return points;
}

/** Where the inset side ends: the start of the rounded corner, or the tile edge it runs into. */
function nextCornerStart(corner: Vec, side: (typeof SIDES)[number], next: (typeof SIDES)[number], landNext: boolean, inset: number, radius: number): Vec {
  if (landNext) return add(corner, scale(side.inward, inset), scale(next.inward, inset + radius));
  return add(corner, scale(side.inward, inset));
}

function hash(x: number, y: number, side: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + side * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

const add = (...vectors: Vec[]): Vec => vectors.reduce((sum, vector) => ({ x: sum.x + vector.x, y: sum.y + vector.y }), { x: 0, y: 0 });
const scale = (vector: Vec, factor: number): Vec => ({ x: vector.x * factor, y: vector.y * factor });
const lerp = (from: Vec, to: Vec, t: number): Vec => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
