// Client-safe: keeps a token drawn where its walk says, while two polls race (the page refresh carries where a
// token ends up; the map's walk poll carries the path to animate). Without it a watcher sees the token jump to its
// destination (refresh first), or snap back to the start after its walk played (walk first, refresh late).
export type At = { col: number; row: number };
export type Hold = At & { until: number; kind: "await" | "arrived" }; // await: a walk may be on its way; arrived: the page hasn't caught up
export type Holds = Record<number, Hold>;

/** How long a moved token waits for its walk (the walk poll runs every second), and an arrived one for the page. */
export const AWAIT_WALK_MS = 1500;
export const AWAIT_PAGE_MS = 4000;

const same = (a: At, b: At) => Math.abs(a.col - b.col) < 1e-6 && Math.abs(a.row - b.row) < 1e-6;

/**
 * The page's token positions came in (`seen`: what it said last time). A token that moved with no walk playing is
 * held where it was, for a moment, in case its walk follows; a token the page has caught up with is let go; holds
 * past their time are dropped. Returns the new holds and what the page says now.
 */
export function pageMoved(seen: Record<number, At>, tokens: (At & { id: number })[], walking: Set<number>, holds: Holds, now: number): { holds: Holds; seen: Record<number, At> } {
  const next: Holds = {};
  const nowSeen: Record<number, At> = {};
  for (const t of tokens) {
    nowSeen[t.id] = { col: t.col, row: t.row };
    const h = holds[t.id], was = seen[t.id];
    if (h && h.until > now && !(h.kind === "arrived" && same(h, t))) next[t.id] = h; // still waiting
    else if (!h && was && !same(was, t) && !walking.has(t.id)) next[t.id] = { ...was, until: now + AWAIT_WALK_MS, kind: "await" };
  }
  return { holds: next, seen: nowSeen };
}

/** Walks starting: their tokens follow the walk, not a hold. */
export const walksStarted = (holds: Holds, ids: number[]): Holds => Object.fromEntries(Object.entries(holds).filter(([id]) => !ids.includes(Number(id))));

/** Walks finished: each token stays where its walk ended until the page says the same (or a few seconds pass). */
export function walksEnded(holds: Holds, ended: { id: number; at: At }[], page: Record<number, At>, now: number): Holds {
  const next = { ...holds };
  for (const e of ended) if (!page[e.id] || !same(page[e.id], e.at)) next[e.id] = { ...e.at, until: now + AWAIT_PAGE_MS, kind: "arrived" };
  return next;
}

/** Holds past their time dropped. */
export const expired = (holds: Holds, now: number): Holds => Object.fromEntries(Object.entries(holds).filter(([, h]) => h.until > now));
