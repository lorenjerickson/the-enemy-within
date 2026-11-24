import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { db, listTokens, moveToken, placeCharacterToken, saveEncounter, setStandingOrder } from "@/lib/db";
import { walkWithFollowers } from "../../app/(play)/play/walk";

const fast = (id: number, fps: number) => db.prepare("UPDATE characters SET movement = ? WHERE id = ?").run(JSON.stringify({ walking: { value: fps, dist: "ft", per: "s" } }), id);
const who = (name: string, fps = 5) => { const id = character(name); fast(id, fps); return id; };
// The leader got from a to b already (as if dragged); followers move alongside it, second by second.
const followers = (lv: number, lead: number, a: { x: number; y: number }, b: { x: number; y: number }) => walkWithFollowers(lv, lead, [], 5, [a, b]).walks;

const at = (lv: number, id: number) => { const t = listTokens(lv).find((x) => x.id === id)!; return [t.col, t.row]; };

test("when someone moves, those following, pursuing or evading them walk too, and their followers after them", () => {
  const lv = level("Road");
  const lead = placeCharacterToken(lv, who("Lead"), 5, 5);
  const f = placeCharacterToken(lv, who("Follower"), 3, 5), ff = placeCharacterToken(lv, who("Tail"), 1, 5);
  const p = placeCharacterToken(lv, who("Hound", 10), 5, 9), e = placeCharacterToken(lv, who("Hare"), 9, 5);
  setStandingOrder(f, lead, "follow");
  setStandingOrder(ff, f, "follow");
  setStandingOrder(p, lead, "pursue");
  setStandingOrder(e, lead, "evade");
  moveToken(lead, 7, 5);
  const walks = followers(lv, lead, { x: 5, y: 5 }, { x: 7, y: 5 }).filter((w) => w.tokenId !== lead);
  assert.deepEqual(at(lv, f), [5, 5], "follows as far as they went");
  assert.deepEqual(at(lv, ff), [3, 5], "the tail follows the follower");
  assert.equal(Math.max(Math.abs(at(lv, p)[0] - 7), Math.abs(at(lv, p)[1] - 5)), 1, "the hound catches up to next to them");
  assert.equal(at(lv, e)[0] - 9 + Math.abs(at(lv, e)[1] - 5) > 0, true, "the hare gets away");
  assert.deepEqual(walks.map((w) => w.tokenId).sort(), [f, ff, p, e].sort());
});

test("nobody follows in an encounter: rounds take over", () => {
  const lv = level("Arena");
  const lead = placeCharacterToken(lv, who("L"), 5, 5), f = placeCharacterToken(lv, who("F"), 3, 5);
  setStandingOrder(f, lead, "follow");
  saveEncounter(lv, { round: 1, turn: 0, order: [] });
  moveToken(lead, 7, 5);
  assert.deepEqual(followers(lv, lead, { x: 5, y: 5 }, { x: 7, y: 5 }).filter((w) => w.tokenId !== lead), []);
  assert.deepEqual(at(lv, f), [3, 5]);
});

test("moving alongside, at their own speed: a slow pursuer falls behind; timings are per second", () => {
  const lv = level("Moor");
  const lead = placeCharacterToken(lv, who("Lead", 10), 2, 0), slow = placeCharacterToken(lv, who("Slow", 5), 0, 0);
  setStandingOrder(slow, lead, "pursue");
  moveToken(lead, 8, 0);
  const walks = followers(lv, lead, { x: 2, y: 0 }, { x: 8, y: 0 }); // 6 squares at 5 ft/s: 6 seconds of the leader
  const s = walks.find((w) => w.tokenId === slow)!;
  assert.deepEqual(listTokens(lv).find((t) => t.id === slow) && [listTokens(lv).find((t) => t.id === slow)!.col, listTokens(lv).find((t) => t.id === slow)!.row], [6, 0], "a square a second for 6 seconds");
  assert.deepEqual(s.times, [0, 1, 2, 3, 4, 5, 6]);
});
