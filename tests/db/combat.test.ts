import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, item, level } from "./seed";
import { addAffliction, addCreatureToken, addProfessionModifier, getCondition, placeCharacterToken, saveEffectDef, saveProfession, saveProfessionGroup, setCharacterRank, setStandingEffects } from "@/lib/db";
import { fightersOn } from "@/lib/combat";
import { withSeed } from "@/lib/dice";

const lv = level();
const vest = item({ name: "Vest", type: "armor", defense: "2", slots: ["chest"] });
const club = item({ name: "Club", type: "weapon", damage: "1d6", attack: "+1", slots: ["main hand"], hands: 1 });
const hero = character("Hero", { health: "20", attributes: { agility: 14, might: 12 }, equipment: { chest: vest, "main hand": club } });
const heroTok = placeCharacterToken(lv, hero, 0, 0);
const rat = creature("Rat", { health: "5" });
const ratTok = addCreatureToken(lv, rat, 1, 0);

test("defense: 10 + agility modifier + armour", () => {
  const f = fightersOn(lv).get(heroTok)!;
  assert.equal(f.defense().total, 14);
  assert.match(f.defense().text, /\+2 armour/);
});

test("attack and damage use the main-hand weapon and might", () => {
  const f = fightersOn(lv).get(heroTok)!;
  for (let i = 0; i < 20; i++) {
    const a = f.attack();
    assert.ok(a.total >= 1 + 1 + 1 && a.total <= 20 + 1 + 1, `${a.total}`);
    const d = f.damage();
    assert.ok(d.total >= 2 && d.total <= 7, `${d.total}: ${d.text}`);
  }
  assert.match(fightersOn(lv).get(ratTok)!.damage().text, /1d4 unarmed/);
});

test("the same seed rolls a fighter's dice the same way", () => {
  const once = () => withSeed(5, () => { const f = fightersOn(lv).get(heroTok)!; return [f.attack().total, f.damage().total, f.save("agility").total]; });
  assert.deepEqual(once(), once());
});

test("sides default from the token: characters with the party, creatures hostile", () => {
  const all = fightersOn(lv);
  assert.equal(all.get(heroTok)!.allegiance, "party");
  assert.equal(all.get(ratTok)!.allegiance, "hostile");
});

test("profession modifiers always count", () => {
  const g = saveProfessionGroup(null, { name: "Military", description: "" });
  const grunt = saveProfession(null, { name: "Grunt", description: "", group_id: g });
  addProfessionModifier({ profession_id: grunt, target: "defense", value: "+1" });
  setCharacterRank(hero, grunt);
  assert.equal(fightersOn(lv).get(heroTok)!.defense().total, 15);
  setCharacterRank(hero, null);
});

test("a creature's standing effects: resistances and restrictions", () => {
  const thick = saveEffectDef(null, { name: "Thick hide", description: "", modifiers: [{ kind: "resist", damage_type: "slashing", level: "resistant" }] });
  setStandingEffects({ creature_id: rat }, [thick]);
  assert.deepEqual(fightersOn(lv).get(ratTok)!.resist, { slashing: ["resistant"] });
});

test("effects on a token count for its rolls and limits", () => {
  const cid = saveEffectDef(null, { name: "Dazed", description: "", modifiers: [{ kind: "forbid", what: "actions" }, { kind: "autofail", save: "agility" }, { kind: "boost", target: "defense", value: "-2" }], rounds: 2 });
  assert.equal(addAffliction(lv, heroTok, getCondition(cid)!, null), true);
  const f = fightersOn(lv).get(heroTok)!;
  assert.equal(f.limits?.forbid.action, "Dazed");
  assert.equal(f.save("agility").total, -99);
  assert.equal(f.defense().total, 12);
  assert.equal(addAffliction(lv, heroTok, { ...getCondition(cid)!, reapply: "ignore" }, null), false, "ignore: no change");
});
