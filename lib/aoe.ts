/**
 * Areas of effect: one shape decides both what's drawn and who's caught. Geometry is in grid units (1 = 5 ft) on grid
 * and gridless maps alike; points are positions on the map (a token's centre is col + 0.5, row + 0.5).
 */
import type { Attribute } from "@/lib/attributes";
import type { EffectKind } from "@/lib/effects";
import { FEET_PER_SQUARE, crosses } from "@/lib/movement";
import type { Point, Segment } from "@/lib/visibility";

export const AREA_SHAPES = ["circle", "cone", "line"] as const;
export type AreaShape = (typeof AREA_SHAPES)[number];

/** An action's area, as set on the action: shape and size (feet), and the save everyone caught in it rolls. */
export interface AreaSpec {
  shape: AreaShape;
  ft: number; // circle: radius; cone and line: length
  dc: number;
  save: Attribute;
  half: boolean; // a successful save takes half damage (else none)
  minutes?: number; // lasting: stays on the map this long (game time; a round is 6 s), catching whoever is in it each round
  look?: EffectKind; // how a lasting area looks (from the damage type)
}

/** An area left on the map for a while (a fire wall): whoever is in it at the end of each round rolls the save. */
export interface LastingArea {
  id: number;
  name: string;
  look: EffectKind;
  area: AreaAt;
  damage: string | null;
  dc: number;
  save: Attribute;
  half: boolean;
  ends: number; // game minutes
}

/** An area placed on the map: a circle centred where it's aimed; a cone or line from the actor towards the aim. */
export interface AreaAt {
  shape: AreaShape;
  origin: Point;
  dir: number; // radians, cone and line
  size: number; // grid units
}

const CONE_HALF = Math.atan(0.5); // a cone is as wide at its end as it is long
const LINE_HALF = 0.5; // lines are 5 ft wide

export function placeArea(shape: AreaShape, ft: number, actor: Point, aim: Point): AreaAt {
  const size = ft / FEET_PER_SQUARE;
  if (shape === "circle") return { shape, origin: aim, dir: 0, size };
  return { shape, origin: actor, dir: Math.atan2(aim.y - actor.y, aim.x - actor.x), size };
}

/** Whether a point (a token's centre) is inside the area. */
export function inArea(a: AreaAt, p: Point): boolean {
  const dx = p.x - a.origin.x, dy = p.y - a.origin.y, d = Math.hypot(dx, dy);
  if (a.shape === "circle") return d <= a.size + 1e-9;
  if (d < 1e-9 || d > a.size + 1e-9) return false;
  if (a.shape === "cone") {
    const off = Math.abs(((Math.atan2(dy, dx) - a.dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    return off <= CONE_HALF + 1e-9;
  }
  const along = dx * Math.cos(a.dir) + dy * Math.sin(a.dir), across = Math.abs(-dx * Math.sin(a.dir) + dy * Math.cos(a.dir));
  return along > 0 && along <= a.size + 1e-9 && across <= LINE_HALF + 1e-9;
}

/** Inside the area and not behind a wall from where it starts. */
export const caughtBy = (a: AreaAt, p: Point, walls: Segment[]) => inArea(a, p) && !walls.some((w) => crosses(a.origin, p, w));

/** The area's outline, for drawing. */
export function areaPolygon(a: AreaAt): Point[] {
  const { x, y } = a.origin;
  if (a.shape === "circle") return Array.from({ length: 48 }, (_, i) => ({ x: x + Math.cos((i / 48) * Math.PI * 2) * a.size, y: y + Math.sin((i / 48) * Math.PI * 2) * a.size }));
  if (a.shape === "cone") {
    const arc = Array.from({ length: 13 }, (_, i) => a.dir - CONE_HALF + (i / 12) * 2 * CONE_HALF).map((t) => ({ x: x + Math.cos(t) * a.size, y: y + Math.sin(t) * a.size }));
    return [{ x, y }, ...arc];
  }
  const c = Math.cos(a.dir), s = Math.sin(a.dir), nx = -s * LINE_HALF, ny = c * LINE_HALF;
  return [
    { x: x + nx, y: y + ny },
    { x: x + c * a.size + nx, y: y + s * a.size + ny },
    { x: x + c * a.size - nx, y: y + s * a.size - ny },
    { x: x - nx, y: y - ny },
  ];
}

export const describeArea = (a: Pick<AreaSpec, "shape" | "ft">) => `${a.ft} ft ${a.shape === "circle" ? "radius" : a.shape}`;
