import { test } from "node:test";
import assert from "node:assert/strict";
import { act, fighter, mover, resolve } from "./harness";
import { cannotAdd, timeline, unavailable } from "@/lib/roundPlan";

const wait = act("wait");

test("Wait: a second each, as many as fit; it uses no action, movement, bonus action or reaction", () => {
  const plan = [wait, wait, wait];
  assert.equal(unavailable(plan, 3, "free", 1), null, "another Wait still fits");
  assert.equal(unavailable(plan, 3, "action", 2), null, "the action is still free");
  const attack = act("attack", { target: { id: 2, name: "T2" } });
  assert.equal(cannotAdd(plan, attack, 5), null);
  assert.equal(timeline([...plan, attack], 5).steps[3].start, 3, "what comes next starts after the waiting");
  assert.equal(unavailable([wait, wait, wait, wait, wait, wait], 6, "free", 1), "No time left this round");
});

test("Wait: nothing happens while waiting (not even interrupted), and the attack after it lands later", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [wait, wait, act("attack", { target: { id: 2, name: "T2" } })]), mover(2, { col: 1, row: 0 }, [act("attack", { target: { id: 1, name: "T1" } })])], { 1: fighter(), 2: fighter() });
  assert.doesNotMatch(r.text, /wait/i);
  assert.match(r.at(4), /T1/, "T1's attack finishes in the 4th second");
  assert.doesNotMatch(r.at(2), /T1 (hits|misses)/);
});
