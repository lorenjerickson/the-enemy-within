import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afterResist, blindRangeOf, combineResist, describeCondition, describeLifecycle, describeModifier, extrasOf, lingers, reapplied,
  resistsOf, restrictionsOf, rollChanges, savePct, seesThem, sensesFrom, unseenModes, type Condition, type Modifier,
} from "@/lib/conditions";

export const cond = (id: number, modifiers: Modifier[], extra: Partial<Condition> = {}): Condition => ({
  id, name: `Cond ${id}`, description: "", rounds: 3, save_attr: "", save_dc: 12,
  effects: [{ id: id * 10, name: `Effect ${id}`, description: "", modifiers }], ...extra,
});

test("resistances: immune wins, resistant and vulnerable cancel", () => {
  assert.equal(combineResist(undefined), null);
  assert.equal(combineResist(["resistant", "immune", "vulnerable"]), "immune");
  assert.equal(combineResist(["resistant", "vulnerable"]), null);
  assert.equal(combineResist(["resistant", "resistant"]), "resistant");
  assert.equal(afterResist(7, "resistant"), 3);
  assert.equal(afterResist(7, "vulnerable"), 14);
  assert.equal(afterResist(7, "immune"), 0);
  assert.equal(afterResist(7, null), 7);
  assert.deepEqual(resistsOf([{ kind: "resist", damage_type: "fire", level: "resistant" }, { kind: "resist", damage_type: "fire", level: "vulnerable" }]), { fire: ["resistant", "vulnerable"] });
});

test("restrictions: forbids by step kind, autofail saves, sparing the source", () => {
  const r = restrictionsOf([{ kind: "forbid", what: "actions" }, { kind: "forbid", what: "attack-source" }, { kind: "autofail", save: "might" }], "Hypnotized", 7);
  assert.equal(r.forbid.action, "Hypnotized");
  assert.equal(Object.keys(r.forbid).length, 1);
  assert.deepEqual(r.spare, [7]);
  assert.deepEqual(r.autofail, ["might"]);
  restrictionsOf([{ kind: "forbid", what: "actions" }, { kind: "forbid", what: "movement" }], "Stunned", null, r);
  assert.equal(r.forbid.action, "Hypnotized", "the first reason sticks");
  assert.equal(r.forbid.movement, "Stunned");
});

test("extras: dealing on their hits, taking from the one who put it on", () => {
  const x = extrasOf([{ kind: "extra", value: "1d6", damage_type: "fire", when: "dealing" }, { kind: "extra", value: "1d4", damage_type: "necrotic", when: "taking" }], "Hex", 4);
  assert.deepEqual(x.dealing, [{ value: "1d6", damage_type: "fire", name: "Hex" }]);
  assert.deepEqual(x.taking, [{ value: "1d4", damage_type: "necrotic", name: "Hex", from: 4 }]);
});

test("senses: best darkvision under the lowest cap, shortest blindness", () => {
  const s = sensesFrom([{ kind: "sense", sense: "darkvision", range: 60 }, { kind: "sense", sense: "darkvision", range: 120 }, { kind: "cap", target: "darkvision", value: 30 }]);
  assert.equal(s.darkvision, 30);
  assert.equal(s.blind, false);
  assert.equal(s.blindRange, blindRangeOf(Infinity));
  const blind = sensesFrom([{ kind: "sense", sense: "blind", range: 10 }, { kind: "sense", sense: "blind" }]);
  assert.ok(blind.blind);
  assert.equal(blind.blindRange, 1.5, "5 ft: the squares around them");
  assert.equal(blindRangeOf(10), 2.5);
});

test("invisibility: who sees whom, and what it does to attack rolls", () => {
  const plain = sensesFrom([]), invisible = sensesFrom([{ kind: "sense", sense: "invisible" }]), seer = sensesFrom([{ kind: "sense", sense: "seeinvisible" }]);
  assert.ok(!seesThem(plain, invisible));
  assert.ok(seesThem(seer, invisible));
  assert.deepEqual(unseenModes(invisible, plain), ["advantage"]);
  assert.deepEqual(unseenModes(plain, invisible), ["disadvantage"]);
  assert.deepEqual(unseenModes(plain, plain), []);
});

test("savePct: set percentage, else half or nothing", () => {
  assert.equal(savePct({}), 50);
  assert.equal(savePct({ save_halves: false }), 0);
  assert.equal(savePct({ save_pct: 25, save_halves: false }), 25);
});

test("reapplying: refresh starts its rounds over", () => {
  const c = cond(1, [{ kind: "boost", target: "defense", value: "-2" }]);
  const once = reapplied([], c, 3, null);
  assert.equal(once.list.length, 1);
  const worn = [{ ...once.list[0], left: 1 }];
  const again = reapplied(worn, c, 3, 9);
  assert.equal(again.list.length, 1);
  assert.equal(again.list[0].left, 3);
  assert.equal(again.list[0].by, 9);
});

test("reapplying: ignore leaves it be; stack adds up to the limit, then renews the oldest", () => {
  const ignore = cond(2, [], { reapply: "ignore" });
  const first = reapplied([], ignore, 3, null).list;
  assert.deepEqual(reapplied(first, ignore, 5, null), { list: first, applied: false });

  const stack = cond(3, [], { reapply: "stack", stack_limit: 2 });
  let list = reapplied([], stack, 3, null).list;
  list = reapplied(list.map((a) => ({ ...a, left: 1 })), stack, 3, null).list;
  assert.deepEqual(list.map((a) => a.left), [1, 3]);
  list = reapplied(list, stack, 4, null).list;
  assert.deepEqual(list.map((a) => a.left).sort(), [3, 4], "the one with fewest rounds left started over");
});

test("reapplying leaves an aura's copy alone", () => {
  const c = cond(4, []);
  const list = reapplied([{ condition: c, left: 0, by: 2, aura: 2 }], c, 3, null).list;
  assert.equal(list.length, 2);
});

test("lingers: an instant heal doesn't stay; anything ongoing does", () => {
  assert.ok(!lingers(cond(5, [{ kind: "instant", value: "1d10", heal: true, damage_type: "" }])));
  assert.ok(!lingers(cond(5, [{ kind: "temphp", value: "5" }])));
  assert.ok(lingers(cond(5, [{ kind: "periodic", value: "1d2", heal: false, damage_type: "poison" }])));
});

test("rollChanges turns modifiers into status pieces", () => {
  const r = rollChanges(cond(6, [
    { kind: "boost", target: "attack", value: "+1" },
    { kind: "roll", roll: "attack", mode: "disadvantage" },
    { kind: "set", target: "attribute:might", value: 19 },
    { kind: "multiply", target: "damage", factor: 2 },
    { kind: "crit", range: 19 },
    { kind: "cap", target: "attribute:might", value: 8 },
    { kind: "cap", target: "darkvision", value: 0 },
  ]));
  assert.deepEqual(r.boosts, [{ target: "attack", value: "+1" }]);
  assert.deepEqual(r.grants, [{ roll: "attack", mode: "disadvantage" }]);
  assert.deepEqual(r.sets, [{ target: "attribute:might", value: 19 }]);
  assert.deepEqual(r.factors, [{ target: "damage", factor: 2 }]);
  assert.deepEqual(r.tweaks, [{ kind: "crit", range: 19 }]);
  assert.deepEqual(r.caps, [{ target: "attribute:might", value: 8 }], "darkvision caps are senses, not statuses");
});

test("descriptions read like the handbook", () => {
  assert.equal(describeModifier({ kind: "periodic", value: "1d2", heal: false, damage_type: "poison" }), "1d2 poison damage a round");
  assert.equal(describeModifier({ kind: "forbid", what: "reactions" }), "can't react");
  assert.equal(describeModifier({ kind: "speed", factor: 0.5 }), "half speed");
  assert.equal(describeModifier({ kind: "resist", damage_type: "fire", level: "immune" }), "immune to fire");
  assert.equal(describeModifier({ kind: "resist", damage_type: "cold", level: "resistant" }), "resistant to cold");
  assert.equal(describeLifecycle({ rounds: 1, save_attr: "fortitude", save_dc: 13, saves_needed: 2, save_action: 1 }), "1 round · Fortitude DC 13 ×2 each round (or as an action) ends it");
  const poisoned = cond(7, [{ kind: "periodic", value: "1d2", heal: false, damage_type: "poison" }], { rounds: 6, save_attr: "fortitude", save_dc: 12 });
  assert.equal(describeCondition(poisoned), "1d2 poison damage a round · 6 rounds · Fortitude DC 12 each round ends it");
  assert.equal(describeCondition(cond(8, [{ kind: "instant", value: "1d10", heal: true, damage_type: "" }])), "heals 1d10");
});
