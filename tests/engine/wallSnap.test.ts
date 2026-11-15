import { test } from "node:test";
import assert from "node:assert/strict";
import { snapWallEnd } from "@/lib/wallSnap";

const seg = (x1: number, y1: number, x2: number, y2: number) => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });
const walls = [seg(0, 0, 10, 0), seg(10, 0, 10, 8)]; // a corner at (10, 0)

test("an end near another piece's end joins it", () => {
  assert.deepEqual(snapWallEnd({ x: 9.8, y: 0.15 }, walls, 0.3), { x: 10, y: 0 });
});

test("an end near a line lands on it (a wall meeting another squarely)", () => {
  assert.deepEqual(snapWallEnd({ x: 4.2, y: 0.2 }, walls, 0.3), { x: 4.2, y: 0 });
  assert.deepEqual(snapWallEnd({ x: 9.75, y: 5 }, walls, 0.3), { x: 10, y: 5 });
});

test("an end lines up with ends nearby on x or y, and with the new wall's own start", () => {
  assert.deepEqual(snapWallEnd({ x: 0.2, y: 5 }, walls, 0.3), { x: 0, y: 5 }); // under the first wall's start
  assert.deepEqual(snapWallEnd({ x: 3, y: 7.85 }, walls, 0.3), { x: 3, y: 8 }); // level with the second wall's end
  assert.deepEqual(snapWallEnd({ x: 5.1, y: 4 }, walls, 0.3, [{ x: 5, y: 2 }]), { x: 5, y: 4 }); // straight down from its start
});

test("far from everything, the point stays put", () => {
  assert.deepEqual(snapWallEnd({ x: 5, y: 4 }, walls, 0.3), { x: 5, y: 4 });
});
