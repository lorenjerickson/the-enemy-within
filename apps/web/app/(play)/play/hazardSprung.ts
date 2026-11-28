/** Remembering that a dormant hazard went off (walks and rounds both): kept apart so round code can use it without importing walk code. */
import { updateLastingArea } from "@/lib/db/areas";
import { getGameTime } from "@/lib/db/calendar";
import { listTokens } from "@/lib/db/tokens";
import { spring, type Hazard } from "@/lib/hazards";
import { seesSpot } from "@/lib/sight";

/** Where a hazard is, for who saw it go off: its middle (a line's midpoint). */
export const hazardMiddle = (h: Hazard) => (h.area.shape === "line" ? { x: h.area.origin.x + (Math.cos(h.area.dir) * h.area.size) / 2, y: h.area.origin.y + (Math.sin(h.area.dir) * h.area.size) / 2 } : h.area.origin);

/** It went off on these tokens (none: on no one; on a walk, in a round, by a map trigger): remembered, active for its time, spent if once, seen by whoever saw it. */
export function markHazardSprung(levelId: number, h: Hazard, on: number | number[]): void {
  const ids = Array.isArray(on) ? on : [on];
  const saw = listTokens(levelId).filter((t) => t.character_id !== null && (ids.includes(t.id) || seesSpot(levelId, t.id, hazardMiddle(h)))).map((t) => t.id);
  const { id, ...next } = spring(h, ids, getGameTime());
  updateLastingArea(id, { ...next, seenBy: [...new Set([...(h.seenBy ?? []), ...saw])] });
}
