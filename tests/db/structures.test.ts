import { test } from "node:test";
import assert from "node:assert/strict";
import { level } from "./seed";
import { addStructure, deleteLevelStructures, listStructures } from "@/lib/db";

const wall = (lv: number, x1: number, y1: number, x2: number, y2: number) => addStructure(lv, { kind: "wall", x1, y1, x2, y2, target_level_id: null } as never);

test("removing all structures clears one level and leaves the others", () => {
  const a = level(), b = level();
  wall(a, 0, 0, 4, 0); wall(a, 4, 0, 4, 4); wall(b, 0, 0, 0, 3);
  assert.equal(deleteLevelStructures(a), 2);
  assert.equal(listStructures(a).length, 0);
  assert.equal(listStructures(b).length, 1);
});
