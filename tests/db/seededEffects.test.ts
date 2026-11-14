import { test } from "node:test";
import assert from "node:assert/strict";
import { db, listEffectDefs, removeEffectDef, seedCatalogEffects } from "@/lib/db";
import { SEEDED_EFFECTS } from "@/lib/seedEffects";

const byName = (name: string) => listEffectDefs().find((e) => e.name === name);

test("every seeded effect is in the catalog at start-up, with its rules and lifecycle", () => {
  for (const s of SEEDED_EFFECTS) {
    const e = byName(s.name);
    assert.ok(e, `${s.name} missing`);
    assert.ok(e.modifiers.length >= s.rules.length, `${s.name} lost rules`);
  }
  assert.equal(byName("Miasmic")!.duration, "always");
  assert.equal(byName("Reinforced")!.duration, "equipped");
  const fever = byName("Feverish")!;
  assert.deepEqual([fever.rounds, fever.save_attr, fever.reapply], [10, "fortitude", "ignore"]);
  const cut = byName("Lacerated")!;
  assert.deepEqual([cut.save_dc, cut.save_action, cut.reapply, cut.stack_limit], [10, 1, "stack", 3]);
  assert.equal(byName("Warded")!.concentration, 1);
  assert.equal(byName("Vigilant")!.ends_on_trigger, 1);
});

test("rules that name other effects point at them", () => {
  const aura = byName("Miasmic")!.modifiers.find((m) => m.kind === "aura");
  assert.equal(aura && "condition" in aura && aura.condition, byName("Sickly")!.id); // a built-in piece, added for it in a new campaign
  const vigil = byName("Vigilant")!.modifiers.find((m) => m.kind === "trigger");
  assert.equal(vigil && "condition" in vigil && vigil.condition, byName("Hampered")!.id);
  const frenzy = byName("Frenzied")!.modifiers.find((m) => m.kind === "trigger");
  const made = listEffectDefs().find((e) => frenzy && "condition" in frenzy && e.id === frenzy.condition);
  assert.equal(made?.name, "+1 damage");
  assert.deepEqual([made!.reapply, made!.stack_limit], ["stack", 3]);
});

test("seeding again adds nothing, and a deleted one stays deleted", () => {
  const count = () => db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM effects").get()!.n;
  const before = count();
  seedCatalogEffects();
  assert.equal(count(), before);
  removeEffectDef(byName("Lucky")!.id);
  seedCatalogEffects();
  assert.equal(byName("Lucky"), undefined);
});
