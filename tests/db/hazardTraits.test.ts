import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { addLastingArea, setLastingAreaOff } from "@/lib/db/areas";
import { moveToken, placeCharacterToken } from "@/lib/db/tokens";
import { speedFps } from "@/lib/creatureChanges";
import { UNTIL_REMOVED, areaFromDrawn } from "@/lib/aoe";
import type { Hazard } from "@/lib/hazards";

test("Frozen (ice): walking speed is halved while standing on it (moving costs double), not elsewhere or once it's off", () => {
  const lv = level(), tok = placeCharacterToken(lv, character("Ivy"), 0, 0), walk = { walking: 30 };
  const pond = addLastingArea(lv, { name: "Frozen pond", look: "snow", area: areaFromDrawn({ shape: "rect", x: 2, y: 0, w: 3, h: 3 }), drawn: true, ends: UNTIL_REMOVED, damage: null, dc: 99, save: "agility", half: false, fires: [], traits: ["frozen"] } as Omit<Hazard, "id">);
  assert.equal(speedFps(tok, walk), 5);
  moveToken(tok, 3, 1);
  assert.equal(speedFps(tok, walk), 2.5, "on the ice");
  setLastingAreaOff(pond, true);
  assert.equal(speedFps(tok, walk), 5, "switched off");
});

test("Impassable (a chasm): moves go around it, as round a wall; not while it's off", async () => {
  const { moveBlockers } = await import("@/lib/db/areas");
  const { reachableSquares, squareKey } = await import("@/lib/movement");
  const lv = level();
  const chasm = addLastingArea(lv, { name: "Chasm", look: "fog", noLook: true, area: areaFromDrawn({ shape: "rect", x: 3, y: -1, w: 1, h: 3 }), drawn: true, ends: UNTIL_REMOVED, damage: null, dc: 99, save: "agility", half: false, fires: [], traits: ["impassable"] } as Omit<Hazard, "id">);
  const reach = (n = 4) => reachableSquares({ col: 1, row: 0 }, n, moveBlockers(lv));
  assert.equal(reach().has(squareKey(3, 0)), false, "not into it");
  assert.equal(reach().has(squareKey(5, 0)), false, "not straight across");
  assert.ok((reach(8).get(squareKey(5, 0))?.steps ?? 0) > 4, "round it: the long way");
  setLastingAreaOff(chasm, true);
  assert.equal(reach().get(squareKey(5, 0))?.steps, 4, "off: straight across");
  assert.equal(reach().has(squareKey(3, 0)), true);
});

test("Deep (deep water): moving in it uses swimming speed; those who can't swim can't move in it or into it", async () => {
  const { blockersFor } = await import("@/lib/creatureChanges");
  const { db } = await import("@/lib/db/connection");
  const { reachableSquares, squareKey } = await import("@/lib/movement");
  const lv = level();
  addLastingArea(lv, { name: "Harbour", look: "rain", area: areaFromDrawn({ shape: "rect", x: 3, y: -2, w: 4, h: 5 }), drawn: true, ends: UNTIL_REMOVED, damage: null, dc: 99, save: "agility", half: false, fires: [], traits: ["deep"] } as Omit<Hazard, "id">);
  const fish = character("Fin"), rock = character("Rocky");
  db.prepare("UPDATE characters SET movement = ? WHERE id = ?").run(JSON.stringify({ walking: 30, swimming: 15 }), fish);
  db.prepare("UPDATE characters SET movement = ? WHERE id = ?").run(JSON.stringify({ walking: 30, swimming: 0 }), rock);
  const f = placeCharacterToken(lv, fish, 1, 0), r = placeCharacterToken(lv, rock, 1, 1);
  const into = (tok: number, from: { col: number; row: number }) => reachableSquares(from, 3, blockersFor(lv, tok)).has(squareKey(4, 0));
  assert.equal(into(f, { col: 1, row: 0 }), true, "a swimmer wades in");
  assert.equal(into(r, { col: 1, row: 1 }), false, "no swimming speed: not into it");
  moveToken(f, 4, 0);
  moveToken(r, 4, 1);
  assert.equal(speedFps(f, { walking: 30, swimming: 15 }), 2.5, "in it: swimming speed");
  assert.equal(speedFps(r, { walking: 30, swimming: 0 }), 0, "can't swim: no moving in it");
});
