import { listStructures, listTokens } from "@/lib/db";
import { blockingSegments, insidePolygon, visibilityPolygon } from "@/lib/visibility";

/** How far anyone can see (grid units), as on players' maps. */
export const SIGHT = 500;

/** The tokens on a level that someone at `at` could see (walls and closed doors block sight), not counting `self`. */
export function seenFrom(levelId: number, at: { col: number; row: number }, self?: number): Set<number> {
  const seen = visibilityPolygon({ x: at.col + 0.5, y: at.row + 0.5 }, SIGHT, blockingSegments(listStructures(levelId)));
  return new Set(listTokens(levelId).filter((t) => t.id !== self && insidePolygon({ x: t.col + 0.5, y: t.row + 0.5 }, seen)).map((t) => t.id));
}
