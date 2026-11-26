import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { addEffect } from "@/lib/db/mapThings";
import { db } from "@/lib/db/connection";
import { placeCharacterToken } from "@/lib/db/tokens";
import { seenFrom } from "@/lib/sight";
import { sensesOf } from "@/lib/creatureChanges";

test("fog cuts sight to 15 ft: from inside it, and of someone in it from outside; switched off, it doesn't", () => {
  const lv = level();
  addEffect(lv, { kind: "fog", x: 0, y: 0, w: 6, h: 6, intensity: 0.5 });
  const a = placeCharacterToken(lv, character("Ann"), 2, 2); // in the fog
  const near = placeCharacterToken(lv, character("Ben"), 4, 2); // 10 ft away, in it too
  const far = placeCharacterToken(lv, character("Cal"), 12, 2); // 50 ft away, outside it
  assert.equal(sensesOf(a, lv).blind, true);
  assert.deepEqual([...seenFrom(lv, { col: 2, row: 2 }, a)].sort(), [near]);
  assert.equal(seenFrom(lv, { col: 12, row: 2 }, far).has(a), false, "lost in the fog beyond 15 ft");
  db.prepare("UPDATE map_effects SET enabled = 0 WHERE level_id = ?").run(lv);
  assert.equal(seenFrom(lv, { col: 12, row: 2 }, far).has(a), true);
  assert.equal(sensesOf(a, lv).blind, false);
});
