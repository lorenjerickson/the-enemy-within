/**
 * Standing orders out of encounters (Follow / Pursue / Evade): the route a token walks when the one it's about has
 * just moved. Pure rules: positions are token corners (col, row) in grid units.
 */
import { clearPath, reachableSquares, shortestPath, squareRoute } from "@/lib/movement";
import type { Point, Segment } from "@/lib/visibility";

export type StandingMode = "follow" | "pursue" | "evade";

const centre = (p: Point) => ({ x: p.x + 0.5, y: p.y + 0.5 });
const corner = (p: Point) => ({ x: Math.round((p.x - 0.5) * 20) / 20, y: Math.round((p.y - 0.5) * 20) / 20 });
const near = (a: Point, b: Point, gridless: boolean) => (gridless ? Math.hypot(a.x - b.x, a.y - b.y) <= 1.05 : Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1);

/** How far a walk went: squares on a grid (a diagonal is one), straight-line units on gridless maps. */
export function walkLength(route: Point[], gridless: boolean): number {
  let n = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    n += gridless ? Math.hypot(b.x - a.x, b.y - a.y) : Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }
  return n;
}

/** A gridless path (centres) as steps of about one unit (corners), start first, at most `limit` long. */
function stepsAlong(path: Point[], limit: number): Point[] {
  const out = [corner(path[0])];
  let left = limit;
  for (let i = 1; i < path.length && left > 1e-6; i++) {
    const a = path[i - 1], b = path[i], d = Math.hypot(b.x - a.x, b.y - a.y), go = Math.min(d, left);
    const n = Math.max(1, Math.ceil(go));
    for (let s = 1; s <= n; s++) out.push(corner({ x: a.x + ((b.x - a.x) * go * s) / (n * (d || 1)), y: a.y + ((b.y - a.y) * go * s) / (n * (d || 1)) }));
    left -= go;
  }
  return out;
}

/**
 * The route (corners, start first) a token with a standing order walks once the one it's about has moved `moved`
 * (walkLength) and stands at `them`:
 * - follow: toward them by the shortest way, no further than they went, never closer than next to them;
 * - pursue: toward them by the shortest way until next to them;
 * - evade: as far from them as it can get within the distance they went.
 */
export function standingRoute(mode: StandingMode, from: Point, them: Point, moved: number, walls: Segment[], gridless: boolean): Point[] {
  const stay = [from];
  if (moved <= 1e-6 && mode !== "pursue") return stay;
  if (mode === "evade") {
    if (gridless) {
      let best = from;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, to = { x: from.x + Math.cos(a) * moved, y: from.y + Math.sin(a) * moved };
        if (clearPath(centre(from), centre(to), walls) && Math.hypot(to.x - them.x, to.y - them.y) > Math.hypot(best.x - them.x, best.y - them.y)) best = to;
      }
      return best === from ? stay : stepsAlong([centre(from), centre(best)], moved);
    }
    const reach = reachableSquares({ col: from.x, row: from.y }, Math.floor(moved + 1e-9), walls);
    let best = { col: from.x, row: from.y };
    for (const s of reach.values()) if (Math.hypot(s.col - them.x, s.row - them.y) > Math.hypot(best.col - them.x, best.row - them.y) + 1e-9) best = s;
    const r = squareRoute({ col: from.x, row: from.y }, best, walls, () => true);
    return r ? r.map((s) => ({ x: s.col, y: s.row })) : stay;
  }
  if (near(from, them, gridless)) return stay;
  const limit = mode === "follow" ? moved : Infinity;
  let route: Point[];
  if (gridless) {
    const path = shortestPath(centre(from), centre(them), walls, () => true);
    if (!path) return stay;
    route = stepsAlong(path, Math.min(limit, walkLength(path, true)));
  } else {
    const r = squareRoute({ col: from.x, row: from.y }, { col: Math.round(them.x), row: Math.round(them.y) }, walls, () => true);
    if (!r) return stay;
    route = r.map((s) => ({ x: s.col, y: s.row })).slice(0, Number.isFinite(limit) ? Math.floor(limit + 1e-9) + 1 : undefined);
  }
  // Up to the first spot next to them (not onto them).
  const at = route.findIndex((p, i) => i > 0 && near(p, them, gridless));
  return at >= 0 ? route.slice(0, at + 1) : route.filter((p) => !(Math.abs(p.x - them.x) < 0.5 && Math.abs(p.y - them.y) < 0.5));
}
