import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, level } from "./seed";
import { addCreatureToken, clearHidden, listHidden, placeCharacterToken, setHidden } from "@/lib/db";
import { seenFrom } from "@/lib/sight";

test("someone hidden is unseen by those not on their side (not even as a guess), seen by their own side", () => {
  const lv = level("Yard");
  const milo = placeCharacterToken(lv, character("Milo"), 0, 0), tilly = placeCharacterToken(lv, character("Tilly"), 2, 0);
  const rat = addCreatureToken(lv, creature("Rat"), 4, 0);
  setHidden(milo, 17);
  assert.deepEqual([...listHidden(lv)], [[milo, 17]]);
  assert.equal(seenFrom(lv, { col: 4, row: 0 }, rat).has(milo), false, "the rat doesn't see him");
  assert.equal(seenFrom(lv, { col: 4, row: 0 }, rat, { unseenToo: true }).has(milo), false, "nor can it aim at him by guessing");
  assert.equal(seenFrom(lv, { col: 2, row: 0 }, tilly).has(milo), true, "his ally does");
  clearHidden(milo);
  assert.equal(seenFrom(lv, { col: 4, row: 0 }, rat).has(milo), true);
});
