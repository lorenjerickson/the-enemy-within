import { test } from "node:test";
import assert from "node:assert/strict";
import { act, attack, condition, fighter, gear, mover, resolve } from "./harness";
import { saveToEnd, tickAfflictions, SaveNeeded } from "@/lib/resolveRound";
import type { Affliction } from "@/lib/conditions";

const poisoned = (extra = {}) => condition(1, "Poisoned", [{ kind: "periodic", value: "2", heal: false, damage_type: "poison" }], { rounds: 3, save_attr: "fortitude", save_dc: 12, ...extra });
const on = (c: ReturnType<typeof condition>, left = c.rounds, by: number | null = null): Affliction => ({ condition: c, left, by });

test("damage over time ticks at the end of the round, a round comes off, then the save", () => {
  const r = resolve([mover(2, { col: 0, row: 0 })], { 2: fighter({ save: 5 }) }, { afflictions: { 2: [on(poisoned())] } });
  assert.equal(r.hp.get(2), 18);
  assert.equal(r.afflictions.get(2)?.[0].left, 2);
  assert.match(r.at(6), /Poisoned deals T2 2 poison damage; 18 left/);
  assert.match(r.at(6), /fails to shake off Poisoned \(5 vs DC 12\)/);
});

test("a successful save at the end of the round ends it", () => {
  const r = resolve([mover(2, { col: 0, row: 0 })], { 2: fighter({ save: 15 }) }, { afflictions: { 2: [on(poisoned())] } });
  assert.deepEqual(r.afflictions.get(2), []);
  assert.match(r.text, /shakes off Poisoned/);
});

test("the last round wears off without a save", () => {
  const r = resolve([mover(2, { col: 0, row: 0 })], { 2: fighter({ save: 1 }) }, { afflictions: { 2: [on(poisoned(), 1)] } });
  assert.deepEqual(r.afflictions.get(2), []);
  assert.match(r.text, /Poisoned wears off T2/);
});

test("a player's save to end a condition waits for their roll", () => {
  assert.throws(() => resolve([mover(2, { col: 0, row: 0 })], { 2: fighter() }, { afflictions: { 2: [on(poisoned())] }, rollers: [2] }), SaveNeeded);
  const r = resolve([mover(2, { col: 0, row: 0 })], { 2: fighter() }, { afflictions: { 2: [on(poisoned())] }, rollers: [2], decisions: { "end:6:Poisoned:2": 14 } });
  assert.deepEqual(r.afflictions.get(2), []);
});

test("conditions that take several saves count them up", () => {
  const a = on(poisoned({ saves_needed: 2 }));
  const f = fighter({ save: 15 });
  assert.deepEqual(saveToEnd(a, f, "T2"), { ended: false, line: "T2 resists Poisoned (15 vs DC 12): 1 of 2 saves." });
  assert.equal(saveToEnd(a, f, "T2").ended, true);
  assert.equal(saveToEnd(on(poisoned({ save_attr: "" })), f, "T2").line, "", "no save, nothing to roll");
});

test("tickAfflictions: healing over time stops at full health", () => {
  const regen = condition(2, "Regenerating", [{ kind: "periodic", value: "5", heal: true, damage_type: "" }], { rounds: 3 });
  const hp = new Map([[1, 18]]), f = fighter({ hp: 20 }), log: string[] = [];
  const afflicted = new Map([[1, [on(regen)]]]);
  tickAfflictions(afflicted, { hp, fighters: new Map([[1, f]]), down: new Set(), nameOf: () => "T1", log, sec: 6, hurt: () => 0 });
  assert.equal(hp.get(1), 20);
  assert.equal(afflicted.get(1)?.[0].left, 2);
});

test("tickAfflictions: resistance cuts periodic damage, and 0 health is down", () => {
  const hp = new Map([[1, 3]]), down = new Set<number>(), log: string[] = [];
  const burn = condition(3, "Burn", [{ kind: "periodic", value: "8", heal: false, damage_type: "fire" }], { rounds: 3 });
  tickAfflictions(new Map([[1, [on(burn)]]]), { hp, fighters: new Map([[1, fighter({}, { resist: { fire: ["resistant"] } })]]), down, nameOf: () => "T1", log, sec: 6, hurt: () => 0 });
  assert.equal(hp.get(1), 0);
  assert.ok(down.has(1));
  assert.match(log.join("\n"), /resistant: 4 of 8/);
});

test("tickAfflictions: a save against damage over time leaves its share", () => {
  const hp = new Map([[1, 20]]), log: string[] = [];
  const acid = condition(4, "Acid", [{ kind: "periodic", value: "10", heal: false, damage_type: "acid", save_attr: "agility", save_dc: 12, save_pct: 30 }], { rounds: 3 });
  tickAfflictions(new Map([[1, [on(acid)]]]), { hp, fighters: new Map([[1, fighter({ save: 15 })]]), down: new Set(), nameOf: () => "T1", log, sec: 6, hurt: () => 0 });
  assert.equal(hp.get(1), 17);
  assert.match(log[0], /30%/);
});

test("hurt by damage over time, conditions that end when hurt end", () => {
  const asleep = condition(5, "Asleep", [{ kind: "forbid", what: "actions" }], { rounds: 5, ends_on_damage: 1 });
  const hp = new Map([[1, 20]]), log: string[] = [];
  const afflicted = new Map([[1, [on(poisoned({ save_attr: "" })), on(asleep)]]]);
  tickAfflictions(afflicted, { hp, fighters: new Map([[1, fighter()]]), down: new Set(), nameOf: () => "T1", log, sec: 6, hurt: () => 0 });
  assert.deepEqual(afflicted.get(1)?.map((a) => a.condition.name), ["Poisoned"]);
  assert.match(log.join("\n"), /no longer asleep \(hurt\)/);
});

test("a hit puts an action's conditions on the target; a save as it lands can negate it", () => {
  const weak = condition(6, "Weakened", [{ kind: "boost", target: "attack", value: "-2" }], { rounds: 2, apply_save_attr: "fortitude", apply_save_dc: 13 });
  const use = gear({ name: "Venom bite", statuses: { minutes: 0.2, target: { source: "Venom bite", boosts: [], grants: [], conditions: [weak] } } });
  const failed = resolve([mover(1, { col: 0, row: 0 }, [attack(2, { use })]), mover(2, { col: 1, row: 0 })], { 1: fighter(), 2: fighter({ save: 5 }) });
  assert.ok(failed.afflictions.get(2)?.some((a) => a.condition.name === "Weakened"));
  assert.match(failed.text, /fails to resist Weakened/);
  const resisted = resolve([mover(1, { col: 0, row: 0 }, [attack(2, { use })]), mover(2, { col: 1, row: 0 })], { 1: fighter(), 2: fighter({ save: 15 }) });
  assert.ok(!resisted.afflictions.get(2)?.some((a) => a.condition.name === "Weakened"));
  assert.match(resisted.text, /T2 resists Weakened/);
});

test("a condition put on mid-round counts straight away: Stunned stops the rest of their round", () => {
  const stun = condition(7, "Stunned", [{ kind: "forbid", what: "actions" }], { rounds: 1 });
  const use = gear({ name: "Stun baton", seconds: 1, statuses: { minutes: 0.1, target: { source: "Stun baton", boosts: [], grants: [], conditions: [stun] } } });
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2, { use })]), mover(2, { col: 1, row: 0 }, [attack(1, { use: gear({ seconds: 3 }) })])], { 1: fighter({ dmg: 1 }), 2: fighter() });
  assert.equal(r.hp.get(1), 20);
  assert.match(r.text, /T2 can't (use Strike|attack) \(Stunned\)|interrupted/);
});

test("invisibility ends when they attack", () => {
  const invisible = condition(8, "Invisible", [{ kind: "sense", sense: "invisible" }], { rounds: 10, ends_on_attack: 1 });
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: fighter(), 2: fighter() }, { afflictions: { 1: [on(invisible)] } });
  assert.deepEqual(r.afflictions.get(1), []);
  assert.match(r.text, /T1 is no longer invisible \(they attacked\)/);
});

test("attacking unseen gives advantage; attacking someone you can't see, disadvantage", () => {
  const invisible = condition(8, "Invisible", [{ kind: "sense", sense: "invisible" }], { rounds: 10 });
  const sneak = fighter();
  resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: sneak, 2: fighter() }, { afflictions: { 1: [on(invisible)] } });
  assert.deepEqual(sneak.attacks[0].more, ["advantage"]);
  const blindly = fighter();
  resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: blindly, 2: fighter() }, { afflictions: { 2: [on(invisible)] } });
  assert.deepEqual(blindly.attacks[0].more, ["disadvantage"]);
});

test("in the dark, only darkvision sees", () => {
  const plain = fighter();
  resolve([mover(1, { col: 0, row: 0 }, [attack(2)], { attackRange: 10 }), mover(2, { col: 5, row: 0 })], { 1: plain, 2: fighter() }, { lit: () => false });
  assert.ok(plain.attacks[0].more.includes("disadvantage"));
  const seer = fighter({}, { senseMods: [{ kind: "sense", sense: "darkvision", range: 60 }] });
  resolve([mover(1, { col: 0, row: 0 }, [attack(2)], { attackRange: 10 }), mover(2, { col: 5, row: 0 })], { 1: seer, 2: fighter() }, { lit: () => false });
  assert.ok(!seer.attacks[0].more.includes("disadvantage"));
});

test("concentration: a second concentration condition ends the first", () => {
  const bless = condition(10, "Blessed", [{ kind: "boost", target: "attack", value: "+1" }], { rounds: 10, concentration: 1 });
  const hex = condition(11, "Hexed", [{ kind: "boost", target: "attack", value: "-1" }], { rounds: 10, concentration: 1 });
  const hexUse = gear({ name: "Hex", damage: null, range: 6, statuses: { minutes: 1, target: { source: "Hex", boosts: [], grants: [], conditions: [hex] } } });
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [attack(3, { use: hexUse })]), mover(2, { col: 1, row: 0 }), mover(3, { col: 2, row: 0 })],
    { 1: fighter(), 2: fighter(), 3: fighter() },
    { afflictions: { 2: [on(bless, 10, 1)] } },
  );
  assert.deepEqual(r.afflictions.get(2), []);
  assert.match(r.text, /T1 turns their concentration to Hexed: Blessed ends/);
});

test("concentration: a caster hurt makes a Fortitude save, and loses it on a failure", () => {
  const bless = condition(10, "Blessed", [{ kind: "boost", target: "attack", value: "+1" }], { rounds: 10, concentration: 1 });
  const r = resolve(
    [mover(1, { col: 0, row: 0 }), mover(2, { col: 1, row: 0 }, [attack(1)])],
    { 1: fighter({ save: 5 }), 2: fighter({ dmg: 4 }), 3: fighter() },
    { afflictions: { 3: [on(bless, 10, 1)] } },
  );
  assert.match(r.text, /T1's concentration breaks \(Fortitude 5 vs DC 10\)/);
  assert.deepEqual(r.afflictions.get(3), []);
  const kept = resolve(
    [mover(1, { col: 0, row: 0 }), mover(2, { col: 1, row: 0 }, [attack(1)])],
    { 1: fighter({ save: 12 }), 2: fighter({ dmg: 4 }), 3: fighter() },
    { afflictions: { 3: [on(bless, 10, 1)] } },
  );
  assert.match(kept.text, /T1 keeps concentrating/);
});

test("shake off: spending the action rolls the save against conditions that allow it", () => {
  const grappled = condition(12, "Grappled", [{ kind: "forbid", what: "movement" }], { rounds: 5, save_attr: "might", save_dc: 12, save_action: 1 });
  const r = resolve([mover(1, { col: 0, row: 0 }, [act("shake")])], { 1: fighter({ save: 14 }) }, { afflictions: { 1: [on(grappled)] } });
  assert.deepEqual(r.afflictions.get(1), []);
  const none = resolve([mover(1, { col: 0, row: 0 }, [act("shake")])], { 1: fighter() });
  assert.match(none.text, /nothing to shake off/);
});

test("extra damage on hits from a condition is added and labelled", () => {
  const flaming = condition(13, "Flaming weapon", [{ kind: "extra", value: "3", damage_type: "fire", when: "dealing" }], { rounds: 10 });
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: fighter({ dmg: 2 }, { extras: { dealing: [{ value: "3", damage_type: "fire", name: "Flaming weapon" }], taking: [] } }), 2: fighter() }, { afflictions: { 1: [on(flaming)] } });
  assert.equal(r.hp.get(2), 15);
  assert.match(r.text, /\+3 fire \(Flaming weapon\)/);
});

test("temporary health and strain from a condition come back with the round", () => {
  const shielding = condition(14, "Bolstered", [{ kind: "temphp", value: "6" }, { kind: "strain", attribute: "might", points: 1 }], { rounds: 1 });
  const use = gear({ name: "Bolster", damage: null, self: true, statuses: { minutes: 0.1, self: { source: "Bolster", boosts: [], grants: [], conditions: [shielding] } } });
  const r = resolve([mover(1, { col: 0, row: 0 }, [act("use", { use })])], { 1: fighter() });
  assert.equal(r.temps.get(1), 6);
  assert.deepEqual(r.strains, [{ tokenId: 1, attribute: "might", points: 1 }]);
});
