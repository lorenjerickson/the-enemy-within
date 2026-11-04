/** 2D visibility: the polygon a point can "see" within a radius, given blocking line segments. */

export type Point = { x: number; y: number };
export type Segment = { a: Point; b: Point };

/** Distance along a ray (origin + t·dir) to segment s, or null if it misses. */
function hit(o: Point, dx: number, dy: number, s: Segment): number | null {
  const sx = s.b.x - s.a.x, sy = s.b.y - s.a.y;
  const den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((s.a.x - o.x) * sy - (s.a.y - o.y) * sx) / den;
  const u = ((s.a.x - o.x) * dy - (s.a.y - o.y) * dx) / den;
  return t >= 0 && u >= 0 && u <= 1 ? t : null;
}

/**
 * Casts rays towards every wall endpoint (and just either side of it) plus a ring of rays,
 * stopping each at the nearest wall or the radius, and returns the resulting polygon.
 */
export function visibilityPolygon(origin: Point, radius: number, walls: Segment[]): Point[] {
  const angles: number[] = [];
  // Same range as Math.atan2 below (−π..π), so sorting puts every ray in order around the origin;
  // mixing ranges made a self-crossing polygon that point-in-polygon tests got wrong.
  for (let i = 0; i < 96; i++) angles.push(-Math.PI + (i / 96) * Math.PI * 2);
  for (const w of walls) {
    for (const p of [w.a, w.b]) {
      if (Math.hypot(p.x - origin.x, p.y - origin.y) > radius * 1.5) continue;
      const a = Math.atan2(p.y - origin.y, p.x - origin.x);
      angles.push(a - 1e-4, a, a + 1e-4);
    }
  }
  angles.sort((x, y) => x - y);
  return angles.map((a) => {
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = radius;
    for (const w of walls) {
      const d = hit(origin, dx, dy, w);
      if (d !== null && d < t) t = d;
    }
    return { x: origin.x + dx * t, y: origin.y + dy * t };
  });
}

/** Structure pieces that block light and sound: walls and closed doors. */
export function blockingSegments(structures: { kind: string; x1: number; y1: number; x2: number; y2: number; open: number }[]): Segment[] {
  return structures
    .filter((s) => s.kind === "wall" || (s.kind === "door" && !s.open))
    .map((s) => ({ a: { x: s.x1, y: s.y1 }, b: { x: s.x2, y: s.y2 } }));
}

/**
 * Whether a sound at `source` with this range can be heard at `listener`: within range and not cut off
 * by a wall or closed door (same units as the walls, e.g. grid units).
 */
export function audible(source: Point, radius: number, listener: Point, walls: Segment[]): boolean {
  const dx = listener.x - source.x, dy = listener.y - source.y;
  const dist = Math.hypot(dx, dy);
  if (dist > radius) return false;
  if (dist === 0) return true;
  return !walls.some((w) => {
    const t = hit(source, dx / dist, dy / dist, w);
    return t !== null && t < dist;
  });
}
