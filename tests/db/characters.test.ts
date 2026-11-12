import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, level } from "./seed";
import { addCreatureToken, getCharacter, placeCharacterToken, saveCharacter } from "@/lib/db";
import { characterHealth, parseHealthForm, saveTokenHealth, tokenHealth } from "@/lib/health";

test("saving a character and reading it back", () => {
  const id = character("Annis", { attributes: { might: 14 }, health: "2d6+10" });
  const c = getCharacter(id)!;
  assert.equal(c.name, "Annis");
  assert.equal(c.attributes.might, 14);
  const { id: _id, creature_id, template_name: _t, ...rest } = c;
  saveCharacter(id, creature_id, { ...rest, name: "Annis Vale" });
  assert.equal(getCharacter(id)!.name, "Annis Vale");
});

test("maximum health is rolled once from the formula, then kept", () => {
  const id = character("Bram", { health: "2d6+10" });
  const first = characterHealth(id)!;
  assert.ok(first.maximum >= 12 && first.maximum <= 22);
  assert.equal(first.current, first.maximum);
  for (let i = 0; i < 5; i++) assert.deepEqual(characterHealth(id), first);
});

test("a character's token shares the character's health; a creature token keeps its own", () => {
  const lv = level();
  const c = character("Cass", { health: "10" });
  const ct = placeCharacterToken(lv, c, 0, 0);
  saveTokenHealth(ct, { current: 4, maximum: 10, temporary: 2 });
  assert.deepEqual(characterHealth(c), { current: 4, maximum: 10, temporary: 2 });
  const rat = creature("Rat", { health: "6" });
  const a = addCreatureToken(lv, rat, 1, 0), b = addCreatureToken(lv, rat, 2, 0);
  saveTokenHealth(a, { current: 1, maximum: 6, temporary: 0 });
  assert.equal(tokenHealth(a)!.current, 1);
  assert.equal(tokenHealth(b)!.current, 6, "each creature token has its own");
});

test("health is stored as whole numbers, never a negative maximum", () => {
  const lv = level("Upper");
  const t = placeCharacterToken(lv, character("Dee", { health: "10" }), 0, 0);
  saveTokenHealth(t, { current: 3.6, maximum: -2, temporary: -1 });
  assert.deepEqual(tokenHealth(t), { current: 4, maximum: 0, temporary: 0 });
});

test("the health form: blanks keep values, Restore fills current up", () => {
  const h = { current: 3, maximum: 10, temporary: 0 };
  const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  assert.deepEqual(parseHealthForm(form({ current: "", maximum: "12", temporary: "x" }), h), { current: 3, maximum: 12, temporary: 0 });
  assert.deepEqual(parseHealthForm(form({ restore: "1" }), h), { current: 10, maximum: 10, temporary: 0 });
  assert.equal(parseHealthForm(form({ maximum: "-5" }), h).maximum, 0);
});
