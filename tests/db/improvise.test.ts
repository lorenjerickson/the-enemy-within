import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { getCondition, getVars, listAfflictions, placeCharacterToken, saveEffectDef } from "@/lib/db";
import { agreeImprovisation, agreedImprovisation, askImprovise, dropImprovisation, getImprovisation, listOpenImprovisations, openImprovisation, rollSucceeds, setImproviseRolled } from "@/lib/improvise";
import { playImprovisation } from "@/app/(play)/play/improvising";

test("asking to improvise: one open ask per token (a new one replaces it), listed for the GM, dropped when taken back", () => {
  const lv = level(), tok = placeCharacterToken(lv, character("Mira"), 0, 0);
  askImprovise(lv, tok, "tip the oil barrel");
  askImprovise(lv, tok, "  tip the oil barrel toward the door ");
  assert.equal(openImprovisation(tok)?.intent, "tip the oil barrel toward the door");
  assert.deepEqual(listOpenImprovisations(lv).map((i) => i.intent), ["tip the oil barrel toward the door"]);
  dropImprovisation(openImprovisation(tok)!.id);
  assert.equal(openImprovisation(tok), undefined);
});


test("the GM settles it (cost, roll, outcomes); it plays out by the roll: success, failure, a natural 1 never succeeds", () => {
  assert.equal(rollSucceeds(null), true);
  assert.equal(rollSucceeds({ type: "check", skill: "athletics", dc: 12 }, { total: 14, natural: 9 }), true);
  assert.equal(rollSucceeds({ type: "check", skill: "athletics", dc: 12 }, { total: 11, natural: 9 }), false);
  assert.equal(rollSucceeds({ type: "save", attribute: "agility", dc: 2 }, { total: 9, natural: 1 }), false);
  const lv = level(), tok = placeCharacterToken(lv, character("Ned"), 0, 0);
  const id = askImprovise(lv, tok, "kick the barrel into the river");
  agreeImprovisation(id, { name: "Kick the barrel", cost: "action", seconds: 2, roll: { type: "check", skill: "athletics", dc: 12 }, success: { kind: "script", script: "game.vars.barrel = 'gone'" }, failure: { kind: "narrative", text: "It won't budge." } });
  assert.equal(openImprovisation(tok), undefined, "settled: no longer waiting on the GM");
  assert.equal(agreedImprovisation(tok)?.agreed?.name, "Kick the barrel");
  setImproviseRolled(id, { total: 8, natural: 6 });
  const told = playImprovisation(getImprovisation(id)!);
  assert.deepEqual(told.get(tok), ["Kick the barrel: it doesn't work.", "It won't budge."]);
  assert.notEqual(getVars().barrel, "gone");
  assert.equal(getImprovisation(id)!.status, "done");
  const id2 = askImprovise(lv, tok, "again");
  agreeImprovisation(id2, { name: "Kick it again", cost: "action", seconds: 2, roll: null, success: { kind: "script", script: "game.vars.barrel = 'gone'" } });
  playImprovisation(getImprovisation(id2)!);
  assert.equal(getVars().barrel, "gone");
});

test("an effect outcome on the improviser (or someone else)", () => {
  const lv = level(), tok = placeCharacterToken(lv, character("Ora"), 0, 0);
  const brave = saveEffectDef(null, { name: "Emboldened", description: "", modifiers: [{ kind: "speed", factor: 1.5 }], rounds: 2 });
  const id = askImprovise(lv, tok, "a rousing yell");
  agreeImprovisation(id, { name: "Rousing yell", cost: "bonus", seconds: 1, roll: null, success: { kind: "effect", effect: brave, on: "self" } });
  const told = playImprovisation(getImprovisation(id)!);
  assert.ok(listAfflictions(lv).get(tok)?.some((a) => a.condition.name === "Emboldened"));
  assert.match(told.get(tok)?.[0] ?? "", /You're emboldened/);
  void getCondition;
});
