/** Level links (structure kind "staircase"): an area of cells that leads to another level. Pure rules. */

export interface LevelLink {
  id: number;
  kind: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  target_level_id: number | null;
  target_name?: string | null;
}

type Spot = { x: number; y: number }; // a token's corner (col, row), grid units

/** Whether a token at this corner stands in the link: its centre is inside the cells the link covers. */
export function inLink(l: LevelLink, at: Spot): boolean {
  const cx = at.x + 0.5, cy = at.y + 0.5;
  return cx >= Math.min(l.x1, l.x2) && cx <= Math.max(l.x1, l.x2) + 1 && cy >= Math.min(l.y1, l.y2) && cy <= Math.max(l.y1, l.y2) + 1;
}

/** The level link a step comes into (from outside it), if any. */
export function linkEntered(links: LevelLink[], from: Spot, to: Spot): LevelLink | undefined {
  return links.find((l) => l.kind === "staircase" && l.target_level_id !== null && inLink(l, to) && !inLink(l, from));
}

/**
 * Where a token taking a link from `fromLevelId` arrives on the target level: on the link there that leads back
 * (its first cell), else at the same spot.
 */
export function arrivalSpot(fromLevelId: number, at: Spot, targetLinks: LevelLink[]): Spot {
  const back = targetLinks.find((l) => l.kind === "staircase" && l.target_level_id === fromLevelId);
  return back ? { x: Math.min(back.x1, back.x2), y: Math.min(back.y1, back.y2) } : at;
}
