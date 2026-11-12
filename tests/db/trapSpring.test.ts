import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, level } from "./seed";
import { addCreatureToken, addTrap, getTrap, listAfflictions, placeCharacterToken, saveEffectDef, saveTrap } from "@/lib/db";
import { tokenHealth } from "@/lib/health";
import { springTrap, trapsOnStep, trapsWhereStopped } from "@/app/(play)/play/traps";
import type { Trap } from "@/lib/traps";

const lv = level();
const pitArea = { shape: "rect" as const, x: 3, y: 0, w: 1, h: 1 };
const settings = (t: Partial<Omit<Trap, "id" | "area" | "found" | "sprung">> = {}): Omit<Trap, "id" | "area" | "found" | "sprung"> => ({
  name: "Spike pit", springs: ["enter"], who: "", often: "once", damage: "6", damage_type: "piercing", save_attr: "", save_dc: 12, save_half: 1, effects: [], stops: 1, find_dc: 14, ...t,
});
const trapWith = (t: Partial<Omit<Trap, "id" | "area" | "found" | "sprung">> = {}, area = pitArea) => { const id = addTrap(lv, area); saveTrap(id, settings(t)); return id; };

test("a trap with no save always lands: damage, its effects, found, spent; the player is told how bad, the GM the numbers", () => {
  const tok = placeCharacterToken(lv, character("Annis", { health: "20" }), 2, 0);
  const slowed = saveEffectDef(null, { name: "Hobbled", description: "", modifiers: [{ kind: "speed", factor: 0.5 }], rounds: 3 });
  const id = trapWith({ effects: [slowed] });
  const s = springTrap(lv, getTrap(id)!, tok);
  assert.equal(tokenHealth(tok)!.current, 14);
  assert.ok(listAfflictions(lv).get(tok)?.some((a) => a.condition.name === "Hobbled"));
  assert.equal(getTrap(id)!.found, 1);
  assert.deepEqual(getTrap(id)!.sprung, [tok]);
  assert.match(s.player, /You set off a trap \(Spike pit\)! You're hurt: moderate \(-6\), you're hobbled, you stop where you are\./);
  assert.match(s.gm, /Annis sets off Spike pit: 6 piercing damage; Hobbled/);
});

test("a save for half (or none); effects only on a failed save", () => {
  const strong = character("Bram", { health: "20", attributes: { agility: 30 } }); // always saves (d20 + 10)
  const tok = placeCharacterToken(lv, strong, 2, 2);
  const stuck = saveEffectDef(null, { name: "Stuck", description: "", modifiers: [{ kind: "forbid", what: "movement" }], rounds: 2 });
  const half = springTrap(lv, getTrap(trapWith({ damage: "8", save_attr: "agility", save_dc: 5, effects: [stuck] }))!, tok);
  assert.equal(tokenHealth(tok)!.current, 16);
  assert.match(half.player, /partly get clear/);
  assert.ok(!listAfflictions(lv).get(tok)?.some((a) => a.condition.name === "Stuck"));
  const none = springTrap(lv, getTrap(trapWith({ damage: "8", save_attr: "agility", save_dc: 5, save_half: 0 }))!, tok);
  assert.equal(tokenHealth(tok)!.current, 16);
  assert.match(none.player, /You get clear/);
});

test("walking: stepping in springs it (once), passing beside doesn't; who it's for counts", () => {
  const l2 = level("Corridor");
  const id = addTrap(l2, pitArea);
  saveTrap(id, settings({ who: "party" }));
  const hero = placeCharacterToken(l2, character("Cass", { health: "20" }), 2, 0);
  const rat = addCreatureToken(l2, creature("Rat", { health: "5" }), 2, 1);
  assert.deepEqual(trapsOnStep(l2, rat, { x: 2, y: 1 }, { x: 3, y: 0 }), [], "only the party sets it off");
  assert.deepEqual(trapsOnStep(l2, hero, { x: 2, y: 1 }, { x: 3, y: 1 }), [], "beside it");
  const sprung = trapsOnStep(l2, hero, { x: 2, y: 0 }, { x: 3, y: 0 });
  assert.equal(sprung.length, 1);
  assert.equal(sprung[0].stops, true);
  assert.deepEqual(trapsOnStep(l2, hero, { x: 2, y: 0 }, { x: 3, y: 0 }), [], "spent");
});

test("a trap that springs when a move ends in it", () => {
  const l3 = level("Vault");
  const id = addTrap(l3, pitArea);
  saveTrap(id, settings({ springs: ["end"], often: "always", damage: "1" }));
  const tok = placeCharacterToken(l3, character("Dee", { health: "10" }), 3, 0);
  assert.equal(trapsOnStep(l3, tok, { x: 2, y: 0 }, { x: 3, y: 0 }).length, 0, "not on the way in");
  assert.equal(trapsWhereStopped(l3, tok, { x: 3, y: 0 }).length, 1);
  assert.equal(trapsWhereStopped(l3, tok, { x: 3, y: 0 }).length, 1, "every time");
  assert.equal(trapsWhereStopped(l3, tok, { x: 5, y: 0 }).length, 0);
  assert.equal(tokenHealth(tok)!.current, 8);
});
