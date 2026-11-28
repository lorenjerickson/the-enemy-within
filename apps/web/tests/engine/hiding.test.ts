import { test } from "node:test";
import assert from "node:assert/strict";
import { blindSpots, watched } from "@/lib/hiding";

// A watcher who sees everything left of x = 3 (a wall in the way beyond it, say).
const w = { id: 9, sees: (p: { x: number; y: number }) => p.x < 3 };

test("blind spots: the reachable cells no known watcher would see", () => {
  const cells = [0, 1, 2, 3, 4].map((col) => ({ col, row: 0 }));
  assert.deepEqual(blindSpots(cells, [w]).map((c) => c.col), [3, 4]);
  assert.deepEqual(blindSpots(cells, []).length, 5, "no one they can see: anywhere");
  assert.equal(watched({ col: 1, row: 0 }, [w]), true);
});
