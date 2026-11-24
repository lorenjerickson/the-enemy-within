import { test } from "node:test";
import assert from "node:assert/strict";
import { act, move, mover, resolve, wall } from "./harness";

const follow = (id: number) => act("follow", { target: { id, name: `T${id}` } });

test("follow keeps the gap: only as far as the one followed moves", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [follow(2)]), mover(2, { col: 3, row: 0 }, [move(7, 0, 20)])], {});
  assert.deepEqual(r.final.get(2), { col: 7, row: 0 });
  assert.deepEqual(r.final.get(1), { col: 4, row: 0 });
});

test("when the one followed stops, so does the follower; it doesn't close in", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [follow(2)]), mover(2, { col: 4, row: 0 }, [move(6, 0, 10)])], {});
  assert.deepEqual(r.final.get(1), { col: 2, row: 0 });
  assert.doesNotMatch(r.text, /follow ends/);
});

test("follow goes the shortest way toward them, around a wall, not the way they went", () => {
  // A wall along row 2's top edge from x 0 to 3: T1 below it, T2 above it heading north.
  const r = resolve([mover(1, { col: 1, row: 3 }, [follow(2)]), mover(2, { col: 1, row: 1 }, [move(1, -1, 10)])], {}, { walls: [wall(0, 2, 3, 2)] });
  const at = r.final.get(1)!;
  assert.notEqual(at.col, 1, "it heads for the end of the wall");
  assert.ok(at.row >= 2, "it hasn't gone through the wall");
});

test("a follower of a follower keeps up", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [follow(2)]), mover(2, { col: 2, row: 0 }, [follow(3)]), mover(3, { col: 4, row: 0 }, [move(7, 0, 15)])], {});
  assert.deepEqual([r.final.get(3), r.final.get(2), r.final.get(1)], [{ col: 7, row: 0 }, { col: 5, row: 0 }, { col: 3, row: 0 }]);
});
