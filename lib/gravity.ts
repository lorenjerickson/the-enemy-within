import type { MapStructure } from "./db";

/**
 * Gravity on portrait (side-on) maps. Floors are the horizontal walls, windows and closed doors you've
 * drawn (an open door is a trapdoor), at any height. Positions are in grid units: x is a column line,
 * y can be fractional. An actor at (col, row) fills x col..col+1 and y row..row+1, so it stands on a
 * floor at y = row + 1. Falling starts from the actor's middle, so a token dropped just above a floor
 * lands on it.
 */
type Piece = Pick<MapStructure, "kind" | "x1" | "y1" | "x2" | "y2" | "open">;

const isFloor = (s: Piece) =>
  s.y1 === s.y2 && s.x1 !== s.x2 && (s.kind === "wall" || s.kind === "window" || (s.kind === "door" && !s.open));

const under = (s: Piece, col: number) => Math.min(s.x1, s.x2) <= col && Math.max(s.x1, s.x2) >= col + 1;

/** The row something here comes to rest at: the first floor below its middle. With no floor below, it stays. */
export function landingRow(structures: Piece[], col: number, row: number): number {
  let floor: number | null = null;
  for (const s of structures) if (isFloor(s) && under(s, col) && s.y1 >= row + 0.5 - 1e-9 && (floor === null || s.y1 < floor)) floor = s.y1;
  return floor === null ? row : floor - 1;
}

/** Whether any floors are drawn. */
export const hasFloors = (structures: Piece[]) => structures.some(isFloor);

/** The heights (y) of every floor across a column, i.e. where something in that column can stand. */
export const floorsUnder = (structures: Piece[], col: number): number[] =>
  structures.filter((s) => isFloor(s) && under(s, col)).map((s) => s.y1);

/** Heights snap to 1/20 of a cell on portrait maps (fine enough to trace floors in the art). */
export const snapHeight = (y: number) => Math.round(y * 20) / 20;

/** Fall damage: 1d6 per full 10 ft (2 cells) fallen, as in D&D. */
export const fallDice = (cells: number) => Math.floor(cells / 2);
