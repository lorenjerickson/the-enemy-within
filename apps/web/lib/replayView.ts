import type { Replay } from "@/lib/resolveRound";
import { insidePolygon, visibilityPolygon, type Segment } from "@/lib/visibility";
import { playerStory } from "@/lib/roundStory";

/** Where a token out of sight is put in a player's replay: nowhere they could see (their fog hides it). */
export const UNSEEN = { col: -99999, row: -99999 };
const SIGHT = 500;

/**
 * A round's replay as one player may have it, worked out on the server so nothing else reaches their browser: each
 * second only their own tokens and those their characters could see then (the rest are put out of sight), who's down
 * among those, the effects that involve someone they could see, and their own story of each second (no numbers).
 */
export function playerReplay(raw: Replay, mine: number[], name: (id: number) => string, walls: Segment[]): Replay {
  const told = playerStory(raw.story, mine, name);
  const view = (pos: Record<number, { col: number; row: number }>) => {
    const sights = mine.filter((id) => pos[id]).map((id) => visibilityPolygon({ x: pos[id].col + 0.5, y: pos[id].row + 0.5 }, SIGHT, walls));
    const seen = new Set(Object.keys(pos).map(Number).filter((id) => mine.includes(id) || sights.some((s) => insidePolygon({ x: pos[id].col + 0.5, y: pos[id].row + 0.5 }, s))));
    return { seen, pos: Object.fromEntries(Object.entries(pos).map(([id, p]) => [id, seen.has(Number(id)) ? p : UNSEEN])) };
  };
  const start = view(raw.start);
  return {
    ...raw,
    story: undefined,
    start: start.pos,
    startDown: raw.startDown?.filter((id) => start.seen.has(id)),
    frames: raw.frames.map((f) => {
      const { seen, pos } = view(f.pos);
      const fx = f.fx?.filter((x) => (x.look === "area" ? [x.from, ...x.hits.map((h) => h.id)].some((id) => seen.has(id)) || x.from === 0 : seen.has(x.from) || seen.has(x.to)));
      return { ...f, pos, down: f.down.filter((id) => seen.has(id)), lines: told.get(f.sec) ?? [], ...(fx?.length ? { fx } : { fx: undefined }) };
    }),
  };
}
