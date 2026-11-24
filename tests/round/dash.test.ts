import { test } from "node:test";
import assert from "node:assert/strict";
import { mover, resolve } from "./harness";

test("a Dash covers twice the ground of a walk in the same seconds", () => {
  const r = resolve([
    mover(1, { col: 0, row: 0 }, [{ kind: "move", to: { col: 6, row: 0 }, feet: 30 }]),
    mover(2, { col: 0, row: 2 }, [{ kind: "move", to: { col: 12, row: 2 }, feet: 60, run: 60 }]),
  ], {});
  assert.deepEqual(r.final.get(1), { col: 6, row: 0 });
  assert.deepEqual(r.final.get(2), { col: 12, row: 2 });
  assert.deepEqual([r.frames[2].pos[1], r.frames[2].pos[2]], [{ col: 3, row: 0 }, { col: 6, row: 2 }], "halfway through the round");
});
