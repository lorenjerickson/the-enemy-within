/**
 * Improvisation templates (client-safe: no database): the shapes the GM sizes and the player places on the map.
 */
import type { AreaAt } from "@/lib/aoe";

/** An area template the GM sizes: a circle (radius ft), a rectangle (width × height ft), or a line from the improviser (length ft, 5 ft wide). */
export type Template = { shape: "circle"; ft: number } | { shape: "rect"; ft: number; ft2: number } | { shape: "line"; ft: number };

/** The template on the map where it was put (grid units: a circle's or rectangle's middle; a line runs from `from` toward it). */
export function templateArea(t: Template, at: { x: number; y: number }, from: { x: number; y: number }): AreaAt {
  const size = t.ft / 5;
  if (t.shape === "circle") return { shape: "circle", origin: at, dir: 0, size };
  if (t.shape === "rect") { const w = t.ft / 5, h = t.ft2 / 5; return { shape: "rect", origin: at, dir: 0, size: Math.max(w, h) / 2, w, h }; }
  return { shape: "line", origin: from, dir: Math.atan2(at.y - from.y, at.x - from.x), size };
}

/** A critical failure: the system's d8 shifts where it lands to one of the eight compass points (1 = north, clockwise), by the template's own size. */
export function shifted(at: { x: number; y: number }, t: Template, d8: number): { x: number; y: number } {
  const angle = ((Math.max(1, Math.min(8, d8)) - 1) * Math.PI) / 4, dist = t.ft / 5;
  return { x: at.x + Math.sin(angle) * dist, y: at.y - Math.cos(angle) * dist };
}
