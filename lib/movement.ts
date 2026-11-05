import type { Point, Segment } from "@/lib/visibility";

/** Feet per grid square (and per unit of distance on gridless maps), as in D&D. */
export const FEET_PER_SQUARE = 5;

/** Whether segment p–q touches segment s (endpoints included, so squeezing past a wall's corner is blocked). */
function crosses(p: Point, q: Point, s: Segment): boolean {
  const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(s.a, s.b, p), d2 = d(s.a, s.b, q), d3 = d(p, q, s.a), d4 = d(p, q, s.b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (a: Point, b: Point, c: Point) => Math.abs(d(a, b, c)) < 1e-9 && Math.min(a.x, b.x) - 1e-9 <= c.x && c.x <= Math.max(a.x, b.x) + 1e-9 && Math.min(a.y, b.y) - 1e-9 <= c.y && c.y <= Math.max(a.y, b.y) + 1e-9;
  return on(s.a, s.b, p) || on(s.a, s.b, q) || on(p, q, s.a) || on(p, q, s.b);
}

/**
 * Grid maps: every square reachable from `start` in at most `squares` steps, with the steps it takes.
 * A step goes to any of the 8 neighbours and costs one square (diagonals too, as in D&D 5e);
 * walls and closed doors block a step whose centre-to-centre line touches them.
 */
export function reachableSquares(start: { col: number; row: number }, squares: number, walls: Segment[]): Map<string, { col: number; row: number; steps: number }> {
  const key = (c: number, r: number) => `${c},${r}`;
  const seen = new Map([[key(start.col, start.row), { col: start.col, row: start.row, steps: 0 }]]);
  let frontier = [{ col: start.col, row: start.row }];
  for (let step = 1; step <= Math.floor(squares); step++) {
    const next: typeof frontier = [];
    for (const f of frontier) {
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const c = f.col + dc, r = f.row + dr;
        if (seen.has(key(c, r))) continue;
        const from = { x: f.col + 0.5, y: f.row + 0.5 }, to = { x: c + 0.5, y: r + 0.5 };
        if (walls.some((w) => crosses(from, to, w))) continue;
        seen.set(key(c, r), { col: c, row: r, steps: step });
        next.push({ col: c, row: r });
      }
    }
    frontier = next;
  }
  return seen;
}
