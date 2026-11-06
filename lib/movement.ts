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

/** How close a token's centre may come to a wall on gridless maps: tokens are about a unit (5 ft) across, so their body
 * doesn't slide over a free-standing wall's end; a little under half, so a one-unit doorway still fits. */
export const BODY = 0.4;

/** How far a point is from segment a–b. */
export const pointToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
/** The closest a segment p–q comes to segment s. */
const segmentGap = (p: Point, q: Point, s: Segment) =>
  crosses(p, q, s) ? 0 : Math.min(pointToSegment(p, s.a, s.b), pointToSegment(q, s.a, s.b), pointToSegment(s.a, p, q), pointToSegment(s.b, p, q));

/**
 * Whether a straight move from a to b is clear of walls and closed doors (gridless maps): it doesn't cross one, and the
 * token's body (BODY from its centre) doesn't pass over one. A token already standing that close may still move away.
 */
export const clearPath = (a: Point, b: Point, walls: Segment[]) =>
  !walls.some((w) => {
    if (crosses(a, b, w)) return true;
    const gap = segmentGap(a, b, w);
    return gap < BODY && gap < pointToSegment(a, w.a, w.b) - 1e-6;
  });

/**
 * Free movement on grid maps: the shortest route of squares (8-way steps, walls and closed doors block) from start to
 * goal, only through squares `allowed` says the player may enter (e.g. ones they've seen). Null if there's none.
 */
export function squareRoute(
  start: { col: number; row: number },
  goal: { col: number; row: number },
  walls: Segment[],
  allowed: (col: number, row: number) => boolean,
  maxSquares = 40000,
): { col: number; row: number }[] | null {
  const prev = new Map<string, string | null>([[squareKey(start.col, start.row), null]]);
  let frontier = [start];
  const goalKey = squareKey(goal.col, goal.row);
  while (frontier.length && prev.size < maxSquares) {
    const next: typeof frontier = [];
    for (const f of frontier) {
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const c = f.col + dc, r = f.row + dr, k = squareKey(c, r);
        if (prev.has(k) || !allowed(c, r)) continue;
        if (walls.some((w) => crosses({ x: f.col + 0.5, y: f.row + 0.5 }, { x: c + 0.5, y: r + 0.5 }, w))) continue;
        prev.set(k, squareKey(f.col, f.row));
        if (k === goalKey) {
          const route: { col: number; row: number }[] = [];
          for (let at: string | null = k; at; at = prev.get(at) ?? null) {
            const [cc, rr] = at.split(",").map(Number);
            route.unshift({ col: cc, row: rr });
          }
          return route;
        }
        next.push({ col: c, row: r });
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Free movement on gridless maps: the shortest path from a to b around walls and closed doors, through points
 * `allowed` says are fine (e.g. seen). Waypoints sit just off wall ends, so paths hug corners. Null if there's none.
 */
export function shortestPath(a: Point, b: Point, walls: Segment[], allowed: (p: Point) => boolean): Point[] | null {
  if (clearPath(a, b, walls)) return [a, b];
  const OFF = BODY + 0.15; // diagonally off each wall end, clear of the token's body
  const nodes: Point[] = [a, b];
  for (const w of walls) {
    for (const p of [w.a, w.b]) {
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const n = { x: p.x + dx * OFF, y: p.y + dy * OFF };
        if (allowed(n)) nodes.push(n);
      }
    }
  }
  // Dijkstra over straight, clear hops between nodes.
  const dist = nodes.map(() => Infinity), from = nodes.map(() => -1), done = nodes.map(() => false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) return null;
    if (u === 1) break;
    done[u] = true;
    for (let v = 0; v < nodes.length; v++) {
      if (done[v] || v === u) continue;
      const d = dist[u] + Math.hypot(nodes[v].x - nodes[u].x, nodes[v].y - nodes[u].y);
      if (d < dist[v] && clearPath(nodes[u], nodes[v], walls)) {
        dist[v] = d;
        from[v] = u;
      }
    }
  }
  const path: Point[] = [];
  for (let i = 1; i >= 0; i = from[i]) path.unshift(nodes[i]);
  return path;
}
