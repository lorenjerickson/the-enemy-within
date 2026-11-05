import type { Point, Segment } from "@/lib/visibility";

/** Feet per grid square (and per unit of distance on gridless maps), as in D&D. */
export const FEET_PER_SQUARE = 5;

/** Whether segment p–q touches segment s (endpoints included, so squeezing past a wall's corner is blocked). */
export function crosses(p: Point, q: Point, s: Segment): boolean {
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
export type Reach = Map<string, { col: number; row: number; steps: number; prev: string | null }>;
export const squareKey = (c: number, r: number) => `${c},${r}`;

export function reachableSquares(start: { col: number; row: number }, squares: number, walls: Segment[]): Reach {
  const key = squareKey;
  const seen: Reach = new Map([[key(start.col, start.row), { col: start.col, row: start.row, steps: 0, prev: null }]]);
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
        seen.set(key(c, r), { col: c, row: r, steps: step, prev: key(f.col, f.row) });
        next.push({ col: c, row: r });
      }
    }
    frontier = next;
  }
  return seen;
}

/** The squares walked from the start to `key` (start first), following the shortest route found. */
export function routeTo(reach: Reach, key: string): { col: number; row: number }[] {
  const route: { col: number; row: number }[] = [];
  for (let k: string | null = key; k; k = reach.get(k)?.prev ?? null) {
    const s = reach.get(k);
    if (!s) break;
    route.unshift({ col: s.col, row: s.row });
  }
  return route;
}

/** Whether a straight move from a to b is clear of walls and closed doors (gridless maps). */
export const clearPath = (a: Point, b: Point, walls: Segment[]) => !walls.some((w) => crosses(a, b, w));
