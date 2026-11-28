import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, level } from "./seed";
import { addCreatureToken, clearHidden, listHidden, moveToken, placeCharacterToken, setHidden } from "@/lib/db/tokens";
import { addStructure } from "@/lib/db/maps";
import { hidingPlaces, revealAfterStep, settleHide } from "../../app/(play)/play/hiding";
import { searchFor } from "../../app/(play)/play/workOutRound";
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

test("hiding places: seen now or not, and the blind spots behind a wall from the enemies they can see", () => {
  const lv = level("Courtyard");
  addStructure(lv, { kind: "wall", x1: 3, y1: -3, x2: 3, y2: 2, target_level_id: null } as never); // a wall along x = 3, from y -3 to 2
  const milo = placeCharacterToken(lv, character("Milo"), 1, 0);
  addCreatureToken(lv, creature("Guard"), 0, 0); // on Milo's side of the wall, next to him
  const at = hidingPlaces(lv, milo, { col: 1, row: 0 }, 30);
  assert.equal(at.seen, true);
  assert.ok(at.spots.length > 0 && at.spots.every((c) => c.col >= 3), "only past the wall: " + JSON.stringify(at.spots));
});

test("the Stealth roll: hidden with that total, unless any enemy (known or not) sees them as they roll", () => {
  const lv = level("Hall");
  addStructure(lv, { kind: "wall", x1: 3, y1: -3, x2: 3, y2: 3, target_level_id: null } as never);
  const milo = placeCharacterToken(lv, character("Milo"), 1, 0);
  const guard = addCreatureToken(lv, creature("Guard"), 6, 0); // beyond the wall
  assert.deepEqual(settleHide(lv, milo, 16), { hidden: true, told: "You're hidden." });
  assert.equal(listHidden(lv).get(milo), 16);
  clearHidden(milo);
  moveToken(guard, 2, 2); // now on his side
  assert.equal(settleHide(lv, milo, 16).hidden, false);
  assert.equal(listHidden(lv).has(milo), false);
});

test("a creature's Search (server-rolled) finds someone hiding from it within 10 ft whose Stealth it beats", () => {
  const lv = level("Cellar");
  const milo = placeCharacterToken(lv, character("Milo"), 1, 0), far = placeCharacterToken(lv, character("Far"), 9, 0);
  const rat = addCreatureToken(lv, creature("Rat"), 0, 0);
  setHidden(milo, -50); // any roll beats it
  setHidden(far, -50); // too far away
  searchFor(lv, rat, { col: 0, row: 0 });
  assert.equal(listHidden(lv).has(milo), false);
  assert.equal(listHidden(lv).has(far), true);
});

test("hiding places: a smoke hazard (obscures sight) is a blind spot from an enemy more than 15 ft away, and cuts sight into it", async () => {
  const { addLastingArea } = await import("@/lib/db/areas");
  const { UNTIL_REMOVED, areaFromDrawn } = await import("@/lib/aoe");
  const lv = level("Smoky yard");
  const milo = placeCharacterToken(lv, character("Milo"), 2, 0), guard = addCreatureToken(lv, creature("Guard"), 12, 0);
  const smoke = { name: "Smoke", look: "fog" as const, area: areaFromDrawn({ shape: "circle", x: 4.5, y: 0.5, r: 1 }), drawn: true, ends: UNTIL_REMOVED, damage: null, dc: 99, save: "agility" as const, half: false, fires: [] };
  const before = hidingPlaces(lv, milo, { col: 2, row: 0 }, 10);
  assert.ok(!before.spots.some((s) => s.col === 4 && s.row === 0), "no smoke yet: no blind spot there");
  addLastingArea(lv, { ...smoke, obscures: true } as never);
  const after = hidingPlaces(lv, milo, { col: 2, row: 0 }, 10);
  assert.ok(after.spots.some((s) => s.col === 4 && s.row === 0), JSON.stringify(after.spots));
  assert.equal(after.seen, true, "where he stands, outside it, he's still seen");
  assert.equal(seenFrom(lv, { col: 12, row: 0 }, guard).has(milo), true);
  moveToken(milo, 4, 0);
  assert.equal(seenFrom(lv, { col: 12, row: 0 }, guard).has(milo), false, "in the smoke: lost to sight from afar");
});
