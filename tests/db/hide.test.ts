import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, level } from "./seed";
import { addCreatureToken, clearHidden, listHidden, moveToken, placeCharacterToken, setHidden } from "@/lib/db";
import { revealAfterStep } from "../../app/(play)/play/hiding";
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

test("out of encounters: a hidden one stepping into an enemy's view, or with an enemy stepping next to them, is revealed", () => {
  const lv = level("Alley");
  const milo = placeCharacterToken(lv, character("Milo"), 0, 0), rat = addCreatureToken(lv, creature("Rat"), 6, 0);
  setHidden(milo, 15);
  assert.deepEqual(revealAfterStep(lv, milo), ["You're no longer hidden."], "the rat sees him (nothing in the way)");
  setHidden(milo, 15);
  moveToken(rat, 1, 0);
  revealAfterStep(lv, rat);
  assert.equal(listHidden(lv).has(milo), false, "the rat stepped right next to him");
});
