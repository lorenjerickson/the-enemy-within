import { test } from "node:test";
import assert from "node:assert/strict";
import { creature, item } from "./seed";
import { db, getEffectDef, getStandingEffects, listActions, listAfflictions, listAuraPasses, listEffectDefs, migrateConditions, removeEffectDef, saveAction, saveEffectDef, settleEffects, setStandingEffects } from "@/lib/db";
import { BUILTIN_EFFECTS, BUILTIN_PIECES } from "@/lib/builtinConditions";
import type { Modifier } from "@/lib/conditions";

const json = (v: unknown) => JSON.stringify(v);
const insertEffect = (name: string, modifiers: Modifier[], builtin = "") => Number(db.prepare("INSERT INTO effects (name, description, modifiers, builtin) VALUES (?, '', ?, ?)").run(name, json(modifiers), builtin).lastInsertRowid);
const insertCondition = (name: string, effects: number[], extra: Record<string, unknown> = {}) => {
  const row = { name, description: `About ${name}`, effects: json(effects), rounds: 3, save_attr: "", save_dc: 12, builtin: "", ...extra };
  const cols = Object.keys(row);
  return Number(db.prepare(`INSERT INTO conditions (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`).run(row).lastInsertRowid);
};
const action = (conditions: { id: number; on: "self" | "target" }[]) => {
  saveAction(null, { item_id: lantern }, { name: "Flash", description: "", roll: "normal", attack: null, damage: null, damage_type: "", radius: 0, split: 0, boosts: [], roll_grants: [], duration_amount: 1, duration_unit: "", seconds: 2, range_ft: 5, area_shape: "", area_ft: 0, save_dc: 12, save_attr: "agility", save_half: 1, area_lasts: 0, area_fires: "end", targets: "anyone", target_who: "", target_count: "one", target_n: 1, conditions, kind: "action" } as never);
  return listActions({ item_id: lantern }).at(-1)!.id;
};
const lantern = item({ name: "Lantern", slots: ["off hand"] });

/** A catalog as it was before effects had lifecycles: built-ins made of shared pieces, and the GM's own conditions. */
function oldCatalog() {
  db.prepare("DELETE FROM effects").run();
  const renamed: Record<string, string> = { "see-invisible": "All Seeing", fear: "Frightened" }; // as the GM had them
  const piece = Object.fromEntries(BUILTIN_PIECES.map((p) => [p.key, insertEffect(renamed[p.key] ?? p.name, p.modifiers, p.key)]));
  const stunned = insertCondition("Stunned", ["incapacitated", "immobile", "limp", "exposed"].map((k) => piece[k]), { builtin: "stunned", rounds: 1 });
  const grappled = insertCondition("Grappled", [piece.immobile], { builtin: "grappled", rounds: 1 });
  const mesmerized = insertEffect("Mesmerized", [{ kind: "roll", roll: "attack", mode: "disadvantage" }]);
  const mesmerize = insertCondition("Mesmerize", [mesmerized], { rounds: 4, save_attr: "wisdom", save_dc: 14, concentration: 1 });
  const hold = insertCondition("Hold", [], { rounds: 2 });
  const burning = insertEffect("Burning", [{ kind: "periodic", value: "1d4", heal: false, damage_type: "fire" }]);
  const burn = insertCondition("Burn", [burning], { rounds: 2 });
  const flaming = insertEffect("Flaming", [{ kind: "trigger", on: "hitting", reach: "any", damage: "", damage_type: "", save_attr: "", save_dc: 12, save_halves: true, condition: burn, condition_on: "other" }]);
  const ward = insertEffect("Ward of fear", [{ kind: "aura", condition: mesmerize, radius: 10, who: "enemy", self: false }]);
  setStandingEffects({ item_id: lantern }, [piece.exposed, flaming]);
  const rat = creature("Rat");
  setStandingEffects({ creature_id: rat }, [ward]);
  const act = action([{ id: mesmerize, on: "target" }, { id: hold, on: "self" }, { id: 999, on: "target" }]);
  db.prepare("INSERT INTO token_afflictions (level_id, token_id, effect_id, effect, rounds_left, by_token) VALUES (1, 7, ?, ?, 2, NULL)").run(burn, json({ id: burn, name: "Burn", description: "", rounds: 2, save_attr: "", save_dc: 12, effects: [{ id: burning, name: "Burning", description: "", modifiers: [] }] }));
  db.prepare("INSERT INTO aura_passes (level_id, token_id, condition_id) VALUES (1, 7, ?)").run(mesmerize);
  return { piece, stunned, grappled, mesmerized, mesmerize, hold, burning, burn, flaming, ward, rat, act };
}

test("conditions become effects, and everything that named a condition names its effect", () => {
  const o = oldCatalog();
  assert.equal(migrateConditions(), 5);
  settleEffects();
  const byName = (n: string) => listEffectDefs().find((e) => e.name === n)!;

  // A custom condition with an effect of its own merges into it (keeping the effect's name and id).
  const m = getEffectDef(o.mesmerized)!;
  assert.equal(m.name, "Mesmerized");
  assert.deepEqual([m.duration, m.rounds, m.save_attr, m.save_dc, m.concentration], ["rounds", 4, "wisdom", 14, 1]);
  assert.equal(m.description, "About Mesmerize", "an empty description takes the condition's");
  // One with no effect becomes an effect of its own name; built-ins become single effects with every rule.
  assert.deepEqual(byName("Hold").modifiers, []);
  assert.equal(byName("Hold").rounds, 2);
  const stunned = byName("Stunned");
  assert.equal(stunned.builtin, "stunned");
  assert.deepEqual(stunned.modifiers, BUILTIN_EFFECTS.find((e) => e.key === "stunned")!.modifiers);
  assert.equal(byName("Grappled").builtin, "grappled");

  // Actions grant the effects (a condition that no longer existed is dropped).
  assert.deepEqual(listActions({ item_id: lantern }).find((a) => a.id === o.act)!.conditions, [{ id: o.mesmerized, on: "target" }, { id: byName("Hold").id, on: "self" }]);
  // Rules that gave a condition give its effect.
  const trigger = getEffectDef(o.flaming)!.modifiers[0];
  assert.equal(trigger.kind === "trigger" && trigger.condition, o.burning);
  assert.equal(trigger.kind === "trigger" && trigger.given?.name, "Burning");
  const aura = getEffectDef(o.ward)!.modifiers[0];
  assert.equal(aura.kind === "aura" && aura.condition, o.mesmerized);
  // Effects on tokens now, and aura passes.
  assert.equal(listAfflictions(1).get(7)![0].condition.id, o.burning);
  assert.deepEqual([...listAuraPasses(1)], [`7:${o.mesmerized}`]);

  // The old building blocks go, unless something still has one; durations follow what has them.
  assert.equal(getEffectDef(o.piece.incapacitated), undefined);
  assert.equal(getEffectDef(o.piece.fear), undefined, "renamed, but Frightened has its rules");
  assert.equal(getEffectDef(o.piece["see-invisible"])?.name, "All Seeing", "one no built-in uses stays (renamed or not)");
  assert.equal(getEffectDef(o.piece.exposed)?.duration, "equipped", "the lantern gives it");
  assert.equal(getEffectDef(o.piece.exposed)?.builtin, "", "no longer a built-in");
  assert.equal(getEffectDef(o.flaming)?.duration, "equipped");
  assert.equal(getEffectDef(o.ward)?.duration, "always", "the rat has it");
  assert.equal(getEffectDef(o.burning)?.duration, "rounds");
  assert.deepEqual(getStandingEffects({ item_id: lantern }), [o.piece.exposed, o.flaming]);

  // Nothing left to migrate; built-ins aren't seeded twice.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM conditions").get() && (db.prepare("SELECT COUNT(*) AS n FROM conditions").get() as { n: number }).n, 0);
  assert.equal(migrateConditions(), 0);
  settleEffects();
  assert.equal(listEffectDefs().filter((e) => e.builtin === "stunned").length, 1);
  assert.equal(listEffectDefs().filter((e) => e.name === "Stunned").length, 1);
});

test("every built-in is seeded once, as a single effect lasting rounds", () => {
  for (const b of BUILTIN_EFFECTS) {
    const found = listEffectDefs().filter((e) => e.builtin === b.key);
    assert.equal(found.length, 1, b.key);
    assert.equal(found[0].duration, "rounds");
  }
});

test("saving an effect keeps lifecycle fields it isn't given; removing one takes it off what grants it", () => {
  const id = saveEffectDef(null, { name: "Hasted", description: "", modifiers: [{ kind: "speed", factor: 2 }], rounds: 10, concentration: 1 });
  saveEffectDef(id, { name: "Hasted!", description: "Quick", modifiers: [{ kind: "speed", factor: 2 }] });
  const e = getEffectDef(id)!;
  assert.deepEqual([e.name, e.rounds, e.concentration, e.duration], ["Hasted!", 10, 1, "rounds"]);
  const a = action([{ id, on: "self" }]);
  setStandingEffects({ item_id: lantern }, [...getStandingEffects({ item_id: lantern }), id]);
  removeEffectDef(id);
  assert.deepEqual(listActions({ item_id: lantern }).find((x) => x.id === a)!.conditions, []);
  assert.ok(!getStandingEffects({ item_id: lantern }).includes(id));
});
