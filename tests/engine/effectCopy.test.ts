import { test } from "node:test";
import assert from "node:assert/strict";
import { copyOf, isTuned, tune, tunablesOf } from "@/lib/effectCopy";
import type { Modifier } from "@/lib/conditions";

const poisoned = {
  name: "Poisoned", modifiers: [{ kind: "periodic", value: "1d4", heal: false, damage_type: "poison" }, { kind: "boost", target: "attack", value: "-2" }] as Modifier[],
  duration: "rounds" as const, rounds: 3, apply_save_attr: "fortitude" as const, apply_save_dc: 12, save_attr: "fortitude" as const, save_dc: 12,
};

test("what a copy may change: name, rounds, its save DCs, and the numbers in its rules (labelled by their rule)", () => {
  const t = tunablesOf(poisoned);
  assert.deepEqual(t.map((x) => x.path), ["name", "rounds", "apply_save_dc", "save_dc", "modifiers.0.value", "modifiers.1.value"]);
  assert.match(t[4].label, /each round/);
  assert.ok(!tunablesOf({ ...poisoned, duration: "equipped" }).some((x) => x.path === "rounds"), "worn: no rounds");
  assert.ok(!tunablesOf({ ...poisoned, apply_save_attr: "" }).some((x) => x.path === "apply_save_dc"), "no save as it lands: no DC");
});

test("mild, severe and fatal Poisoned from one catalog effect; the catalog's own is untouched", () => {
  const mild = tune(poisoned, { name: "Mild poison", rounds: 2, "modifiers.0.value": "1" });
  const severe = tune(poisoned, { name: "Severe poison", rounds: 6, apply_save_dc: 15, save_dc: 15, "modifiers.0.value": "2d6", "modifiers.1.value": "-4" });
  const fatal = tune(poisoned, { name: "Deathcap venom", rounds: 10, save_dc: 18, "modifiers.0.value": "4d6" });
  assert.deepEqual([mild.rounds, (mild.modifiers[0] as { value: string }).value], [2, "1"]);
  assert.deepEqual([severe.apply_save_dc, severe.save_dc, (severe.modifiers[1] as { value: string }).value], [15, 15, "-4"]);
  assert.equal(fatal.name, "Deathcap venom");
  assert.equal(poisoned.rounds, 3);
  assert.equal((poisoned.modifiers[0] as { value: string }).value, "1d4", "nothing shared with the catalog's");
  assert.ok(isTuned(severe, poisoned) && !isTuned(copyOf(poisoned), poisoned));
});

test("locked parts can't change: which save, damage types, what kind of rule; bad values are refused", () => {
  assert.throws(() => tune(poisoned, { apply_save_attr: "agility" }), /can't be changed/);
  assert.throws(() => tune(poisoned, { "modifiers.0.damage_type": "fire" }), /can't be changed/);
  assert.throws(() => tune(poisoned, { "modifiers.1.target": "defense" }), /can't be changed/);
  assert.throws(() => tune(poisoned, { description: "x" }), /can't be changed/);
  assert.throws(() => tune(poisoned, { "modifiers.0.value": "lots" }), /dice/);
  assert.throws(() => tune(poisoned, { save_dc: 99 }), /from 1 to 40/);
  assert.throws(() => tune(poisoned, { name: "  " }), /blank/);
});

test("retune: the server keeps only the tunable parts of a copy a form sent", async () => {
  const { retune } = await import("@/lib/effectCopy");
  const posted = { ...poisoned, name: "Severe poison", rounds: 6, apply_save_attr: "agility" as const, modifiers: [{ ...poisoned.modifiers[0], value: "2d6", damage_type: "fire" }, poisoned.modifiers[1]] as Modifier[] };
  const kept = retune(poisoned, posted);
  assert.deepEqual([kept.name, kept.rounds, kept.apply_save_attr], ["Severe poison", 6, "fortitude"], "the save's ability stays");
  assert.deepEqual([(kept.modifiers[0] as { value: string }).value, (kept.modifiers[0] as { damage_type: string }).damage_type], ["2d6", "poison"], "the damage type stays");
});
