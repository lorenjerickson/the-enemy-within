import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, level } from "./seed";
import { addCreatureToken, db, getRoundPlan, placeCharacterToken, saveEncounter } from "@/lib/db";
import { addPlanStep, moveStepEnd, tokenPlanner } from "@/lib/roundPlanServer";

const setup = () => {
  const lv = level("Yard"), id = character("Walker");
  db.prepare("UPDATE characters SET movement = ? WHERE id = ?").run(JSON.stringify({ walking: { value: 5, dist: "ft", per: "s" } }), id);
  const me = placeCharacterToken(lv, id, 0, 0), rat = addCreatureToken(lv, creature("Rat"), 9, 9);
  saveEncounter(lv, { round: 1, turn: 0, order: [{ token_id: me, initiative: 15 }, { token_id: rat, initiative: 8 }] });
  return { plan: () => getRoundPlan(lv, me).plan, p: () => tokenPlanner(me)! };
};
const ends = (plan: ReturnType<ReturnType<typeof setup>["plan"]>) => plan.map((s): unknown => (s.kind === "move" ? s.to : s.kind === "action" ? s.action : ""));

test("dragging a planned move's end: shorter or longer, later steps kept", () => {
  const a = setup();
  assert.equal(addPlanStep(a.p(), { kind: "move", col: 4, row: 0 }), null);
  assert.equal(addPlanStep(a.p(), { kind: "action", action: "dodge" }), null);
  assert.equal(moveStepEnd(a.p(), 0, { col: 2, row: 0 }), null);
  assert.deepEqual(ends(a.plan()), [{ col: 2, row: 0 }, "dodge"]);
  assert.equal(moveStepEnd(a.p(), 0, { col: 3, row: 0 }), null);
  assert.deepEqual(ends(a.plan()), [{ col: 3, row: 0 }, "dodge"]);
});

test("the next move starts from the new end; too far for the round is refused and nothing changes", () => {
  const a = setup();
  addPlanStep(a.p(), { kind: "move", col: 2, row: 0 });
  addPlanStep(a.p(), { kind: "move", col: 2, row: 2 });
  assert.equal(moveStepEnd(a.p(), 0, { col: 1, row: 0 }), null);
  assert.deepEqual(ends(a.plan()), [{ col: 1, row: 0 }, { col: 2, row: 2 }]);
  const before = a.plan();
  assert.ok(moveStepEnd(a.p(), 0, { col: 6, row: 0 }), "6 squares + the next leg don't fit in 6 s");
  assert.deepEqual(a.plan(), before);
  assert.ok(moveStepEnd(a.p(), 5, { col: 1, row: 1 }), "not a move");
});
