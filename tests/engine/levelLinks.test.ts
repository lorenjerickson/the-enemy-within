import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalSpot, inLink, linkEntered, type LevelLink } from "@/lib/levelLinks";

const link = (l: Partial<LevelLink> = {}): LevelLink => ({ id: 1, kind: "staircase", x1: 3, y1: 2, x2: 4, y2: 2, target_level_id: 9, ...l });

test("a token stands in a link when its centre is in the cells it covers", () => {
  assert.equal(inLink(link(), { x: 3, y: 2 }), true);
  assert.equal(inLink(link(), { x: 4, y: 2 }), true);
  assert.equal(inLink(link(), { x: 5, y: 2 }), false);
  assert.equal(inLink(link(), { x: 3, y: 3 }), false);
});

test("only a step coming into a link enters it", () => {
  const links = [link({ id: 1, kind: "wall" }), link({ id: 2 })];
  assert.equal(linkEntered(links, { x: 2, y: 2 }, { x: 3, y: 2 })?.id, 2);
  assert.equal(linkEntered(links, { x: 3, y: 2 }, { x: 4, y: 2 }), undefined); // moving within it
  assert.equal(linkEntered([link({ target_level_id: null })], { x: 2, y: 2 }, { x: 3, y: 2 }), undefined);
});

test("arrival is on the link leading back, else the same spot", () => {
  assert.deepEqual(arrivalSpot(5, { x: 3, y: 2 }, [link({ x1: 8, y1: 7, x2: 7, y2: 7, target_level_id: 5 })]), { x: 7, y: 7 });
  assert.deepEqual(arrivalSpot(5, { x: 3, y: 2 }, [link({ target_level_id: 6 })]), { x: 3, y: 2 });
});
