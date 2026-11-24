import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { listTokens, moveToken, placeCharacterToken, saveEncounter, setStandingOrder } from "@/lib/db";
import { moveFollowers } from "../../app/(play)/play/walk";

const at = (lv: number, id: number) => { const t = listTokens(lv).find((x) => x.id === id)!; return [t.col, t.row]; };

test("when someone moves, those following, pursuing or evading them walk too, and their followers after them", () => {
  const lv = level("Road");
  const lead = placeCharacterToken(lv, character("Lead"), 5, 5);
  const f = placeCharacterToken(lv, character("Follower"), 3, 5), ff = placeCharacterToken(lv, character("Tail"), 1, 5);
  const p = placeCharacterToken(lv, character("Hound"), 5, 9), e = placeCharacterToken(lv, character("Hare"), 9, 5);
  setStandingOrder(f, lead, "follow");
  setStandingOrder(ff, f, "follow");
  setStandingOrder(p, lead, "pursue");
  setStandingOrder(e, lead, "evade");
  moveToken(lead, 7, 5);
  const walks = moveFollowers(lv, lead, 2);
  assert.deepEqual(at(lv, f), [5, 5], "follows as far as they went");
  assert.deepEqual(at(lv, ff), [3, 5], "the tail follows the follower");
  assert.equal(Math.max(Math.abs(at(lv, p)[0] - 7), Math.abs(at(lv, p)[1] - 5)), 1, "the hound catches up to next to them");
  assert.equal(at(lv, e)[0] - 9 + Math.abs(at(lv, e)[1] - 5) > 0, true, "the hare gets away");
  assert.deepEqual(walks.map((w) => w.tokenId).sort(), [f, ff, p, e].sort());
});

test("nobody follows in an encounter: rounds take over", () => {
  const lv = level("Arena");
  const lead = placeCharacterToken(lv, character("L"), 5, 5), f = placeCharacterToken(lv, character("F"), 3, 5);
  setStandingOrder(f, lead, "follow");
  saveEncounter(lv, { round: 1, turn: 0, order: [] });
  moveToken(lead, 7, 5);
  assert.deepEqual(moveFollowers(lv, lead, 2), []);
  assert.deepEqual(at(lv, f), [3, 5]);
});
