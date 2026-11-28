import { test } from "node:test";
import assert from "node:assert/strict";
import { act, mover, resolve } from "./harness";

const slice = (action: "pursue" | "evade" | "follow") => act(action, { target: { id: 2, name: "T2" }, seconds: 1 });

test("back-to-back 1-second slices of a chase are one continuous chase", () => {
  const sliced = resolve([mover(1, { col: 0, row: 0 }, [slice("pursue"), slice("pursue"), slice("pursue"), slice("pursue"), slice("pursue"), slice("pursue")]), mover(2, { col: 5, row: 0 })], {});
  const whole = resolve([mover(1, { col: 0, row: 0 }, [act("pursue", { target: { id: 2, name: "T2" } })]), mover(2, { col: 5, row: 0 })], {});
  assert.deepEqual(sliced.final.get(1), whole.final.get(1));
  assert.match(sliced.text, /T1's pursue ends: within 5 ft of T2/);
});

test("two seconds of chase stop after two seconds", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [slice("pursue"), slice("pursue")]), mover(2, { col: 6, row: 0 })], {});
  assert.deepEqual(r.final.get(1), { col: 2, row: 0 });
});
