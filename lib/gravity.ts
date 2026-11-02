import type { MapStructure } from "./db";

/**
 * Gravity on portrait (side-on) maps. Floors are the horizontal walls, windows and closed doors you've
 * drawn (an open door is a trapdoor), at any height, plus stairs: sloped flights you stand on part way down. Positions are in grid units: x is a column line,
 * y can be fractional. An actor at (col, row) fills x col..col+1 and y row..row+1, so it stands on a
 * floor at y = row + 1. Falling starts from the actor's middle, so a token dropped just above a floor
 * lands on it.
 */
type Piece = Pick<MapStructure, "kind" | "x1" | "y1" | "x2" | "y2" | "open">;

const isFloor = (s: Piece) =>
  (s.kind === "stairs" && s.x1 !== s.x2) ||
  (s.y1 === s.y2 && s.x1 !== s.x2 && (s.kind === "wall" || s.kind === "window" || (s.kind === "door" && !s.open)));

/** A flat floor must span the whole column; a flight only needs to pass the column's middle. */
const under = (s: Piece, col: number) =>
  s.kind === "stairs"
    ? Math.min(s.x1, s.x2) <= col + 0.5 && Math.max(s.x1, s.x2) >= col + 0.5
    : Math.min(s.x1, s.x2) <= col && Math.max(s.x1, s.x2) >= col + 1;

/** A surface's height in a column: a flight's height at the column's middle, or the floor's height. */
const heightAt = (s: Piece, col: number) => (s.kind === "stairs" ? s.y1 + ((col + 0.5 - s.x1) * (s.y2 - s.y1)) / (s.x2 - s.x1) : s.y1);

/** The row something here comes to rest at: the first floor below its middle. With no floor below, it stays. */
export function landingRow(structures: Piece[], col: number, row: number): number {
  let floor: number | null = null;
  for (const s of structures) {
    if (!isFloor(s) || !under(s, col)) continue;
    const y = heightAt(s, col);
    if (y >= row + 0.5 - 1e-9 && (floor === null || y < floor)) floor = y;
  }
  return floor === null ? row : Math.round((floor - 1) * 100) / 100; // hundredths: heights on a flight aren't round
}

/** Whether any floors are drawn. */
export const hasFloors = (structures: Piece[]) => structures.some(isFloor);

/** The heights (y) of every floor across a column, i.e. where something in that column can stand. */
export const floorsUnder = (structures: Piece[], col: number): number[] =>
  structures.filter((s) => isFloor(s) && under(s, col)).map((s) => heightAt(s, col));

/** Heights snap to 1/20 of a cell on portrait maps (fine enough to trace floors in the art). */
export const snapHeight = (y: number) => Math.round(y * 20) / 20;

/** Fall damage: 1d6 per full 10 ft (2 cells) fallen, as in D&D. */
export const fallDice = (cells: number) => Math.floor(cells / 2);
