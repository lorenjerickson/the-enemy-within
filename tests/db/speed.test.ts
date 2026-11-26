import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { db } from "@/lib/db/connection";
import { getCharacter } from "@/lib/db/catalog";
import { placeCharacterToken } from "@/lib/db/tokens";
import { settleSpeeds } from "@/lib/db/effects";
import { speedFps, speedOf } from "@/lib/creatureChanges";

test("old speeds (feet per round) become feet per second, once; speeds are read the same either way", () => {
  const id = character("Runner");
  db.prepare("UPDATE characters SET movement = ? WHERE id = ?").run(JSON.stringify({ walking: 30, running: 60, flying: 0 }), id);
  const tok = placeCharacterToken(level(), id, 0, 0);
  assert.equal(speedFps(tok, getCharacter(id)!.movement), 5, "read as 30 ft per round");
  settleSpeeds();
  assert.deepEqual(getCharacter(id)!.movement.walking, { value: 5, dist: "ft", per: "s" });
  assert.deepEqual(getCharacter(id)!.movement.running, { value: 10, dist: "ft", per: "s" });
  settleSpeeds();
  assert.deepEqual(getCharacter(id)!.movement.walking, { value: 5, dist: "ft", per: "s" }, "idempotent");
  assert.equal(speedOf(tok, getCharacter(id)!.movement, "running"), 60, "still 60 ft a round");
  db.prepare("UPDATE characters SET movement = ? WHERE id = ?").run(JSON.stringify({ walking: { value: 70, dist: "mi", per: "h" } }), id);
  assert.ok(Math.abs(speedFps(tok, getCharacter(id)!.movement) - 102.67) < 0.01, "70 mph");
});
