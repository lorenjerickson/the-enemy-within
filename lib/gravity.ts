import type { MapStructure } from "./db";

/**
 * Gravity on portrait (side-on) maps. Floors are the horizontal walls, windows and closed doors you've
 * drawn (an open door is a trapdoor). Grid corners are (x, y); cell (col, row) spans x col..col+1, y row..row+1.
 */
type Piece = Pick<MapStructure, "kind" | "x1" | "y1" | "x2" | "y2" | "open">;

const isFloor = (s: Piece) =>
  s.y1 === s.y2 && s.x1 !== s.x2 && (s.kind === "wall" || s.kind === "window" || (s.kind === "door" && !s.open));

const under = (s: Piece, col: number) => Math.min(s.x1, s.x2) <= col && Math.max(s.x1, s.x2) >= col + 1;

/** The row something in this cell comes to rest in: it falls until a floor is under it. With no floor below, it stays. */
export function landingRow(structures: Piece[], col: number, row: number): number {
  let floor: number | null = null;
  for (const s of structures) if (isFloor(s) && under(s, col) && s.y1 >= row + 1 && (floor === null || s.y1 < floor)) floor = s.y1;
  return floor === null ? row : floor - 1;
}

/** Whether a floor is directly under this cell, i.e. something can stand there. */
export const standable = (structures: Piece[], col: number, row: number) =>
  structures.some((s) => isFloor(s) && under(s, col) && s.y1 === row + 1);

/** Fall damage: 1d6 per full 10 ft (2 cells) fallen, as in D&D. */
export const fallDice = (cells: number) => Math.floor(cells / 2);
