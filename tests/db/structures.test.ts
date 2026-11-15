import { test } from "node:test";
import assert from "node:assert/strict";
import { level } from "./seed";
import { addStructure, deleteLevelStructures, listStructures, setStructureEnds } from "@/lib/db";

const wall = (lv: number, x1: number, y1: number, x2: number, y2: number) => addStructure(lv, { kind: "wall", x1, y1, x2, y2, target_level_id: null } as never);

test("removing all structures clears one level and leaves the others", () => {
  const a = level(), b = level();
  wall(a, 0, 0, 4, 0); wall(a, 4, 0, 4, 4); wall(b, 0, 0, 0, 3);
  assert.equal(deleteLevelStructures(a), 2);
  assert.equal(listStructures(a).length, 0);
  assert.equal(listStructures(b).length, 1);
});

test("a line's ends move; a level link stays put", () => {
  const lv = level();
  wall(lv, 0, 0, 4, 0);
  addStructure(lv, { kind: "staircase", x1: 2, y1: 2, x2: 2, y2: 2, target_level_id: null } as never);
  const [w, link] = listStructures(lv);
  setStructureEnds(w.id, { x1: -1, y1: 0, x2: 6, y2: 0 });
  setStructureEnds(link.id, { x1: 5, y1: 5, x2: 6, y2: 6 });
  const [w2, link2] = listStructures(lv);
  assert.deepEqual([w2.x1, w2.y1, w2.x2, w2.y2], [-1, 0, 6, 0]);
  assert.deepEqual([link2.x1, link2.y1], [2, 2]);
});
