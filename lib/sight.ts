import { getIllumination, listLights, listStructures, listTokens } from "@/lib/db";
import { blockingSegments, insidePolygon, visibilityPolygon } from "@/lib/visibility";
import { seesThem } from "@/lib/conditions";
import { sensesOf } from "@/lib/creatureChanges";
import { brightEnough, litAt } from "@/lib/light";

/** How far anyone can see (grid units), as on players' maps. */
export const SIGHT = 500;

/** Whether a spot on a level is lit (its overall light, or a light source reaching it past walls). */
export function litOn(levelId: number): (p: { col: number; row: number }) => boolean {
  const illumination = getIllumination(levelId), lights = listLights(levelId), walls = blockingSegments(listStructures(levelId));
  return (p) => litAt({ x: p.col + 0.5, y: p.row + 0.5 }, illumination, lights, walls);
}

/**
 * The tokens on a level that someone at `at` could see (walls and closed doors block sight), not counting `self`.
 * With `self`: their senses count (blind: only within 5 ft; in the dark: only what's lit or within their darkvision;
 * the invisible only if they see invisible things; with `unseenToo`, anyone in their line of sight counts: someone in
 * the dark or invisible can still be aimed at, with disadvantage, by guessing).
 */
export function seenFrom(levelId: number, at: { col: number; row: number }, self?: number, opts: { unseenToo?: boolean } = {}): Set<number> {
  const me = self !== undefined ? sensesOf(self, levelId) : undefined;
  const walls = blockingSegments(listStructures(levelId)), from = { x: at.col + 0.5, y: at.row + 0.5 };
  const seen = visibilityPolygon(from, me?.blind ? me.blindRange : SIGHT, walls);
  const illumination = getIllumination(levelId), lights = listLights(levelId);
  return new Set(
    listTokens(levelId)
      .filter((t) => {
        const p = { x: t.col + 0.5, y: t.row + 0.5 };
        if (t.id === self || !insidePolygon(p, seen)) return false;
        if (!me) return true;
        if (opts.unseenToo) return true; // there, if unseen (in the dark, or invisible): a guess
        if (!me.blind && !brightEnough(from, p, me.darkvision, illumination, lights, walls)) return false; // too dark to make out
        return seesThem(me, sensesOf(t.id, levelId));
      })
      .map((t) => t.id),
  );
}
