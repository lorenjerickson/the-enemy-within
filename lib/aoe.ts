/**
 * Areas of effect: one shape decides both what's drawn and who's caught. Geometry is in grid units (1 = 5 ft) on grid
 * and gridless maps alike; points are positions on the map (a token's centre is col + 0.5, row + 0.5).
 */
import type { Attribute } from "@/lib/attributes";
import type { EffectKind } from "@/lib/effects";
import type { Condition } from "@/lib/conditions";
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
  fires?: AreaFires[]; // lasting: when it catches someone in it (default: the end of each round)
  at?: "self"; // a circle centred where its user stands (no aiming)
}

/**
 * When a lasting area catches someone: as they come into it, at the start of a round in it, at the end of one, while
 * they stay in it (coming in and at the end of each round; its effects last only while they're in it), as they leave
 * it. Once a round each, at most (leaving counts on its own).
 */
export type AreaFires = "enter" | "start" | "end" | "inside" | "leave";
export const AREA_FIRES: [AreaFires, string][] = [["enter", "comes into it"], ["start", "starts a round in it"], ["end", "ends a round in it"], ["inside", "stays in it (its effects only while inside)"], ["leave", "leaves it"]];
export const areaFires = (s: string | null | undefined): AreaFires[] => {
  const f = (s ?? "").split(",").filter((x): x is AreaFires => AREA_FIRES.some(([k]) => k === x));
  return f.length ? f : ["end"];
};

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
  fires?: AreaFires[]; // when it catches someone (default: the end of each round)
  conditions?: Condition[]; // put on whoever fails its save (as the action that left it did)
  by?: number | null; // whose it is
  damageType?: string; // fire, poison… (the GM's areas; an action's carries its look instead)
  drawn?: boolean; // drawn by the GM (Areas layer), not left by an action
  lingers?: boolean; // its harm builds while they stay and keeps landing (less each interval) after they leave (lib/exposure.ts)
  buildUp?: number; // lingering: added to its damage each interval inside (default 1)
  decay?: number; // lingering: taken off each interval after leaving (default 2)
  visibility?: "shown" | "hidden" | "gm"; // players see it (default); only once found (walked into, a Search beating findDc, the GM); never
  findDc?: number; // hidden: a Search beating this within 10 ft finds it
  found?: boolean; // hidden: found (players see it now)
  sound?: number; // an audio asset that loops on the GM's screen while it's on (crackling fire)
  off?: boolean; // switched off (by the GM, a trigger): does nothing and isn't shown until switched on
  flammable?: boolean; // fire reaching it (a fire area touching it, fire damage landing in it) sets it burning (ignite)
}

/** How long a flammable area burns once lit (game minutes: 3 rounds). */
export const BURN_MINUTES = 0.3;

/** Whether two areas overlap (either's outline or middle inside the other: good enough for spreading fire). */
export function areasOverlap(a: AreaAt, b: AreaAt): boolean {
  return [a.origin, ...areaPolygon(a)].some((p) => inArea(b, p)) || [b.origin, ...areaPolygon(b)].some((p) => inArea(a, p));
}

/** Fire reaches a flammable area: it burns (fire, 1d6 a round inside, lingering, no save) for 3 rounds, then it's spent. */
export function ignite<A extends LastingArea>(l: A, now: number): A {
  return { ...l, name: `${l.name} (burning)`, flammable: false, damage: "1d6", damageType: "fire", look: "fire", dc: NO_SAVE_DC, half: false, fires: ["inside"], lingers: true, buildUp: l.buildUp ?? 1, decay: l.decay ?? 2, conditions: [], ends: Math.round((now + BURN_MINUTES) * 1e6) / 1e6, visibility: "shown", found: undefined };
}

/** A fire area (its damage is fire): it lights flammable ones it touches. */
export const isFire = (l: Pick<LastingArea, "damageType" | "look">) => l.damageType === "fire" || l.look === "fire";

/** Flammable areas a fire touches (by their ids). */
export const caughtFire = (areas: LastingArea[], fire: AreaAt) => areas.filter((l) => l.flammable && areasOverlap(l.area, fire)).map((l) => l.id);

/** Whether players see a lasting area (hidden ones once found; GM-only ones never). */
export const playersSee = (l: LastingArea) => !l.off && ((l.visibility ?? "shown") === "shown" || (l.visibility === "hidden" && !!l.found));

/** A lasting area that lasts until the GM removes it: its end, far off in game time. */
export const UNTIL_REMOVED = 1e9;

/** An area DC this high means it has no save: it always lands (a fire map effect). */
export const NO_SAVE_DC = 99;

/** An area placed on the map: a circle centred where it's aimed; a cone or line from the actor towards the aim; a rectangle the GM draws (origin: its centre). */
export interface AreaAt {
  shape: AreaShape | "rect";
  origin: Point;
  dir: number; // radians, cone and line
  size: number; // grid units (a rectangle: half its longer side)
  w?: number; // a rectangle's width and height (grid units)
  h?: number;
}

/** An area the GM drew (the same shapes traps are drawn with) as one placed on the map: a tripwire drawn becomes a 5 ft wide line. */
export function areaFromDrawn(a: { shape: "circle"; x: number; y: number; r: number } | { shape: "rect"; x: number; y: number; w: number; h: number } | { shape: "line"; x1: number; y1: number; x2: number; y2: number }): AreaAt {
  if (a.shape === "circle") return { shape: "circle", origin: { x: a.x, y: a.y }, dir: 0, size: a.r };
  if (a.shape === "rect") return { shape: "rect", origin: { x: a.x + a.w / 2, y: a.y + a.h / 2 }, dir: 0, size: Math.max(a.w, a.h) / 2, w: a.w, h: a.h };
  return { shape: "line", origin: { x: a.x1, y: a.y1 }, dir: Math.atan2(a.y2 - a.y1, a.x2 - a.x1), size: Math.hypot(a.x2 - a.x1, a.y2 - a.y1) };
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
  if (a.shape === "rect") return Math.abs(dx) <= (a.w ?? 0) / 2 + 1e-9 && Math.abs(dy) <= (a.h ?? 0) / 2 + 1e-9;
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
  if (a.shape === "rect") { const w = (a.w ?? 0) / 2, h = (a.h ?? 0) / 2; return [{ x: x - w, y: y - h }, { x: x + w, y: y - h }, { x: x + w, y: y + h }, { x: x - w, y: y + h }]; }
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
