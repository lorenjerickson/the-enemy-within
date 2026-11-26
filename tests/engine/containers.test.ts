import { test } from "node:test";
import assert from "node:assert/strict";
import { fillStacks, numberedNames } from "@/lib/containers";

test("items top up stacks with room first, then take free slots; what doesn't fit is left", () => {
  const stacks = [{ id: 1, item_id: 5, qty: 3 }, { id: 2, item_id: 9, qty: 1 }];
  assert.deepEqual(fillStacks(stacks, 5, 6, 5, 3), { topUps: [{ id: 1, put: 2 }], newStacks: [4], left: 0 });
  assert.deepEqual(fillStacks(stacks, 5, 12, 5, 3), { topUps: [{ id: 1, put: 2 }], newStacks: [5], left: 5 }, "one free slot");
  assert.deepEqual(fillStacks([], 5, 1, 1, 0), { topUps: [], newStacks: [], left: 1 }, "no room");
});

test("several of a name are numbered in order; a lone one keeps its name", () => {
  assert.deepEqual([...numberedNames([{ id: 1, name: "Rat" }, { id: 2, name: "Rex" }, { id: 3, name: "Rat" }])], [[1, "Rat 1"], [2, "Rex"], [3, "Rat 2"]]);
});
