/**
 * Light and darkness for sight: with the overall light at or above DARK_BELOW everything is lit; below it a spot is
 * lit only within reach of a light source that's on (its circle or cone, not past walls). Creatures see what's lit,
 * and darkvision sees the unlit within its range. Shared by the server (who can be seen and aimed at, attacks in the
 * dark) and players' maps (fog of war), so both agree.
 */
import type { Point, Segment } from "@/lib/visibility";
import { crosses } from "@/lib/movement";
import { FEET_PER_SQUARE } from "@/lib/movement";

/** Below this overall light (0..1) it's dark: only light sources (and darkvision) let anyone see. */
export const DARK_BELOW = 0.5;

/** A light source as sight needs it (grid units; a cone's angle and spread in degrees). */
export type Light = { kind: string; x: number; y: number; radius: number; angle: number; spread: number; enabled: 0 | 1 | boolean };

/** Whether a light reaches a point: within its radius (and cone), with no wall or closed door in between. */
export function inLight(l: Light, p: Point, walls: Segment[]): boolean {
  if (!l.enabled) return false;
  const dx = p.x - l.x, dy = p.y - l.y;
  if (Math.hypot(dx, dy) > l.radius) return false;
  if (l.kind !== "point" && l.spread < 360) {
    const off = Math.abs(((Math.atan2(dy, dx) * 180) / Math.PI - l.angle + 540) % 360 - 180);
    if (off > l.spread / 2) return false;
  }
  return !walls.some((w) => crosses({ x: l.x, y: l.y }, p, w));
}

/** Whether a point (a token's centre) is lit. */
export const litAt = (p: Point, illumination: number, lights: Light[], walls: Segment[]) => illumination >= DARK_BELOW || lights.some((l) => inLight(l, p, walls));

/** Whether a viewer at `from` with `darkvision` ft sees a point in line of sight: it's lit, or within their darkvision. */
export const brightEnough = (from: Point, p: Point, darkvision: number, illumination: number, lights: Light[], walls: Segment[]) =>
  litAt(p, illumination, lights, walls) || Math.hypot(p.x - from.x, p.y - from.y) * FEET_PER_SQUARE <= darkvision + 1e-6;
