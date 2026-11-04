/** How close (grid units, token centre to door) a character must be to work a door. */
export const REACH = 1.5;

/** Shortest distance from a point to a door's line. */
export function distanceToDoor(p: { x: number; y: number }, d: { x1: number; y1: number; x2: number; y2: number }): number {
  const dx = d.x2 - d.x1, dy = d.y2 - d.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - d.x1) * dx + (p.y - d.y1) * dy) / len2)) : 0;
  return Math.hypot(p.x - (d.x1 + t * dx), p.y - (d.y1 + t * dy));
}
