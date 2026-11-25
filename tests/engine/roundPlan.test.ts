import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUND_SECONDS, afterRefits, cannotAdd, planEnd, stepKind, stepSeconds, timeline, unavailable, type GearAction, type PlanStep } from "@/lib/roundPlan";
import type { PlayerActionId } from "@/lib/playerActions";

type ActionStep = Extract<PlanStep, { kind: "action" }>;
const move = (col: number, row: number, feet: number): PlanStep => ({ kind: "move", to: { col, row }, feet });
const act = (action: PlayerActionId, extra: Partial<ActionStep> = {}): PlanStep => ({ kind: "action", action, ...extra });
const rat = { id: 2, name: "Rat" };
const gear = (g: Partial<GearAction> = {}): GearAction => ({ id: 1, name: "Bite", seconds: 2, range: 1, attack: "+3", damage: "1d6", roll: "normal", ...g });

test("moving at walking speed: 5 ft a second (30 ft a round)", () => {
  assert.equal(stepSeconds(move(1, 0, 5), 5), 1);
  assert.equal(stepSeconds(move(3, 0, 15), 5), 3);
  assert.equal(stepSeconds(move(1, 0, 5), 0), Infinity);
});

test("actions take their default seconds; gear actions their own", () => {
  assert.equal(stepSeconds(act("attack"), 5), 2);
  assert.equal(stepSeconds(act("dodge"), 5), 1);
  assert.equal(stepSeconds(act("attack", { use: gear({ seconds: 3 }) }), 5), 3);
});

test("timeline lays steps end to end", () => {
  const t = timeline([move(2, 0, 10), act("attack", { target: rat })], 5);
  assert.deepEqual(t.steps.map((s) => [s.start, s.end]), [[0, 2], [2, 4]]);
  assert.equal(t.used, 4);
  assert.equal(t.left, 2);
});

test("a chase with no seconds set runs the rest of the round", () => {
  const t = timeline([move(1, 0, 5), act("pursue", { target: rat })], 5);
  assert.equal(t.steps[1].end, ROUND_SECONDS);
  assert.equal(t.left, 0);
  assert.equal(timeline([act("evade", { target: rat, seconds: 2 })], 5).used, 2);
});

test("stepKind sorts movement, actions, bonus actions and reactions", () => {
  assert.equal(stepKind(move(1, 1, 5)), "movement");
  assert.equal(stepKind(act("attack")), "action");
  assert.equal(stepKind(act("dodge")), "reaction");
  assert.equal(stepKind(act("refit")), "bonus");
  assert.equal(stepKind(act("pursue")), "movement");
  assert.equal(stepKind(act("use", { use: gear({ kind: "reaction" }) })), "reaction");
  assert.equal(stepKind(act("use", { use: gear() })), "action");
  assert.equal(stepKind(act("use", { use: gear({ kind: "bonus" }) })), "bonus");
  assert.equal(stepKind(act("use", { use: gear({ kind: "free" }) })), "free");
});

test("a bonus gear action takes the bonus action; free ones only take time", () => {
  const quick = act("use", { use: gear({ kind: "bonus", seconds: 1 }) });
  assert.equal(cannotAdd([act("attack", { target: rat })], quick, 5), null);
  assert.match(cannotAdd([quick], quick, 5)!, /already planned your bonus action/);
  const free = act("use", { use: gear({ kind: "free", seconds: 1 }) });
  assert.equal(cannotAdd([act("attack", { target: rat }), quick, free], free, 5), null);
  assert.equal(unavailable([free], 1, "free", 1), null);
});

test("cannotAdd: one action, bonus action and reaction a round", () => {
  const plan = [act("attack", { target: rat })];
  assert.match(cannotAdd(plan, act("attack", { target: rat }), 5)!, /already planned your action/);
  assert.equal(cannotAdd(plan, act("dodge"), 5), null);
  assert.match(cannotAdd([act("dodge")], act("dodge"), 5)!, /reaction/);
  assert.match(cannotAdd([act("refit")], act("refit"), 5)!, /bonus action/);
});

test("cannotAdd: targeted actions need a target (or an aim, or 'all')", () => {
  assert.equal(cannotAdd([], act("attack"), 5), "Pick a target");
  const area = gear({ area: { shape: "circle", ft: 10, dc: 12, save: "agility", half: true } });
  assert.equal(cannotAdd([], act("attack", { use: area }), 5), "Aim it on the map");
  assert.equal(cannotAdd([], act("attack", { use: area, aim: { col: 3, row: 3 } }), 5), null);
  assert.equal(cannotAdd([], act("attack", { use: gear({ targeting: { who: "enemy", count: "all", n: 0 } }) }), 5), null);
});

test("cannotAdd: everything must fit the six seconds", () => {
  const plan = [move(5, 0, 25)]; // 5 s
  assert.match(cannotAdd(plan, act("attack", { target: rat }), 5)!, /doesn't fit/);
  assert.equal(cannotAdd(plan, act("dodge"), 5), null);
  assert.match(cannotAdd([move(6, 0, 30)], act("pursue", { target: rat }), 5)!, /No time left/);
});

test("unavailable greys out buttons with a reason", () => {
  assert.equal(unavailable([], 0, "action", 2), null);
  assert.match(unavailable([act("attack")], 2, "action", 2)!, /already planned your action/);
  assert.match(unavailable([act("refit")], 2, "bonus", 2)!, /bonus action/);
  assert.match(unavailable([], 5, "action", 2)!, /Not enough time left \(1 s\)/);
  assert.equal(unavailable([], 6, "movement", 1), "No time left this round");
  assert.equal(unavailable([], 0, "action", 1, { action: "Stunned" }), "Stunned: can't take actions");
  assert.equal(unavailable([], 0, "movement", 1, { movement: "Grappled" }), "Grappled: can't move");
});

test("planEnd is the last move's square", () => {
  assert.deepEqual(planEnd([], { col: 1, row: 1 }), { col: 1, row: 1 });
  assert.deepEqual(planEnd([move(2, 2, 5), act("dodge"), move(4, 2, 10)], { col: 1, row: 1 }), { col: 4, row: 2 });
});

test("afterRefits swaps slots and empties the other hand for two-handed items", () => {
  const eq = { "main hand": 1, "off hand": 2 };
  const out = afterRefits(eq, [act("refit", { swap: { slot: "main hand", item: { id: 9, name: "Rifle" }, from: { id: 1, name: "Knife" }, clears: "off hand" } })]);
  assert.deepEqual(out, { "main hand": 9, "off hand": null });
  assert.deepEqual(eq, { "main hand": 1, "off hand": 2 }, "doesn't change what it was given");
});
