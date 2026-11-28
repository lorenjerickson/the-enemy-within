// Pure: how items go into a container and are told apart on a map (the database side: lib/db/catalog.ts, lib/db/tokens.ts).

/**
 * Putting `qty` of an item into a container: onto its stacks of that item with room first (up to `max` a stack), then
 * into free slots (each a new stack; `capacity` slots in all). What to add to which stack, the new stacks' sizes, and
 * how many didn't fit.
 */
export function fillStacks(stacks: { id: number; item_id: number; qty: number }[], itemId: number, qty: number, max: number, capacity: number): { topUps: { id: number; put: number }[]; newStacks: number[]; left: number } {
  let left = qty;
  const topUps: { id: number; put: number }[] = [], newStacks: number[] = [];
  for (const s of stacks) {
    if (s.item_id !== itemId || s.qty >= max || left <= 0) continue;
    const put = Math.min(left, max - s.qty);
    topUps.push({ id: s.id, put });
    left -= put;
  }
  for (let free = capacity - stacks.length; left > 0 && free > 0; free--) {
    const put = Math.min(left, max);
    newStacks.push(put);
    left -= put;
  }
  return { topUps, newStacks, left };
}

/** Names with several the same numbered in order (Human 1, Human 2), so they can be told apart; a lone one keeps its name. */
export function numberedNames(tokens: { id: number; name: string }[]): Map<number, string> {
  const count = new Map<string, number>(), seen = new Map<string, number>();
  for (const t of tokens) count.set(t.name, (count.get(t.name) ?? 0) + 1);
  return new Map(tokens.map((t) => {
    const n = (seen.get(t.name) ?? 0) + 1;
    seen.set(t.name, n);
    return [t.id, count.get(t.name)! > 1 ? `${t.name} ${n}` : t.name];
  }));
}
