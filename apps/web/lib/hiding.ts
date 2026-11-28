/** Hide: where someone can take cover. Pure rules (watchers come with their own sight). */

type Cell = { col: number; row: number };
type Point = { x: number; y: number };

/** An enemy watching: whether they'd see someone standing at a spot (token centre), as if nobody were hidden. */
export interface Watcher {
  id: number;
  sees: (p: Point) => boolean;
}

const centre = (c: Cell): Point => ({ x: c.col + 0.5, y: c.row + 0.5 });

/** Whether any of these watchers sees someone standing in this cell. */
export const watched = (cell: Cell, watchers: Watcher[]) => watchers.some((w) => w.sees(centre(cell)));

/**
 * The blind spots among the cells someone can reach: where none of the watchers they know of (the enemies they can
 * see) would see them. Enemies they can't see aren't counted: such a spot may still be in view of one of those.
 */
export function blindSpots(cells: Cell[], watchers: Watcher[]): Cell[] {
  return cells.filter((c) => !watched(c, watchers));
}
