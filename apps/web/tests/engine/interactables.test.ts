import { test } from "node:test";
import assert from "node:assert/strict";
import { interactablesNear, type MapTrigger } from "@/lib/triggers";

const lever = (t: Partial<MapTrigger> = {}): MapTrigger => ({ id: 1, name: "Lever", area: { shape: "rect", x: 5, y: 5, w: 1, h: 1 }, springs: [], who: "", often: "each", outcomes: [], sprung: [], interact: true, ...t });

test("interactable triggers within reach, for whom and as often as they allow", () => {
  assert.deepEqual(interactablesNear([lever()], 9, "party", { x: 4.5, y: 5.5 }, 1.5), [{ id: 1, name: "Lever" }]);
  assert.deepEqual(interactablesNear([lever()], 9, "party", { x: 1.5, y: 5.5 }, 1.5), [], "too far");
  assert.deepEqual(interactablesNear([lever({ interact: false })], 9, "party", { x: 4.5, y: 5.5 }, 1.5), [], "not interactable");
  assert.deepEqual(interactablesNear([lever({ often: "once", sprung: [2] })], 9, "party", { x: 4.5, y: 5.5 }, 1.5), [], "spent");
  assert.deepEqual(interactablesNear([lever({ who: "hostile" })], 9, "party", { x: 4.5, y: 5.5 }, 1.5), [], "not for the party");
});
