import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, level } from "./seed";
import { addCreatureToken, placeCharacterToken } from "@/lib/db/tokens";
import { db } from "@/lib/db/connection";
import { getRoundPlan } from "@/lib/db/rounds";
import { saveEncounter } from "@/lib/db/encounters";
import { addPlanStep, removePlanStep, tokenPlanner } from "@/lib/roundPlanServer";

const setup = () => {
  const lv = level("Field"), id = character("Runner");
  db.prepare("UPDATE characters SET movement = ? WHERE id = ?").run(JSON.stringify({ walking: { value: 5, dist: "ft", per: "s" } }), id);
  const me = placeCharacterToken(lv, id, 0, 0), rat = addCreatureToken(lv, creature("Rat"), 6, 0);
  saveEncounter(lv, { round: 1, turn: 0, order: [{ token_id: me, initiative: 15 }, { token_id: rat, initiative: 8 }] });
  return { lv, me, rat, plan: () => getRoundPlan(lv, me).plan, p: () => tokenPlanner(me)! };
};

test("a chase is planned as 1-second slices: the rest of the round, or the seconds picked", () => {
  const a = setup();
  assert.equal(addPlanStep(a.p(), { kind: "action", action: "pursue", target: a.rat }), null);
  assert.equal(a.plan().length, 6);
  assert.ok(a.plan().every((s) => s.kind === "action" && s.action === "pursue" && s.seconds === 1));
  const b = setup();
  addPlanStep(b.p(), { kind: "action", action: "evade", target: b.rat, seconds: 3 });
  assert.equal(b.plan().length, 3);
});

test("taking out a slice in the middle takes out everything after it; the last one just shortens it", () => {
  const a = setup();
  addPlanStep(a.p(), { kind: "action", action: "follow", target: a.rat, seconds: 4 });
  assert.equal(removePlanStep(a.p(), 3), null);
  assert.equal(a.plan().length, 3, "the last slice: just that one");
  assert.equal(removePlanStep(a.p(), 1), null);
  assert.equal(a.plan().length, 1, "an interior slice: it and everything after it");
});
