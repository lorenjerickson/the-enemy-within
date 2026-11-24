import { test } from "node:test";
import assert from "node:assert/strict";
import { cannotAdd, stepSeconds, timeline, unavailable, type PlanStep } from "@/lib/roundPlan";

const walk = (feet: number): PlanStep => ({ kind: "move", to: { col: feet / 5, row: 0 }, feet });
const dash = (feet: number, run = 60): PlanStep => ({ kind: "move", to: { col: feet / 5, row: 0 }, feet, run });
const attack: PlanStep = { kind: "action", action: "attack", target: { id: 2, name: "T2" } };

test("a Dash is timed at running speed", () => {
  assert.equal(stepSeconds(walk(30), 30), 6);
  assert.equal(stepSeconds(dash(30), 30), 3);
  assert.equal(stepSeconds(dash(30, 40), 30), 4.5);
  assert.equal(timeline([dash(60)], 30).used, 6);
});

test("a Dash takes the round's action: no other action with it, either way round", () => {
  assert.match(cannotAdd([dash(20)], attack, 30)!, /dashing/);
  assert.match(cannotAdd([attack], dash(20), 30)!, /already planned your action/);
  assert.match(unavailable([dash(20)], 2, "action", 1)!, /dashing/);
  assert.equal(cannotAdd([dash(20)], dash(10), 30), null, "more Dash legs are fine");
  assert.equal(cannotAdd([dash(20)], walk(5), 30), null, "and walking");
  assert.equal(unavailable([dash(20)], 2, "bonus", 1), null, "bonus actions still fit");
});
