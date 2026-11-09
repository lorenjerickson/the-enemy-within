import { listStructures, listTokens } from "@/lib/db";
import { blockingSegments, insidePolygon, visibilityPolygon } from "@/lib/visibility";
import { BLIND_RANGE, seesThem } from "@/lib/conditions";
import { sensesOf } from "@/lib/creatureChanges";

/** How far anyone can see (grid units), as on players' maps. */
export const SIGHT = 500;

/**
 * The tokens on a level that someone at `at` could see (walls and closed doors block sight), not counting `self`.
 * With `self`: their senses count (blind: only within 5 ft; the invisible only if they see invisible things, unless
 * `unseenToo`: an invisible creature in their line of sight can still be aimed at, with disadvantage, by guessing).
 */
export function seenFrom(levelId: number, at: { col: number; row: number }, self?: number, opts: { unseenToo?: boolean } = {}): Set<number> {
  const me = self !== undefined ? sensesOf(self, levelId) : undefined;
  const seen = visibilityPolygon({ x: at.col + 0.5, y: at.row + 0.5 }, me?.blind ? BLIND_RANGE : SIGHT, blockingSegments(listStructures(levelId)));
  return new Set(listTokens(levelId).filter((t) => t.id !== self && insidePolygon({ x: t.col + 0.5, y: t.row + 0.5 }, seen) && (!me || opts.unseenToo || seesThem(me, sensesOf(t.id, levelId)))).map((t) => t.id));
}
