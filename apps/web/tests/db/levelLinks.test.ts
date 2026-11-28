import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, level } from "./seed";
import { addCreatureToken, clearStandingOrdersOn, getStandingOrder, listStandingOrdersOn, setStandingOrder, listTokens, moveTokenToLevel, placeCharacterToken } from "@/lib/db/tokens";
import { getEncounter, getEncounterWaiting, saveEncounter, setEncounterWaiting } from "@/lib/db/encounters";
import { getRoundPlan, saveRoundPlan } from "@/lib/db/rounds";

test("taking a level link leaves the encounter on the old level and arrives outside the new one's", () => {
  const up = level("Upstairs"), down = level("Cellar");
  const rat = addCreatureToken(up, creature("Rat"), 0, 0);
  const hero = placeCharacterToken(up, character("Hero"), 1, 0);
  const cat = addCreatureToken(up, creature("Cat"), 2, 0);
  saveEncounter(up, { round: 2, turn: 2, order: [{ token_id: rat, initiative: 15 }, { token_id: hero, initiative: 12 }, { token_id: cat, initiative: 8 }] });
  setEncounterWaiting(up, [hero, cat]);
  saveRoundPlan(up, hero, [], true);
  moveTokenToLevel(hero, down, 4, 5);
  assert.deepEqual(listTokens(down).map((t) => [t.id, t.col, t.row]), [[hero, 4, 5]]);
  assert.deepEqual(getEncounter(up), { round: 2, turn: 1, order: [{ token_id: rat, initiative: 15 }, { token_id: cat, initiative: 8 }] }, "still the cat's turn");
  assert.deepEqual(getEncounterWaiting(up), [cat]);
  assert.equal(getRoundPlan(up, hero).ready, false, "their plan there is gone");
  assert.equal(getEncounter(down), undefined);
});

test("standing orders: kept while both are on the same level, cleared per token or for a level", () => {
  const hall = level("Hall"), yard = level("Yard");
  const a = placeCharacterToken(hall, character("A"), 0, 0), b = placeCharacterToken(hall, character("B"), 3, 0);
  setStandingOrder(a, b, "follow");
  assert.deepEqual(getStandingOrder(a), { targetId: b, mode: "follow" });
  assert.deepEqual(listStandingOrdersOn(b), [{ tokenId: a, mode: "follow" }]);
  moveTokenToLevel(b, yard, 0, 0);
  assert.equal(getStandingOrder(a), undefined, "not once they're on another level");
  moveTokenToLevel(b, hall, 3, 0);
  clearStandingOrdersOn(hall);
  assert.equal(getStandingOrder(a), undefined);
});
