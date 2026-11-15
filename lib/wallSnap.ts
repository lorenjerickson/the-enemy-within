type Point = { x: number; y: number };
type Segment = { a: Point; b: Point };

const project = (p: Point, { a, b }: Segment): Point => {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
};

/**
 * Where a wall end drawn without the grid lands, within `tol` (grid units) of what's there: another piece's end;
 * else on a piece's line; else lined up with an end (`also`: the new wall's own start, so it comes out straight) on x
 * and/or y. Otherwise the point itself.
 */
export function snapWallEnd(p: Point, segments: Segment[], tol: number, also: Point[] = []): Point {
  const ends = segments.flatMap((s) => [s.a, s.b]);
  const end = ends.map((e) => ({ e, d: Math.hypot(e.x - p.x, e.y - p.y) })).filter(({ d }) => d < tol).sort((a, b) => a.d - b.d)[0];
  if (end) return { ...end.e };
  const onLine = segments.map((s) => project(p, s)).map((q) => ({ q, d: Math.hypot(q.x - p.x, q.y - p.y) })).filter(({ d }) => d < tol).sort((a, b) => a.d - b.d)[0];
  // On a line: if it's straight up-and-down or across, an end lined up along it still counts (a corner meets squarely).
  const lined = (v: number, of: "x" | "y") => [...ends, ...also].map((e) => ({ v: e[of], d: Math.abs(e[of] - v) })).filter(({ d }) => d < tol).sort((a, b) => a.d - b.d)[0]?.v;
  if (onLine) {
    const s = segments.find((s) => { const q = project(p, s); return q.x === onLine.q.x && q.y === onLine.q.y; })!;
    if (s.a.x === s.b.x) return { x: s.a.x, y: lined(p.y, "y") ?? onLine.q.y };
    if (s.a.y === s.b.y) return { x: lined(p.x, "x") ?? onLine.q.x, y: s.a.y };
    return onLine.q;
  }
  return { x: lined(p.x, "x") ?? p.x, y: lined(p.y, "y") ?? p.y };
}
