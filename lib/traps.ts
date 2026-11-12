/**
 * Traps: hazards the GM places on a map (Traps layer), hidden from players until found. One springs when someone
 * enters it, starts a round in it or ends a move in it (as set), if they're who it's for and it isn't spent. Shapes
 * are in grid units (1 = 5 ft; a token's centre is col + 0.5, row + 0.5): a circle, a rectangle, or a line across a
 * corridor (crossing it springs it). What it does (a save against damage, effects, stopping the mover) is worked out
 * where it springs; this file only decides whether it does.
 */
import { crosses, pointToSegment } from "@/lib/movement";
import type { AreaFires } from "@/lib/aoe";
import type { Allegiance } from "@/lib/sides";
import type { Point } from "@/lib/visibility";

export type TrapArea =
  | { shape: "circle"; x: number; y: number; r: number } // centre and radius
  | { shape: "rect"; x: number; y: number; w: number; h: number } // top-left corner and size
  | { shape: "line"; x1: number; y1: number; x2: number; y2: number }; // a tripwire: crossing it springs it

/** Who sets it off: anyone, the party's side, or the party's enemies (hostile creatures). */
export type TrapWho = "" | "party" | "hostile";
/** How often: once (then it's spent), once for each creature, or every time. */
export type TrapOften = "once" | "each" | "always";

export interface Trap {
  id: number;
  name: string;
  area: TrapArea;
  springs: AreaFires[]; // when: as someone comes into it, starts a round in it, or ends a move in it ("end"); none: only when a trigger sets it off
  who: TrapWho;
  often: TrapOften;
  damage: string | null; // dice ('' / null = none)
  damage_type: string;
  save_attr: string; // the save against its damage ('' = none: full damage)
  save_dc: number;
  save_half: 0 | 1; // a successful save takes half (else none)
  effects: number[]; // catalog effects put on whoever fails the save (or on anyone it springs on, with no save)
  stops: 0 | 1; // stops the mover where they are
  find_dc: number; // Search (Investigation) to find it
  found: 0 | 1; // found (or revealed by the GM): players see it
  sprung: number[]; // tokens it has sprung on (once: any spends it; each: those it won't spring on again)
}

/** What zone checks need (traps and triggers alike). */
export type Zone = Pick<Trap, "area" | "springs" | "who" | "often" | "sprung">;

export const TRAP_WHO: [TrapWho, string][] = [["", "anyone"], ["party", "the party"], ["hostile", "the party's enemies"]];
export const TRAP_OFTEN: [TrapOften, string][] = [["once", "once"], ["each", "once for each creature"], ["always", "every time"]];

/** How close to a tripwire counts as standing on it (grid units). */
const ON_LINE = 0.25;

/** Whether a point (a token's centre) is in the trap (on a tripwire: within a quarter of a square of it). */
export function inTrap(a: TrapArea, p: Point): boolean {
  if (a.shape === "circle") return Math.hypot(p.x - a.x, p.y - a.y) <= a.r + 1e-9;
  if (a.shape === "rect") return p.x >= a.x - 1e-9 && p.x <= a.x + a.w + 1e-9 && p.y >= a.y - 1e-9 && p.y <= a.y + a.h + 1e-9;
  return pointToSegment(p, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }) <= ON_LINE;
}

/**
 * Whether a step from `from` to `to` comes into the trap: it starts outside and touches it on the way (passing through
 * a small trap counts), or crosses a tripwire. Starting inside isn't coming in.
 */
export function entersTrap(a: TrapArea, from: Point, to: Point): boolean {
  if (inTrap(a, from)) return false;
  if (a.shape === "line" && crosses(from, to, { a: { x: a.x1, y: a.y1 }, b: { x: a.x2, y: a.y2 } })) return true;
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.25)); // every quarter square along the way
  for (let i = 1; i <= n; i++) if (inTrap(a, { x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n })) return true;
  return false;
}

/** Whether the trap may spring on this token now: it's for their side and isn't spent (for them). */
export function canSpring(t: Pick<Trap, "who" | "often" | "sprung">, tokenId: number, side: Allegiance): boolean {
  if (t.who && t.who !== side) return false;
  if (t.often === "once") return t.sprung.length === 0;
  if (t.often === "each") return !t.sprung.includes(tokenId);
  return true;
}

/** The traps a token's step springs (those it comes into that spring on entering), in the order given. */
export function sprungByStep<T extends Zone>(traps: T[], tokenId: number, side: Allegiance, from: Point, to: Point): T[] {
  return traps.filter((t) => t.springs.includes("enter") && canSpring(t, tokenId, side) && entersTrap(t.area, from, to));
}

/** The traps that spring on a token standing in them at the start of a round, or at the end of a move ("start" / "end"). */
export function sprungWhereStanding<T extends Zone>(traps: T[], tokenId: number, side: Allegiance, at: Point, when: "start" | "end"): T[] {
  return traps.filter((t) => t.springs.includes(when) && canSpring(t, tokenId, side) && inTrap(t.area, at));
}

/** How far a point is from the trap's edge (grid units; 0 inside it). */
export function distanceToTrap(a: TrapArea, p: Point): number {
  if (a.shape === "circle") return Math.max(0, Math.hypot(p.x - a.x, p.y - a.y) - a.r);
  if (a.shape === "rect") return Math.hypot(Math.max(a.x - p.x, 0, p.x - (a.x + a.w)), Math.max(a.y - p.y, 0, p.y - (a.y + a.h)));
  return pointToSegment(p, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 });
}

/** "10 ft radius", "15 × 10 ft", "a 20 ft tripwire". */
export function describeTrapArea(a: TrapArea): string {
  if (a.shape === "circle") return `${+(a.r * 5).toFixed(1)} ft radius`;
  if (a.shape === "rect") return `${+(a.w * 5).toFixed(1)} × ${+(a.h * 5).toFixed(1)} ft`;
  return `a ${+(Math.hypot(a.x2 - a.x1, a.y2 - a.y1) * 5).toFixed(1)} ft tripwire`;
}
