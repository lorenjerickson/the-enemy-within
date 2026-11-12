import { test } from "node:test";
import assert from "node:assert/strict";
import { act, attack, condition, fighter, gear, move, mover, resolve } from "./harness";
import type { Trigger } from "@/lib/conditions";

const trig = (t: Partial<Trigger>): Trigger => ({ kind: "trigger", on: "hit", reach: "any", damage: "", damage_type: "", save_attr: "", save_dc: 12, save_halves: true, condition: 0, condition_on: "other", ...t });

test("Dodge declared first: attacks against them have disadvantage", () => {
  const attacker = fighter();
  resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 }, [act("dodge")])], { 1: attacker, 2: fighter({ save: 15 }) });
  assert.deepEqual(attacker.attacks[0].against, ["Dodge"]);
});

test("Dodge needs DC 12: a slow dodge does nothing", () => {
  const attacker = fighter();
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 }, [act("dodge")])], { 1: attacker, 2: fighter({ save: 11 }) });
  assert.deepEqual(attacker.attacks[0].against, []);
  assert.match(r.text, /tries to dodge but isn't quick enough/);
});

test("Dodge after a move only works from its second: an attack during the move isn't dodged", () => {
  const attacker = fighter();
  // T1's quick jab lands at 1 s, while T2 is still stepping aside (still within reach).
  resolve(
    [mover(1, { col: 0, row: 0 }, [attack(2, { use: gear({ seconds: 1 }) })]), mover(2, { col: 1, row: 0 }, [move(1, 1), act("dodge")])],
    { 1: attacker, 2: fighter({ save: 15 }) },
  );
  assert.deepEqual(attacker.attacks[0].against, []);
});

test("a condition stopping reactions stops a planned Dodge", () => {
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 }, [act("dodge")])],
    { 1: fighter(), 2: fighter({ save: 15 }, { limits: { forbid: { reaction: "Dazed" }, autofail: [], spare: [] } }) },
  );
  assert.match(r.text, /T2 can't dodge \(Dazed\)/);
});

test("a stopped kind of step doesn't happen", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: fighter({}, { limits: { forbid: { action: "Stunned" }, autofail: [], spare: [] } }), 2: fighter() });
  assert.match(r.text, /T1 can't attack \(Stunned\)/);
  assert.equal(r.hp.get(2), 20);
});

test("a hypnotized creature can't attack whoever hypnotized it", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: fighter({}, { limits: { forbid: {}, autofail: [], spare: [2] } }), 2: fighter() });
  assert.match(r.text, /T1 can't bring themselves to attack T2/);
});

test("'when hit' triggers hurt the attacker; melee-only ones ignore ranged hits", () => {
  const thorns = fighter({ hp: 30 }, { triggers: [{ mod: trig({ on: "hit", reach: "melee", damage: "3" }), name: "Thorns" }] });
  const melee = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: fighter(), 2: thorns });
  assert.equal(melee.hp.get(1), 17);
  assert.match(melee.text, /Thorns \(T2\) deals T1 3 damage/);
  const thorns2 = fighter({ hp: 30 }, { triggers: [{ mod: trig({ on: "hit", reach: "melee", damage: "3" }), name: "Thorns" }] });
  const ranged = resolve([mover(1, { col: 0, row: 0 }, [attack(2)], { attackRange: 6 }), mover(2, { col: 4, row: 0 })], { 1: fighter(), 2: thorns2 });
  assert.equal(ranged.hp.get(1), 20);
});

test("a trigger's damage allows a save for half", () => {
  const shock = fighter({ hp: 30 }, { triggers: [{ mod: trig({ on: "hit", damage: "8", save_attr: "agility", save_dc: 12 }), name: "Shock" }] });
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: fighter({ save: 14 }), 2: shock });
  assert.equal(r.hp.get(1), 16);
  assert.match(r.text, /halved/);
});

test("'when you hit' triggers fire on the target", () => {
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })],
    { 1: fighter({ dmg: 2 }, { triggers: [{ mod: trig({ on: "hitting", damage: "4", damage_type: "fire" }), name: "Flame tongue" }] }), 2: fighter() },
  );
  assert.equal(r.hp.get(2), 14);
});

test("a reaction trigger fires once a round: the first attack sets it off, the second doesn't", () => {
  // Riposte: when attacked, 2 damage back (using the reaction).
  const riposte = fighter({ hp: 40 }, { triggers: [{ mod: trig({ on: "attacked", damage: "2", reaction: true }), name: "Riposte" }] });
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [attack(3)]), mover(2, { col: 2, row: 0 }, [attack(3)]), mover(3, { col: 1, row: 0 })],
    { 1: fighter(), 2: fighter(), 3: riposte },
  );
  assert.equal(r.hp.get(1), 18, "the higher initiative attacks first and is riposted");
  assert.equal(r.hp.get(2), 20, "the reaction is spent");
  assert.match(r.text, /T3 uses their reaction: Riposte/);
});

test("a planned reaction (Dodge) spends the reaction, so reaction triggers don't fire", () => {
  const riposte = fighter({ hp: 40, save: 15 }, { triggers: [{ mod: trig({ on: "attacked", damage: "2", reaction: true }), name: "Riposte" }] });
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(3)]), mover(3, { col: 1, row: 0 }, [act("dodge")])], { 1: fighter(), 3: riposte });
  assert.equal(r.hp.get(1), 20);
});

test("Shield-style ability planned as the round's reaction: a condition with a 'would hit' trigger raises defense in time", () => {
  const shielded = condition(50, "Shielded", [{ kind: "boost", target: "defense", value: "+5" }], { rounds: 1 });
  const ward = condition(51, "Ward", [trig({ on: "would_hit", condition: 50, condition_on: "self", given: shielded })], { rounds: 1, ends_on_trigger: 1 });
  const shieldUse = gear({ name: "Shield", kind: "reaction", self: true, seconds: 0.5, damage: null, statuses: { minutes: 0.1, self: { source: "Shield", boosts: [], grants: [], conditions: [ward] } } });
  // Defense reads its statuses: 12 + any defense boosts.
  const me = fighter({ hp: 20 });
  me.defense = () => ({ total: 12 + (me.statuses ?? []).flatMap((s) => s.boosts).filter((b) => b.target === "defense").reduce((n, b) => n + Number(b.value), 0), text: "" });
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 }, [act("use", { use: shieldUse })])], { 1: fighter({ hit: 15 }), 2: me });
  assert.match(r.text, /T2 readies Shield/);
  assert.equal(r.hp.get(2), 20, "15 would hit 12, but not 17");
  assert.match(r.text, /Ward is spent/);
});

test("a 'would hit' reroll makes the attacker take the lower roll", () => {
  let n = 0;
  const attacker = fighter({}, { attack: () => ({ total: n++ === 0 ? 18 : 5, text: "" }) });
  const barbs = fighter({}, { triggers: [{ mod: trig({ on: "would_hit", reroll: true }), name: "Silvery Barbs" }] });
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: attacker, 2: barbs });
  assert.match(r.text, /T1 rerolls the attack: 5/);
  assert.equal(r.hp.get(2), 20);
});

test("refit: the new gear is worn when it finishes and kept after the round", () => {
  const worn: unknown[] = [];
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [act("refit", { swap: { slot: "main hand", item: { id: 7, name: "Spear" }, from: { id: 3, name: "Knife" }, reach: 2 } }), attack(2)], { equipment: { "main hand": 3 } }), mover(2, { col: 2, row: 0 })],
    { 1: fighter({}, { wear: (e) => worn.push(e) }), 2: fighter() },
  );
  assert.deepEqual(worn, [{ "main hand": 7 }]);
  assert.equal(r.refits.length, 1);
  assert.match(r.text, /T1 swaps Knife for Spear \(main hand\)/);
  assert.deepEqual(r.final.get(1), { col: 0, row: 0 }, "the spear reaches: no closing in");
  assert.equal(r.hp.get(2), 15);
});
