import { test } from "node:test";
import assert from "node:assert/strict";
import { creature, item } from "./seed";
import { db } from "@/lib/db/connection";
import { getCondition, getEffectDef, getStandingUses, removeEffectDef, saveEffectDef, setStandingEffects, withCopies } from "@/lib/db/effects";
import { effectCopies } from "@/lib/db/migrations";
import { gearOf } from "@/lib/actionCard";
import type { Modifier } from "@/lib/conditions";

const poison = () => saveEffectDef(null, { name: "Poisoned", description: "", modifiers: [{ kind: "periodic", value: "1d4", heal: false, damage_type: "poison" }] as Modifier[], rounds: 3 });
const valueOf = (m?: Modifier) => (m as { value?: string } | undefined)?.value;

test("a use added now holds a copy: a later catalog edit doesn't reach it; a kept use keeps its copy", () => {
  const id = poison();
  const [use] = withCopies([{ id, on: "target" as const }]);
  assert.equal(use.copy?.rounds, 3);
  saveEffectDef(id, { name: "Poisoned", description: "", modifiers: [{ kind: "periodic", value: "3d6", heal: false, damage_type: "poison" }] as Modifier[], rounds: 9 });
  const g = gearOf({ name: "Dart", kind: "action", seconds: 2, boosts: [], roll_grants: [], conditions: [use], duration_amount: 1, duration_unit: "round", damage: null, attack: null, targets: "others" } as never, (x) => getCondition(x));
  const c = g.statuses?.target?.conditions?.[0];
  assert.equal(c?.rounds, 3, "the dart's own copy, not the catalog's 9 rounds");
  assert.equal(valueOf(c?.effects[0].modifiers[0]), "1d4");
  const [kept] = withCopies([{ id, on: "target" as const }], [use], (a, b) => a.id === b.id);
  assert.equal(kept.copy?.rounds, 3, "saving the action again keeps its copy");
});

test("items and creatures: their effects stored as copies; editing by id keeps them; play reads the copy", () => {
  const id = poison();
  const rat = creature("Plague rat");
  setStandingEffects({ creature_id: rat }, [id]);
  saveEffectDef(id, { name: "Poisoned", description: "", modifiers: [], rounds: 1 });
  setStandingEffects({ creature_id: rat }, [id]); // the editor saves ids
  const [u] = getStandingUses({ creature_id: rat });
  assert.equal(u.copy?.rounds, 3, "kept, not re-copied from the edited catalog");
});

test("the migration copies older uses (bare ids, actions without copies); removing a catalog effect leaves the copies", () => {
  const id = poison();
  const dagger = item({ name: "Poisoned dagger" });
  db.prepare("UPDATE items SET effects = ? WHERE id = ?").run(JSON.stringify([id]), dagger); // as stored before copies
  effectCopies();
  const [u] = getStandingUses({ item_id: dagger });
  assert.equal(u.id, id);
  assert.equal(u.copy?.name, "Poisoned");
  removeEffectDef(id);
  assert.equal(getEffectDef(id), undefined);
  assert.equal(getStandingUses({ item_id: dagger })[0]?.copy?.name, "Poisoned", "the dagger keeps its poison");
});

test("a +1 ring tuned to +2: the item's tuned copy is what its wearer gets; the catalog's stays +1", async () => {
  const { catalogCopy } = await import("@/lib/db/effects");
  const { tune } = await import("@/lib/effectCopy");
  const { standingEffects } = await import("@/lib/creatureChanges");
  const { level, character } = await import("./seed");
  const { placeCharacterToken } = await import("@/lib/db/tokens");
  const plus = saveEffectDef(null, { name: "Warded", description: "", modifiers: [{ kind: "boost", target: "defense", value: "+1" }] as Modifier[], duration: "equipped" });
  const ring = item({ name: "Ring of warding" });
  setStandingEffects({ item_id: ring }, [{ id: plus, copy: tune(catalogCopy(plus)!, { "modifiers.0.value": "+2" }) }]);
  const wearer = placeCharacterToken(level("Hall"), character("Ada"), 1, 1);
  const got = standingEffects(wearer, { "left hand": ring } as never).find((e) => e.name === "Warded");
  assert.equal(valueOf(got?.modifiers[0]), "+2");
  assert.equal(valueOf(getEffectDef(plus)!.modifiers[0]), "+1");
});
